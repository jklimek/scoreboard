#!/usr/bin/env python3
"""
Ultimate Frisbee Minimap Service
Standalone script that:
 - Calibrates a static wide camera to a top-down field using 4 clicked points
 - Runs YOLOv8 person detection + ByteTrack identity persistence
 - Converts detections to feet points, warps them to field coords
 - Smooths positions with a Kalman filter per track
 - Differentiates two teams by jersey color (HSV EMA + KMeans fallback)
 - Filters to in-field players and caps to 5v5 per team
 - Produces live minimap PNG and heatmap overlays, saves temporal snapshots
 - Serves the current minimap.png over HTTP for OBS Browser Source

Dependencies:
 pip install opencv-python ultralytics numpy scikit-learn flask

Run:
 python ultimate_minimap_service.py --source 0
 Then in OBS add a Browser Source pointing to http://localhost:5000/minimap.png

Notes: configure constants below for FIELD size and TEAM HSV protos.
"""

import argparse
import threading
import time
import os
import json
from collections import defaultdict

import cv2
import numpy as np
from ultralytics import YOLO
from sklearn.cluster import KMeans
from flask import Flask, make_response, jsonify, render_template

# ---------------- CONFIG ----------------
FIELD_W, FIELD_H = 1000, 333      # top-down map size in pixels (maintain aspect ratio ~75m x 25m)
FIELD_M_W, FIELD_M_H = 75.0, 25.0 # real field size in meters
PX_TO_M = FIELD_M_W / FIELD_W

HEATMAP_SCALE = 0.2
HM_W, HM_H = int(FIELD_W * HEATMAP_SCALE), int(FIELD_H * HEATMAP_SCALE)
HEATMAP_BLUR_SIGMA = 2.0
HEATMAP_DECAY = 0.0
TEMPORAL_INTERVAL_S = 60
OUTPUT_DIR = "heatmap_logs"
os.makedirs(OUTPUT_DIR, exist_ok=True)
SAVE_TEMPORAL_PNGS = False

# Calibration click padding around the video (in pixels and as fraction of frame size)
CALIB_PAD_MIN_X = 800
CALIB_PAD_MIN_Y = 800
CALIB_PAD_FRAC_X = 1.0  # 1.0 means pad equals frame width
CALIB_PAD_FRAC_Y = 0.5  # 1.0 means pad equals frame height

# Tracking/association tuning
TRACK_ASSOC_THRESH = 45.0     # px in field coords for association gating
TRACK_FORGET_SEC = 3.5        # time to forget tracks without detections
GHOST_ALPHA = 0.5             # rendering factor for predicted-only tracks

# Team HSV prototypes (tune on-site). If None -> will cluster automatically after enough samples
TEAM_HSV_PROTOS = None
# Example presets you can enable manually:
# TEAM_HSV_PROTOS = np.array([[45.25, 65.125, 28.375], [70.6, 23.1, 168.2]], dtype=np.float32)  # blue vs white

JERSEY_EMA_ALPHA = 0.2
MAX_PLAYERS_PER_TEAM = 5

MODEL_NAME = "yolov8s.pt"  # change to yolov8s/yolov8m if you have more compute
YOLO_CONF = 0.2
IMG_SZ = 1280

# HTTP server settings for OBS
HTTP_HOST = "0.0.0.0"
HTTP_PORT = 5000

# ---------------- HELPERS ----------------

