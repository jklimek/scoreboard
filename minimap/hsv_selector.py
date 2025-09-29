import cv2, numpy as np

video_path = "/home/kuba/5m_loop.mp4"
cap = cv2.VideoCapture(video_path)
ok, frame = cap.read()
cap.release()
if not ok or frame is None:
    raise SystemExit("Could not read first frame")

print("Drag a box around a jersey, press Enter. Repeat for multiple samples. Press ESC to finish.")
samples = []
while True:
    r = cv2.selectROI("pick_jersey", frame, fromCenter=False, showCrosshair=True)
    if r == (0,0,0,0):
        break
    x, y, w, h = map(int, r)
    patch = frame[y:y+h, x:x+w]
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    med = np.median(hsv.reshape(-1, 3), axis=0)
    print("Sample HSV median:", med.astype(np.float32))
    samples.append(med)
    k = cv2.waitKey(10) & 0xFF
    if k == 27:  # ESC
        break
cv2.destroyAllWindows()

if samples:
    arr = np.array(samples, dtype=np.float32)
    print("Average HSV:", arr.mean(axis=0).astype(np.float32))