def pick_field_corners(frame):
    """GUI to click 4 points with padding so you can click outside the frame.
    Order: top-left, top-right, bottom-left, bottom-right (as seen in the image).
    You can click outside the visible video by using the padded canvas.
    Returns points in the original frame coordinate system (may be negative or > frame size).
    """
    h, w = frame.shape[:2]
    pad_x = max(CALIB_PAD_MIN_X, int(w * CALIB_PAD_FRAC_X))
    pad_y = max(CALIB_PAD_MIN_Y, int(h * CALIB_PAD_FRAC_Y))

    # Build a padded canvas and place the frame centered with margins
    canvas = np.zeros((h + 2 * pad_y, w + 2 * pad_x, 3), dtype=frame.dtype)
    canvas[pad_y:pad_y + h, pad_x:pad_x + w] = frame

    # Draw a faint border around the actual frame region for visual reference
    base = canvas.copy()
    cv2.rectangle(base, (pad_x, pad_y), (pad_x + w - 1, pad_y + h - 1), (80, 80, 80), 1)
    disp = base.copy()

    # Store clicks both in canvas coords (for drawing) and source coords (for homography)
    pts_canvas = []
    pts_src = []

    def refresh_disp():
        nonlocal disp
        disp = base.copy()
        # redraw all points with indices
        for i, (cx, cy) in enumerate(pts_canvas):
            cv2.circle(disp, (cx, cy), 6, (0, 0, 255), -1)
            cv2.putText(disp, f"{i+1}", (cx + 8, cy - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

    def on_mouse(event, x, y, flags, param):
        nonlocal pts_canvas, pts_src
        if event == cv2.EVENT_LBUTTONDOWN:
            pts_canvas.append((x, y))
            # Map back to source image coordinates (may be outside 0..w-1/0..h-1)
            pts_src.append((x - pad_x, y - pad_y))
            refresh_disp()

    cv2.namedWindow("calib")
    cv2.setMouseCallback("calib", on_mouse)
    print("Click 4 field corner points in this order: TL, TR, BL, BR. Press 'q' to finish, 'u' to undo, 'r' to reset.")
    while True:
        # draw transient instructions overlay
        overlay = disp.copy()
        lines = [
            "Calibration: click TL, TR, BL, BR",
            f"Points: {len(pts_src)}/4   [u]=undo   [r]=reset   [q]=finish   [Esc]=cancel",
            "You can click outside the video; gray rectangle = camera frame",
        ]
        for i, line in enumerate(lines):
            y_text = 24 + i * 22
            cv2.putText(overlay, line, (10, y_text), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.imshow("calib", overlay)
        k = cv2.waitKey(1) & 0xFF
        if k == 27:  # Esc
            cv2.destroyWindow("calib")
            raise RuntimeError("Calibration cancelled by user")
        if k == ord('u'):
            if pts_canvas:
                pts_canvas.pop()
                pts_src.pop()
                refresh_disp()
            continue
        if k == ord('r'):
            pts_canvas = []
            pts_src = []
            refresh_disp()
            continue
        if k == ord('q') and len(pts_src) >= 4:
            break
    cv2.destroyWindow("calib")
    if len(pts_src) < 4:
        raise RuntimeError("Not enough points clicked for calibration")
    return np.float32([pts_src[0], pts_src[1], pts_src[2], pts_src[3]])


def feet_point_xyxy(box):
    x1, y1, x2, y2 = box
    return np.array([(x1 + x2) * 0.5, y2], dtype=np.float32)


def warp_point(p, H):
    p = p.reshape(1, 1, 2).astype(np.float32)
    return cv2.perspectiveTransform(p, H).reshape(2)


def bbox_torso_patch(img, box):
    x1, y1, x2, y2 = map(int, box)
    w = max(1, x2 - x1)
    h = max(1, y2 - y1)
    # Broader torso region to better capture jerseys (robust to pose/scale)
    tx1 = x1 + int(0.20 * w)
    tx2 = x2 - int(0.20 * w)
    ty1 = y1 + int(0.10 * h)
    ty2 = y1 + int(0.60 * h)
    tx1, ty1 = max(0, tx1), max(0, ty1)
    tx2, ty2 = min(img.shape[1] - 1, tx2), min(img.shape[0] - 1, ty2)
    if tx2 <= tx1 or ty2 <= ty1:
        return None
    return img[ty1:ty2, tx1:tx2]


def hsv_mean(patch_bgr):
    if patch_bgr is None or patch_bgr.size == 0:
        return None
    hsv = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2HSV)
    med = np.median(hsv.reshape(-1, 3), axis=0)
    return med.astype(np.float32)


def nearest_team_id(hsv_vec, protos):
    d = np.linalg.norm(protos - hsv_vec, axis=1)
    return int(np.argmin(d))


def hsv_to_hex(hsv_vec):
    """Convert OpenCV HSV (H:0-179, S:0-255, V:0-255) to CSS hex #RRGGBB."""
    hsv = np.array([[hsv_vec]], dtype=np.uint8)  # shape (1,1,3)
    bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0, 0].astype(int)
    r, g, b = int(bgr[2]), int(bgr[1]), int(bgr[0])  # BGR -> RGB
    return f"#{r:02x}{g:02x}{b:02x}"


def hex_to_bgr(hex_str):
    s = hex_str.lstrip('#')
    r = int(s[0:2], 16)
    g = int(s[2:4], 16)
    b = int(s[4:6], 16)
    return (b, g, r)


def compute_team_colors(team_hsv_protos, hsv_ema, team_by_id):
    hex_colors = ["#ff4d4d", "#4da6ff"]
    bgr_colors = [(0, 0, 255), (255, 0, 0)]
    try:
        if team_hsv_protos is not None:
            hex0 = hsv_to_hex(team_hsv_protos[0])
            hex1 = hsv_to_hex(team_hsv_protos[1])
            hex_colors = [hex0, hex1]
            bgr_colors = [hex_to_bgr(hex0), hex_to_bgr(hex1)]
        else:
            em0 = [hsv_ema[tid] for tid, t in team_by_id.items() if t == 0 and tid in hsv_ema]
            em1 = [hsv_ema[tid] for tid, t in team_by_id.items() if t == 1 and tid in hsv_ema]
            if len(em0) > 0:
                hex_colors[0] = hsv_to_hex(np.mean(em0, axis=0))
            if len(em1) > 0:
                hex_colors[1] = hsv_to_hex(np.mean(em1, axis=0))
            bgr_colors = [hex_to_bgr(hex_colors[0]), hex_to_bgr(hex_colors[1])]
    except Exception:
        pass
    return hex_colors, bgr_colors


def estimate_team_from_hsv(hsv_vec, protos):
    if hsv_vec is None:
        return 0
    if protos is not None:
        return nearest_team_id(hsv_vec, protos)
    # fallback: value threshold
    return 1 if hsv_vec[2] < 128 else 0


# ---------------- SIMPLE 2D KALMAN ----------------
class Kalman2D:
    def __init__(self, x, y, dt=1 / 30.0):
        self.dt = dt
        self.x = np.array([x, y, 0.0, 0.0], dtype=np.float32)
        self.P = np.eye(4, dtype=np.float32) * 100.0
        self.F = np.array([[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=np.float32)
        self.H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=np.float32)
        self.Q = np.eye(4, dtype=np.float32) * 0.1
        self.R = np.eye(2, dtype=np.float32) * 3.0

    def predict(self):
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        return self.x[:2].copy()

    def update(self, z):
        z = np.asarray(z, dtype=np.float32)
        y = z - self.H @ self.x
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.x = self.x + K @ y
        I = np.eye(4, dtype=np.float32)
        self.P = (I - K @ self.H) @ self.P
        return self.x[:2].copy()


# ---------------- HEATMAP & STATS ----------------
HEATMAP_ALPHA = 0.6

class Analytics:
    def __init__(self):
        self.hm0 = np.zeros((HM_H, HM_W), dtype=np.float32)
        self.hm1 = np.zeros((HM_H, HM_W), dtype=np.float32)
        self.temporal0 = np.zeros_like(self.hm0)
        self.temporal1 = np.zeros_like(self.hm1)
        self.temporal_idx = 0
        self.last_temporal_save = time.time()
        self.stats = self.init_stats()
        self.lock = threading.Lock()

    def init_stats(self):
        return {
            "last_pos_px": {},
            "distance_m": defaultdict(float),
            "time_seconds": defaultdict(float),
            "zone_seconds": defaultdict(lambda: defaultdict(float)),
            "team_cumulative_positions": defaultdict(lambda: np.array([0.0, 0.0])),
            "team_cumulative_counts": defaultdict(int),
        }

    def add_point(self, team, smoothed_px, weight=1.0):
        if smoothed_px is None:
            return
        ix = int(round(smoothed_px[0] * HEATMAP_SCALE))
        iy = int(round(smoothed_px[1] * HEATMAP_SCALE))
        if 0 <= ix < HM_W and 0 <= iy < HM_H:
            if team == 0:
                self.hm0[iy, ix] += weight
                self.temporal0[iy, ix] += weight
            else:
                self.hm1[iy, ix] += weight
                self.temporal1[iy, ix] += weight

    def decay(self):
        if HEATMAP_DECAY > 0:
            self.hm0 *= (1.0 - HEATMAP_DECAY)
            self.hm1 *= (1.0 - HEATMAP_DECAY)

    def save_temporal_if_needed(self):
        now = time.time()
        if now - self.last_temporal_save >= TEMPORAL_INTERVAL_S:
            base = os.path.join(OUTPUT_DIR, f"heatmap_{self.temporal_idx:03d}")
            np.save(base + "_team0.npy", self.temporal0)
            np.save(base + "_team1.npy", self.temporal1)
            # optional quick PNGs (upsampled) for debugging
            if SAVE_TEMPORAL_PNGS:
                up0 = cv2.resize(cv2.normalize(self.temporal0, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8),
                                 (FIELD_W, FIELD_H))
                up1 = cv2.resize(cv2.normalize(self.temporal1, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8),
                                 (FIELD_W, FIELD_H))
                cv2.imwrite(base + "_team0.png", up0)
                cv2.imwrite(base + "_team1.png", up1)
            self.temporal_idx += 1
            self.temporal0.fill(0)
            self.temporal1.fill(0)
            self.last_temporal_save = now

    def update_stats(self, dets, team_by_id, dt):
        for (tid, bbox, feet_px, smoothed_px) in dets:
            if smoothed_px is None:
                continue
            self.stats["time_seconds"][tid] += dt
            last = self.stats["last_pos_px"].get(tid)
            if last is not None:
                dx = (smoothed_px[0] - last[0])
                dy = (smoothed_px[1] - last[1])
                dist_px = np.hypot(dx, dy)
                self.stats["distance_m"][tid] += dist_px * PX_TO_M
            self.stats["last_pos_px"][tid] = np.array(smoothed_px)
            team = team_by_id.get(tid, 0)
            self.stats["team_cumulative_positions"][team] += np.array(smoothed_px)
            self.stats["team_cumulative_counts"][team] += 1

    def render_overlay(self, top_view):
        # blurred normalized heatmaps
        a0 = cv2.GaussianBlur(self.hm0.astype(np.float32), (0, 0), HEATMAP_BLUR_SIGMA)
        a1 = cv2.GaussianBlur(self.hm1.astype(np.float32), (0, 0), HEATMAP_BLUR_SIGMA)
        def norm255(a):
            if a.max() <= 0:
                return np.zeros_like(a, dtype=np.uint8)
            return cv2.normalize(a, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        n0 = norm255(a0)
        n1 = norm255(a1)
        up0 = cv2.resize(n0, (FIELD_W, FIELD_H), interpolation=cv2.INTER_LINEAR)
        up1 = cv2.resize(n1, (FIELD_W, FIELD_H), interpolation=cv2.INTER_LINEAR)
        heat = np.zeros((FIELD_H, FIELD_W, 3), dtype=np.uint8)
        heat[:, :, 2] = up0
        heat[:, :, 0] = up1
        overlay = cv2.addWeighted(top_view, 1.0 - HEATMAP_ALPHA, heat, HEATMAP_ALPHA, 0)
        return overlay

    def build_heat_bgra(self):
        # Build a transparent BGRA heatmap image at FIELD size (no camera background)
        a0 = cv2.GaussianBlur(self.hm0.astype(np.float32), (0, 0), HEATMAP_BLUR_SIGMA)
        a1 = cv2.GaussianBlur(self.hm1.astype(np.float32), (0, 0), HEATMAP_BLUR_SIGMA)

        def norm255(a):
            if a.max() <= 0:
                return np.zeros_like(a, dtype=np.uint8)
            return cv2.normalize(a, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

        n0 = norm255(a0)
        n1 = norm255(a1)
        up0 = cv2.resize(n0, (FIELD_W, FIELD_H), interpolation=cv2.INTER_LINEAR)
        up1 = cv2.resize(n1, (FIELD_W, FIELD_H), interpolation=cv2.INTER_LINEAR)
        heat_bgr = np.zeros((FIELD_H, FIELD_W, 3), dtype=np.uint8)
        heat_bgr[:, :, 2] = up0  # red
        heat_bgr[:, :, 0] = up1  # blue
        alpha = (np.maximum(up0, up1).astype(np.float32) * HEATMAP_ALPHA).clip(0, 255).astype(np.uint8)
        heat_bgra = np.dstack([heat_bgr, alpha])
        return heat_bgra

    def heat_png_bytes(self):
        bgra = self.build_heat_bgra()
        ok, buf = cv2.imencode('.png', bgra)
        if not ok:
            return None
        return buf.tobytes()


# ---------------- POINT-IN-FIELD & FILTERING ----------------
FIELD_POLY = np.array([[0, 0], [FIELD_W, 0], [FIELD_W, FIELD_H], [0, FIELD_H]], dtype=np.int32)


def point_in_field(pt):
    return cv2.pointPolygonTest(FIELD_POLY, tuple(pt), False) >= 0


def filter_active_players(dets, team_by_id):
    dets_in = [d for d in dets if d[3] is not None and point_in_field(d[3])]
    team0 = [d for d in dets_in if team_by_id.get(d[0], 0) == 0]
    team1 = [d for d in dets_in if team_by_id.get(d[0], 1) == 1]

    def pick_five(lst):
        if len(lst) <= MAX_PLAYERS_PER_TEAM:
            return lst
        # heuristic: prefer larger bbox area (closer) -> likely active
        return sorted(lst, key=lambda d: -((d[1][2] - d[1][0]) * (d[1][3] - d[1][1])))[:MAX_PLAYERS_PER_TEAM]

    return pick_five(team0) + pick_five(team1)


# ---------------- VISION THREAD ----------------
class VisionService:
    def __init__(self, source, H=None, src_corners=None, debug_views=True):
        self.source = source
        self.H = H
        self.src_corners = src_corners
        self.model = YOLO(MODEL_NAME)
        self.kalmans = {}
        self.hsv_ema = {}
        self.team_by_id = {}
        self.last_seen = {}
        self.analytics = Analytics()
        self.minimap_lock = threading.Lock()
        self.latest_minimap = None
        self.latest_state = None
        self.last_bbox = {}
        self.debug_views = debug_views
        self.running = True

    def calibrate(self, cap):
        ret, frame = cap.read()
        if not ret or frame is None:
            print("⚠️ Could not read frame, skipping...")
            return
        if not ret:
            raise RuntimeError("Can't read from source for calibration")
        if self.src_corners is None:
            self.src_corners = pick_field_corners(frame)
            print(self.src_corners)
            time.sleep(10)
        dst = np.float32([[0, 0], [FIELD_W, 0], [0, FIELD_H], [FIELD_W, FIELD_H]])
        self.H = cv2.getPerspectiveTransform(self.src_corners, dst)
        print("Calibration done. Homography ready.")

    def start(self):
        t = threading.Thread(target=self._run_loop, daemon=True)
        t.start()

    def stop(self):
        self.running = False

    def _run_loop(self):
        cap = cv2.VideoCapture(self.source)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self.calibrate(cap)

        # Simple tracking variables
        next_id = 0
        track_history = {}  # id -> list of recent positions
        max_history = 10

        fps_ts = time.time()
        fps = 0.0

        while self.running:
            ret, frame = cap.read()
            if not ret:
                print("End of video or failed to read frame")
                break
                
            now = time.time()
            dt = max(1/60.0, now - fps_ts)
            fps_ts = now

            # Run YOLO prediction on the frame
            results = self.model.predict(
                frame,
                conf=YOLO_CONF,
                classes=None,  # person class
                imgsz=IMG_SZ,
                verbose=False,
                iou=0.45,
                augment=True,
            )
            
            dets = []
            if results[0].boxes is not None and len(results[0].boxes) > 0:
                boxes = results[0].boxes.xyxy.cpu().numpy()
                confs = results[0].boxes.conf.cpu().numpy()

                # Collect current detections (feet in field coords)
                det_list = []  # list of dicts with bbox, feet_px, feet_field, hsv
                for i, (box, conf) in enumerate(zip(boxes, confs)):
                    x1, y1, x2, y2 = box
                    bbox = (x1, y1, x2, y2)
                    feet_px = feet_point_xyxy(bbox)
                    feet_field = warp_point(feet_px, self.H)
                    patch = bbox_torso_patch(frame, bbox)
                    hsv = hsv_mean(patch)
                    det_list.append({"bbox": bbox, "feet_px": feet_px, "feet_field": feet_field, "hsv": hsv})

                # Build previous track positions
                existing_ids = list(self.kalmans.keys())
                prev_pos = {}
                for tid in existing_ids:
                    kf = self.kalmans[tid]
                    prev_pos[tid] = np.array([float(kf.x[0]), float(kf.x[1])], dtype=np.float32)

                # Greedy one-to-one association by nearest neighbor in field space
                ASSOC_THRESH = TRACK_ASSOC_THRESH
                unmatched_dets = set(range(len(det_list)))
                unmatched_tracks = set(existing_ids)
                pairs = []  # (tid, det_index)

                while unmatched_dets and unmatched_tracks:
                    best = None
                    best_dist = float('inf')
                    for di in unmatched_dets:
                        dpos = det_list[di]["feet_field"]
                        for tid in unmatched_tracks:
                            tpos = prev_pos.get(tid)
                            if tpos is None:
                                continue
                            dist = float(np.linalg.norm(dpos - tpos))
                            if dist < best_dist:
                                best_dist = dist
                                best = (tid, di)
                    if best is None or best_dist > ASSOC_THRESH:
                        break
                    tid, di = best
                    pairs.append((tid, di))
                    unmatched_tracks.discard(tid)
                    unmatched_dets.discard(di)

                # Create new tracks with gating: only if there is available capacity per team
                new_pairs = []  # (new_tid, det_index)
                # Estimate team for the detection using prototypes or brightness
                def estimate_team_for_det(det):
                    if TEAM_HSV_PROTOS is not None and det["hsv"] is not None:
                        return nearest_team_id(det["hsv"], TEAM_HSV_PROTOS)
                    if det["hsv"] is not None:
                        # simple rule: lower V => dark team 1
                        return 1 if det["hsv"][2] < 128 else 0
                    return 0

                # Current active counts per team
                active_ids = set([tid for tid, _, _, _ in dets])
                team_counts = {0: 0, 1: 0}
                for tid in active_ids:
                    team_counts[self.team_by_id.get(tid, 0)] += 1

                for di in list(unmatched_dets):
                    det = det_list[di]
                    est_team = estimate_team_for_det(det)
                    if team_counts[est_team] >= MAX_PLAYERS_PER_TEAM:
                        continue  # skip spawning beyond 5 per team
                    new_tid = next_id
                    next_id += 1
                    new_pairs.append((new_tid, di))
                    unmatched_dets.discard(di)
                    team_counts[est_team] += 1

                # Update tracks for matched pairs
                for tid, di in pairs + new_pairs:
                    det = det_list[di]
                    bbox = det["bbox"]
                    feet_field = det["feet_field"]
                    hsv = det["hsv"]

                    # track history (for optional debugging)
                    if tid not in track_history:
                        track_history[tid] = []
                    track_history[tid].append(feet_field)
                    if len(track_history[tid]) > max_history:
                        track_history[tid].pop(0)

                    # jersey EMA
                    if hsv is not None:
                        if tid not in self.hsv_ema:
                            self.hsv_ema[tid] = hsv
                        else:
                            self.hsv_ema[tid] = (1.0 - JERSEY_EMA_ALPHA) * self.hsv_ema[tid] + JERSEY_EMA_ALPHA * hsv

                    # team assignment if prototypes provided
                    if TEAM_HSV_PROTOS is not None and tid in self.hsv_ema:
                        self.team_by_id[tid] = nearest_team_id(self.hsv_ema[tid], TEAM_HSV_PROTOS)

                    # Kalman update
                    if tid not in self.kalmans:
                        self.kalmans[tid] = Kalman2D(feet_field[0], feet_field[1], dt=dt)
                        smoothed = feet_field
                    else:
                        kf = self.kalmans[tid]
                        kf.dt = dt
                        kf.predict()
                        smoothed = kf.update(feet_field)

                    self.last_seen[tid] = now
                    dets.append((tid, bbox, feet_field, smoothed))

            # cleanup stale tracks (allow longer persistence to reduce blinking)
            stale = [tid for tid, tstamp in self.last_seen.items() if now - tstamp > TRACK_FORGET_SEC]
            for tid in stale:
                self.last_seen.pop(tid, None)
                self.kalmans.pop(tid, None)
                self.hsv_ema.pop(tid, None)
                self.team_by_id.pop(tid, None)
                track_history.pop(tid, None)

            # if no TEAM_HSV_PROTOS provided, try to learn stable prototypes once
            if TEAM_HSV_PROTOS is None and len(self.hsv_ema) >= 6 and len(self.team_by_id) < len(self.hsv_ema):
                try:
                    ids = list(self.hsv_ema.keys())
                    X = np.stack([self.hsv_ema[i] for i in ids], axis=0)
                    # KMeans to separate two jersey colors
                    kmeans = KMeans(n_clusters=2, n_init="auto", random_state=0).fit(X)
                    labels = kmeans.labels_.astype(int)
                    # compute prototype HSV centers
                    proto0 = X[labels == 0].mean(axis=0)
                    proto1 = X[labels == 1].mean(axis=0)
                    # Ensure consistent mapping: darker jersey -> team 1, brighter -> team 0 (or vice versa)
                    v0 = proto0[2]
                    v1 = proto1[2]
                    if v0 < v1:
                        proto_dark, proto_bright = proto0, proto1
                        dark_label, bright_label = 0, 1
                    else:
                        proto_dark, proto_bright = proto1, proto0
                        dark_label, bright_label = 1, 0
                    # Assign: team 1 = dark, team 0 = bright (change if you prefer)
                    for tid, lbl in zip(ids, labels):
                        self.team_by_id[tid] = 1 if lbl == dark_label else 0
                except Exception:
                    pass

            # filter to in-field + 5v5
            active = filter_active_players(dets, self.team_by_id)
            # additional cap: if more than 5 per team remain, keep the ones with longest recent visibility
            team0 = [d for d in active if self.team_by_id.get(d[0], 0) == 0]
            team1 = [d for d in active if self.team_by_id.get(d[0], 1) == 1]
            def sort_by_recency(lst):
                return sorted(lst, key=lambda d: -(now - self.last_seen.get(d[0], 0.0)))
            if len(team0) > MAX_PLAYERS_PER_TEAM:
                team0 = sort_by_recency(team0)[:MAX_PLAYERS_PER_TEAM]
            if len(team1) > MAX_PLAYERS_PER_TEAM:
                team1 = sort_by_recency(team1)[:MAX_PLAYERS_PER_TEAM]
            active = team0 + team1

            # update analytics & heatmaps
            self.analytics.decay()
            self.analytics.update_stats(active, self.team_by_id, dt)
            for tid, bbox, feet_field, smoothed in active:
                team = self.team_by_id.get(tid, 0)
                self.analytics.add_point(team, smoothed)

            self.analytics.save_temporal_if_needed()

            # render top view & plain field background (no live heat blending) only if needed
            overlay = None
            if self.debug_views:
                try:
                    overlay = cv2.warpPerspective(frame, self.H, (FIELD_W, FIELD_H))
                    if overlay is None or overlay.size == 0:
                        print("Warning: top_view is None or empty")
                        overlay = np.zeros((FIELD_H, FIELD_W, 3), dtype=np.uint8)
                except Exception as e:
                    print(f"Error in perspective warp: {e}")
                    overlay = np.zeros((FIELD_H, FIELD_W, 3), dtype=np.uint8)
                    cv2.putText(overlay, "Warp Error", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

            # derive team display colors from HSV prototypes or EMA
            team_colors_hex, team_colors_bgr = compute_team_colors(TEAM_HSV_PROTOS, self.hsv_ema, self.team_by_id)

            # draw dots for active players on overlay (top-down)
            if self.debug_views and overlay is not None:
                for tid, bbox, feet_field, smoothed in active:
                    tx, ty = int(smoothed[0]), int(smoothed[1])
                    team = self.team_by_id.get(tid, 0)
                    color = team_colors_bgr[0] if team == 0 else team_colors_bgr[1]
                    cv2.circle(overlay, (tx, ty), 6, color, -1)
                    cv2.putText(overlay, f"{tid}", (tx + 8, ty - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

            # also draw dots on the original camera frame (feet position in image coords)
            if self.debug_views:
                for tid, bbox, feet_field, smoothed in active:
                    fx, fy = feet_point_xyxy(bbox)
                    team = self.team_by_id.get(tid, 0)
                    color = team_colors_bgr[0] if team == 0 else team_colors_bgr[1]
                    cv2.circle(frame, (int(fx), int(fy)), 6, color, -1)
                    cv2.putText(frame, f"{tid}", (int(fx) + 8, int(fy) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

            # no ghost rendering here to keep canvas, overlay, and camera_debug consistent

            # update in-memory live state for HTTP server
            with self.minimap_lock:
                # publish only currently active (capped 5v5) to keep canvas in sync
                players = []
                for tid, bbox, feet_field, smoothed in active:
                    team = int(self.team_by_id.get(tid, 0))
                    players.append({
                        "id": int(tid),
                        "x": float(smoothed[0]),
                        "y": float(smoothed[1]),
                        "team": team,
                    })
                self.latest_state = {
                    "field_w": FIELD_W,
                    "field_h": FIELD_H,
                    "players": players,
                    "team_colors": team_colors_hex,
                    "ts": time.time(),
                }
                if self.debug_views and overlay is not None:
                    self.latest_minimap = overlay.copy()

            # small display for local debugging (optional)
            if self.debug_views and overlay is not None:
                cv2.imshow("camera_debug", frame)
                cv2.imshow("minimap", overlay)
                if cv2.waitKey(1) & 0xFF == 27:
                    break

        cap.release()
        cv2.destroyAllWindows()


# ---------------- HTTP SERVER THREAD ----------------
app = Flask(__name__)
vision_instance = None

@app.route('/')
def index_page():
    return render_template('index.html', FIELD_W=FIELD_W, FIELD_H=FIELD_H, FIELD_M_W=FIELD_M_W)

@app.route('/heatmap')
def heatmap_page():
    return render_template('heatmap.html', FIELD_W=FIELD_W, FIELD_H=FIELD_H)

@app.route('/heatmap.png')
def heatmap_png():
    global vision_instance
    if vision_instance is None:
        return make_response(b'', 200)
    with vision_instance.minimap_lock:
        data = vision_instance.analytics.heat_png_bytes()
    if data is None:
        return make_response(b'', 200)
    resp = make_response(data)
    resp.headers['Content-Type'] = 'image/png'
    resp.headers['Cache-Control'] = 'no-store'
    return resp

@app.route('/state')
def state_endpoint():
    global vision_instance
    default_state = {"field_w": FIELD_W, "field_h": FIELD_H, "players": [], "ts": time.time()}
    if vision_instance is None:
        return jsonify(default_state)
    with vision_instance.minimap_lock:
        st = vision_instance.latest_state if vision_instance.latest_state is not None else default_state
        return jsonify(st)


def start_http_server():
    app.run(host=HTTP_HOST, port=HTTP_PORT, threaded=True)


# ---------------- MAIN ----------------

def main():
    global vision_instance
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=0, help='Camera index or video file or RTSP url')
    parser.add_argument('--corners', default=None, help='Optional JSON file with src corners')
    parser.add_argument('--debug-views', action='store_true', help='Show OpenCV debug windows and render overlays')
    args = parser.parse_args()

    src = args.source
    src_corners = None
    if args.corners:
        with open(args.corners, 'r') as f:
            data = json.load(f)
            src_corners = np.array(data['corners'], dtype=np.float32)

    vs = VisionService(src, src_corners=src_corners, debug_views=bool(args.debug_views))
    vision_instance = vs

    http_t = threading.Thread(target=start_http_server, daemon=True)
    http_t.start()
    print(f"HTTP server started at http://{HTTP_HOST}:{HTTP_PORT}/  (open in browser)")
    print(f"Heatmap overlay at http://{HTTP_HOST}:{HTTP_PORT}/heatmap")

    vs.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Stopping...")
        vs.stop()


if __name__ == '__main__':
    main()
