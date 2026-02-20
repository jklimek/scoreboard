import { OverlayEvent, ScoreboardAnimator, TeamKey } from "./scoreboard-animations";

type JsonObject = Record<string, unknown>;

type MatchIdentity = {
  game_id?: number;
  home_name?: string;
  away_name?: string;
  start_time_iso?: string;
};

type TeamState = {
  full_name: string;
  short_name: string;
  jersey_color?: string | null;
};

type TimerState = {
  running: boolean;
  offset_seconds: number;
  base_offset_seconds?: number;
  running_started_at_unix_ms?: number | null;
};

type LegacyStatValue = {
  a: number | string;
  h: number | string;
  ap: number;
  hp: number;
};

type Snapshot = {
  selected_field_id?: string | null;
  teams: {
    h: TeamState;
    a: TeamState;
  };
  players: { h: Record<string, string>; a: Record<string, string> };
  score: { home: number; away: number };
  timer: TimerState;
  stats: {
    points: LegacyStatValue;
    o_points: LegacyStatValue;
    d_points: LegacyStatValue;
    o_time: LegacyStatValue;
    turnovers: LegacyStatValue;
    timeouts: LegacyStatValue;
    player_stats: {
      h: Record<string, { name: string; goals: number; assists: number; total: number }>;
      a: Record<string, { name: string; goals: number; assists: number; total: number }>;
    };
    overlay_events?: OverlayEvent[];
    current_possession?: { team?: TeamKey | null; changed_at_seconds?: number | null };
    advanced_stats: {
      hold_rate: Record<string, number>;
      break_rate: Record<string, number>;
      avg_point_duration: number;
      turnovers_per_point: number;
      scoring_runs: Record<string, number>;
    };
  };
  match_context: {
    last_match?: MatchIdentity;
    current_match?: MatchIdentity;
    next_match?: MatchIdentity;
    selected_match?: MatchIdentity;
  };
};

type StatBarRow = {
  key: string;
  label: string;
  homeValue: string;
  awayValue: string;
  homePercent: number;
  awayPercent: number;
};

type AdvancedComparisonRow = {
  key: string;
  label: string;
  homeValue: string;
  awayValue: string;
};

const viewType = document.body.dataset.viewType ?? "scoreboard";
const scoreboardAnimator = new ScoreboardAnimator();

async function applyObsBgColor(): Promise<void> {
  try {
    const res = await fetch("/api/v1/obs-config");
    const data = (await res.json()) as { bgColor?: string };
    if (typeof data.bgColor === "string" && data.bgColor) {
      document.body.style.backgroundColor = data.bgColor;
    }
  } catch {
    /* keep default from CSS */
  }
}
void applyObsBgColor();

let ws: WebSocket | null = null;
let heartbeatTimer: number | null = null;
let reconnectTimer: number | null = null;
let latestSnapshot: Snapshot | null = null;
let localClockTimer: number | null = null;
let localClockBaseSeconds = 0;
let localClockBaseTimestamp = 0;
let lastRenderedClock = "";
let lastAppliedTimerSignature = "";
let lastPossessionTeam: TeamKey | null = null;
const seenOverlayEventIds = new Set<string>();
const seenOverlayEventOrder: string[] = [];

function isTeamKey(value: unknown): value is TeamKey {
  return value === "a" || value === "h";
}

function normalizeHexColor(raw?: string | null): string | null {
  if (!raw) return null;
  const candidate = raw.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(candidate) === false) {
    return null;
  }
  return `#${candidate.replace("#", "").toUpperCase()}`;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = String(Math.floor(safe / 60)).padStart(2, "0");
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatTeamName(name: string, fallback: string): string {
  return name?.trim() || fallback;
}

function getLocalClockSeconds(now = Date.now()): number {
  if (localClockBaseTimestamp === 0) {
    return 0;
  }
  const elapsed = (now - localClockBaseTimestamp) / 1000;
  return localClockBaseSeconds + elapsed;
}

function renderClockFromLocalState(): void {
  const clockEl = document.getElementById("game-clock");
  if (!clockEl) return;
  const clockText = formatClock(getLocalClockSeconds());
  if (clockText !== lastRenderedClock) {
    clockEl.textContent = clockText;
    lastRenderedClock = clockText;
  }
}

function startLocalClock(): void {
  if (localClockTimer !== null) return;
  localClockTimer = window.setInterval(renderClockFromLocalState, 250);
}

function stopLocalClock(): void {
  if (localClockTimer !== null) {
    window.clearInterval(localClockTimer);
    localClockTimer = null;
  }
}

function setLocalClock(seconds: number): void {
  localClockBaseSeconds = Math.max(0, seconds);
  localClockBaseTimestamp = Date.now();
  renderClockFromLocalState();
}

function getTimerPayload(timer: unknown): TimerState {
  const fallback: TimerState = {
    running: false,
    offset_seconds: 0,
    base_offset_seconds: 0,
    running_started_at_unix_ms: null,
  };
  if (!timer || typeof timer !== "object") {
    return fallback;
  }
  const typed = timer as {
    running?: unknown;
    offset_seconds?: unknown;
    base_offset_seconds?: unknown;
    running_started_at_unix_ms?: unknown;
  };
  return {
    running: typeof typed.running === "boolean" ? typed.running : false,
    offset_seconds: typeof typed.offset_seconds === "number" ? typed.offset_seconds : 0,
    base_offset_seconds:
      typeof typed.base_offset_seconds === "number" ? typed.base_offset_seconds : undefined,
    running_started_at_unix_ms:
      typeof typed.running_started_at_unix_ms === "number" ? typed.running_started_at_unix_ms : null,
  };
}

function getTimerSignature(timer: TimerState): string {
  const base = timer.base_offset_seconds ?? timer.offset_seconds ?? 0;
  const start = timer.running_started_at_unix_ms ?? "none";
  return `${timer.running ? "1" : "0"}|${base}|${start}`;
}

function getClockSecondsFromTimer(timer: TimerState, nowMs = Date.now()): number {
  const base = timer.base_offset_seconds ?? timer.offset_seconds ?? 0;
  if (timer.running && typeof timer.running_started_at_unix_ms === "number") {
    const elapsed = (nowMs - timer.running_started_at_unix_ms) / 1000;
    return Math.max(0, base + elapsed);
  }
  return Math.max(0, timer.offset_seconds ?? base);
}

function applyTimerState(timer: TimerState): void {
  const signature = getTimerSignature(timer);
  if (signature === lastAppliedTimerSignature) {
    return;
  }
  setLocalClock(getClockSecondsFromTimer(timer));
  lastAppliedTimerSignature = signature;
}

function markOverlayEventSeen(id: string): void {
  if (seenOverlayEventIds.has(id)) {
    return;
  }
  seenOverlayEventIds.add(id);
  seenOverlayEventOrder.push(id);
  if (seenOverlayEventOrder.length > 600) {
    const stale = seenOverlayEventOrder.shift();
    if (stale) {
      seenOverlayEventIds.delete(stale);
    }
  }
}

function applyTeamTheme(teams: Snapshot["teams"]): void {
  const root = document.documentElement;
  const home = normalizeHexColor(teams.h.jersey_color) || "#52E0A6";
  const away = normalizeHexColor(teams.a.jersey_color) || "#8CA7FF";
  root.style.setProperty("--team-h-color", home);
  root.style.setProperty("--team-a-color", away);
}

function applyPossessionIndicator(possessionTeamRaw: unknown): void {
  const homeTeamCard = document.getElementById("home-team-card");
  const awayTeamCard = document.getElementById("away-team-card");
  if (!homeTeamCard || !awayTeamCard) {
    return;
  }
  homeTeamCard.classList.remove("is-possession-team");
  awayTeamCard.classList.remove("is-possession-team");

  const possessionTeam: TeamKey | null = isTeamKey(possessionTeamRaw) ? possessionTeamRaw : null;
  if (!possessionTeam) {
    lastPossessionTeam = null;
    return;
  }
  if (possessionTeam === "h") {
    homeTeamCard.classList.add("is-possession-team");
  } else {
    awayTeamCard.classList.add("is-possession-team");
  }
  if (possessionTeam !== lastPossessionTeam) {
    scoreboardAnimator.animatePossessionPulse(possessionTeam);
    lastPossessionTeam = possessionTeam;
  }
}

function formatTimeouts(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.max(0, Math.round(value)));
  }
  if (typeof value === "string") {
    const numeric = Number.parseInt(value, 10);
    if (Number.isFinite(numeric)) {
      return String(Math.max(0, numeric));
    }
    return value.trim() || "0";
  }
  return "0";
}

function renderTimeoutDots(elementId: string, value: unknown): void {
  const container = document.getElementById(elementId);
  if (!container) {
    return;
  }
  const totalDots = 3;
  const activeDots = Math.max(0, Math.min(totalDots, Number.parseInt(formatTimeouts(value), 10) || 0));

  if (container.childElementCount !== totalDots) {
    container.innerHTML = "";
    for (let index = 0; index < totalDots; index += 1) {
      const dot = document.createElement("span");
      dot.className = "timeout-dot";
      dot.setAttribute("aria-hidden", "true");
      container.appendChild(dot);
    }
  }

  const dots = Array.from(container.children);
  dots.forEach((dot, index) => {
    if (!(dot instanceof HTMLElement)) {
      return;
    }
    dot.classList.toggle("is-active", index < activeDots);
  });
}

function animateScoreIfChanged(elementId: string, score: number, animate: boolean): void {
  const element = document.getElementById(elementId) as HTMLElement | null;
  if (!element) {
    return;
  }
  const nextText = String(score ?? 0);
  const currentText = element.textContent ?? "";
  if (!animate || currentText === nextText) {
    element.textContent = nextText;
    return;
  }
  scoreboardAnimator.animateScoreChange(element, nextText);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const bounded = Math.max(0, Math.min(100, value));
  if (bounded === 0) return 0;
  return Math.max(bounded, 6);
}

function ensureStatRow(target: HTMLElement, key: string): HTMLElement {
  let row = target.querySelector<HTMLElement>(`.stat-row[data-key="${key}"]`);
  if (row) {
    return row;
  }
  row = document.createElement("article");
  row.className = "stat-row";
  row.dataset.key = key;
  row.innerHTML = `
    <div class="stat-label"></div>
    <div class="bar-line home-line">
      <span class="bar-value home-value"></span>
      <div class="bar-track"><div class="bar-fill home-fill"></div></div>
    </div>
    <div class="bar-line away-line">
      <div class="bar-track"><div class="bar-fill away-fill"></div></div>
      <span class="bar-value away-value"></span>
    </div>
  `;
  target.appendChild(row);
  return row;
}

function renderStatBarGrid(targetId: string, rows: StatBarRow[]): void {
  const target = document.getElementById(targetId);
  if (!target) return;

  const keys = new Set(rows.map((row) => row.key));
  target.querySelectorAll<HTMLElement>(".stat-row").forEach((row) => {
    if (!keys.has(row.dataset.key || "")) {
      row.remove();
    }
  });

  for (const rowData of rows) {
    const row = ensureStatRow(target, rowData.key);
    const label = row.querySelector(".stat-label") as HTMLElement | null;
    const homeValue = row.querySelector(".home-value") as HTMLElement | null;
    const awayValue = row.querySelector(".away-value") as HTMLElement | null;
    const homeFill = row.querySelector(".home-fill") as HTMLElement | null;
    const awayFill = row.querySelector(".away-fill") as HTMLElement | null;

    if (label) label.textContent = rowData.label;
    if (homeValue) homeValue.textContent = rowData.homeValue;
    if (awayValue) awayValue.textContent = rowData.awayValue;

    const homeWidth = `${clampPercent(rowData.homePercent)}%`;
    const awayWidth = `${clampPercent(rowData.awayPercent)}%`;
    requestAnimationFrame(() => {
      if (homeFill) homeFill.style.width = homeWidth;
      if (awayFill) awayFill.style.width = awayWidth;
    });
  }
}

function ensureAdvancedComparisonRow(target: HTMLElement, key: string): HTMLElement {
  let row = target.querySelector<HTMLElement>(`.advanced-row[data-key="${key}"]`);
  if (row) {
    return row;
  }
  row = document.createElement("article");
  row.className = "advanced-row";
  row.dataset.key = key;
  row.innerHTML = `
    <div class="advanced-home"></div>
    <div class="advanced-label"></div>
    <div class="advanced-away"></div>
  `;
  target.appendChild(row);
  return row;
}

function renderAdvancedComparisonGrid(targetId: string, rows: AdvancedComparisonRow[]): void {
  const target = document.getElementById(targetId);
  if (!target) return;

  const keys = new Set(rows.map((row) => row.key));
  target.querySelectorAll<HTMLElement>(".advanced-row").forEach((row) => {
    if (!keys.has(row.dataset.key || "")) {
      row.remove();
    }
  });

  for (const rowData of rows) {
    const row = ensureAdvancedComparisonRow(target, rowData.key);
    const labelEl = row.querySelector(".advanced-label") as HTMLElement | null;
    const homeEl = row.querySelector(".advanced-home") as HTMLElement | null;
    const awayEl = row.querySelector(".advanced-away") as HTMLElement | null;
    if (labelEl) labelEl.textContent = rowData.label;
    if (homeEl) homeEl.textContent = rowData.homeValue;
    if (awayEl) awayEl.textContent = rowData.awayValue;
  }
}

function setStatsTeamLabels(homeName: string, awayName: string): void {
  const homeLabel = document.getElementById("stats-home-name");
  const awayLabel = document.getElementById("stats-away-name");
  if (homeLabel) homeLabel.textContent = homeName;
  if (awayLabel) awayLabel.textContent = awayName;
}

function formatPercentValue(value: unknown): string {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return "0%";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}%`;
}

function flashUpdate(target: HTMLElement | null): void {
  if (!target) return;
  target.classList.remove("flash-update");
  void target.offsetWidth;
  target.classList.add("flash-update");
}

function renderRoster(tableId: string, roster: Record<string, string>): void {
  const table = document.getElementById(tableId) as HTMLTableElement | null;
  if (!table) return;
  const rows = Object.entries(roster).sort((a, b) => Number(a[0]) - Number(b[0]));
  table.innerHTML = `
    <thead><tr><th>#</th><th>Name</th></tr></thead>
    <tbody>
      ${rows.map(([number, name]) => `<tr><td>${number}</td><td>${name}</td></tr>`).join("")}
    </tbody>
  `;
  flashUpdate(table);
}

function renderPlayerStats(
  tableId: string,
  stats: Record<string, { name: string; goals: number; assists: number; total: number }>,
): void {
  const table = document.getElementById(tableId) as HTMLTableElement | null;
  if (!table) return;
  const rows = Object.entries(stats);
  table.innerHTML = `
    <thead><tr><th>Player</th><th>G</th><th>A</th><th>P</th></tr></thead>
    <tbody>
      ${rows
        .map(
          ([number, line]) =>
            `<tr><td>#${number} ${line.name}</td><td>${line.goals}</td><td>${line.assists}</td><td>${line.total}</td></tr>`,
        )
        .join("")}
    </tbody>
  `;
  flashUpdate(table);
}

function renderMatches(snapshot: Snapshot): void {
  const table = document.getElementById("matches-table") as HTMLTableElement | null;
  if (!table) return;
  const rows = [
    ["Last", snapshot.match_context.last_match],
    ["Current", snapshot.match_context.current_match],
    ["Next", snapshot.match_context.next_match],
    ["Selected", snapshot.match_context.selected_match],
  ] as const;
  table.innerHTML = `
    <thead><tr><th>Slot</th><th>Game</th><th>Teams</th><th>Start</th></tr></thead>
    <tbody>
      ${rows
        .map(([slot, match]) => {
          const teams = match ? `${match.home_name ?? "?"} vs ${match.away_name ?? "?"}` : "-";
          const start = match?.start_time_iso ? new Date(match.start_time_iso).toLocaleTimeString() : "-";
          return `<tr><td>${slot}</td><td>${match?.game_id ?? "-"}</td><td>${teams}</td><td>${start}</td></tr>`;
        })
        .join("")}
    </tbody>
  `;
}

function processOverlayEvents(previousSnapshot: Snapshot | null, nextSnapshot: Snapshot, seedOnly: boolean): void {
  if (viewType !== "scoreboard") {
    return;
  }
  const nextEvents = nextSnapshot.stats.overlay_events ?? [];
  if (nextEvents.length === 0) {
    return;
  }

  if (seedOnly) {
    for (const event of nextEvents) {
      markOverlayEventSeen(event.id);
    }
    return;
  }

  const previousIds = new Set((previousSnapshot?.stats.overlay_events ?? []).map((event) => event.id));
  for (const event of nextEvents) {
    if (previousIds.has(event.id) || seenOverlayEventIds.has(event.id)) {
      continue;
    }
    markOverlayEventSeen(event.id);
    scoreboardAnimator.playEvent(event);
  }
}

function render(snapshot: Snapshot, animate = true): void {
  const homeName = formatTeamName(snapshot.teams.h.full_name, "HOME");
  const awayName = formatTeamName(snapshot.teams.a.full_name, "AWAY");
  applyTeamTheme(snapshot.teams);

  const homeNameEl = document.getElementById("home-name");
  const awayNameEl = document.getElementById("away-name");
  if (homeNameEl) homeNameEl.textContent = homeName;
  if (awayNameEl) awayNameEl.textContent = awayName;

  animateScoreIfChanged("home-score", snapshot.score.home ?? 0, animate);
  animateScoreIfChanged("away-score", snapshot.score.away ?? 0, animate);

  const homeTimeoutsEl = document.getElementById("home-timeouts");
  const awayTimeoutsEl = document.getElementById("away-timeouts");
  if (homeTimeoutsEl) {
    renderTimeoutDots("home-timeouts", snapshot.stats.timeouts.h);
  }
  if (awayTimeoutsEl) {
    renderTimeoutDots("away-timeouts", snapshot.stats.timeouts.a);
  }

  if (viewType === "field_scoreboard") {
    const fieldLabel = document.getElementById("field-label");
    if (fieldLabel) {
      fieldLabel.textContent = `Field ${snapshot.selected_field_id ?? "-"}`;
    }
  }

  applyPossessionIndicator(snapshot.stats.current_possession?.team);

  if (viewType === "stats") {
    setStatsTeamLabels(homeName, awayName);

    const statRows: StatBarRow[] = [
      {
        key: "points",
        label: "Points",
        homeValue: String(snapshot.stats.points.h),
        awayValue: String(snapshot.stats.points.a),
        homePercent: snapshot.stats.points.hp,
        awayPercent: snapshot.stats.points.ap,
      },
      {
        key: "o_points",
        label: "O Points",
        homeValue: String(snapshot.stats.o_points.h),
        awayValue: String(snapshot.stats.o_points.a),
        homePercent: snapshot.stats.o_points.hp,
        awayPercent: snapshot.stats.o_points.ap,
      },
      {
        key: "d_points",
        label: "D Points",
        homeValue: String(snapshot.stats.d_points.h),
        awayValue: String(snapshot.stats.d_points.a),
        homePercent: snapshot.stats.d_points.hp,
        awayPercent: snapshot.stats.d_points.ap,
      },
      {
        key: "possession",
        label: "Disc Possession",
        homeValue: String(snapshot.stats.o_time.h),
        awayValue: String(snapshot.stats.o_time.a),
        homePercent: snapshot.stats.o_time.hp,
        awayPercent: snapshot.stats.o_time.ap,
      },
      {
        key: "turnovers",
        label: "Turnovers",
        homeValue: String(snapshot.stats.turnovers.h),
        awayValue: String(snapshot.stats.turnovers.a),
        homePercent: snapshot.stats.turnovers.hp,
        awayPercent: snapshot.stats.turnovers.ap,
      },
      {
        key: "timeouts",
        label: "Timeouts",
        homeValue: String(snapshot.stats.timeouts.h),
        awayValue: String(snapshot.stats.timeouts.a),
        homePercent: snapshot.stats.timeouts.hp,
        awayPercent: snapshot.stats.timeouts.ap,
      },
    ];

    renderStatBarGrid("stats-grid", statRows);

    renderAdvancedComparisonGrid("advanced-grid", [
      {
        key: "hold_rate",
        label: "Hold Rate",
        homeValue: formatPercentValue(snapshot.stats.advanced_stats.hold_rate.h),
        awayValue: formatPercentValue(snapshot.stats.advanced_stats.hold_rate.a),
      },
      {
        key: "break_rate",
        label: "Break Rate",
        homeValue: formatPercentValue(snapshot.stats.advanced_stats.break_rate.h),
        awayValue: formatPercentValue(snapshot.stats.advanced_stats.break_rate.a),
      },
      {
        key: "scoring_runs",
        label: "Scoring Runs",
        homeValue: String(snapshot.stats.advanced_stats.scoring_runs.h ?? 0),
        awayValue: String(snapshot.stats.advanced_stats.scoring_runs.a ?? 0),
      },
      {
        key: "o_point_share",
        label: "O Point Share",
        homeValue: formatPercentValue(snapshot.stats.o_points.hp),
        awayValue: formatPercentValue(snapshot.stats.o_points.ap),
      },
      {
        key: "d_point_share",
        label: "D Point Share",
        homeValue: formatPercentValue(snapshot.stats.d_points.hp),
        awayValue: formatPercentValue(snapshot.stats.d_points.ap),
      },
    ]);
  }

  if (viewType === "roster") {
    const homeRosterTitle = document.getElementById("home-roster-title");
    const awayRosterTitle = document.getElementById("away-roster-title");
    if (homeRosterTitle) homeRosterTitle.textContent = `${homeName} Roster`;
    if (awayRosterTitle) awayRosterTitle.textContent = `${awayName} Roster`;
    renderRoster("home-roster-table", snapshot.players.h ?? {});
    renderRoster("away-roster-table", snapshot.players.a ?? {});
  }

  if (viewType === "player_stats") {
    const homePlayerTitle = document.getElementById("home-player-title");
    const awayPlayerTitle = document.getElementById("away-player-title");
    if (homePlayerTitle) homePlayerTitle.textContent = `${homeName} Players`;
    if (awayPlayerTitle) awayPlayerTitle.textContent = `${awayName} Players`;
    renderPlayerStats("home-player-table", snapshot.stats.player_stats.h ?? {});
    renderPlayerStats("away-player-table", snapshot.stats.player_stats.a ?? {});
  }

  if (viewType === "matches") {
    renderMatches(snapshot);
  }
}

function sendHeartbeat(): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() }));
  }
}

function connect(): void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    const fieldId = new URLSearchParams(location.search).get("fieldId");
    ws?.send(
      JSON.stringify({
        type: "register",
        clientRole: "obs_view",
        viewType,
        fieldId,
        instanceId: `${viewType}-${Math.random().toString(36).slice(2, 8)}`,
        screenLabel: `${viewType} overlay`,
      }),
    );
    ws?.send(JSON.stringify({ type: "request_snapshot" }));
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
    }
    heartbeatTimer = window.setInterval(sendHeartbeat, 5000);
    startLocalClock();
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data) as JsonObject;

    if (message.type === "snapshot") {
      const previousSnapshot = latestSnapshot;
      latestSnapshot = message.snapshot as Snapshot;
      applyTimerState(getTimerPayload(latestSnapshot.timer));
      processOverlayEvents(previousSnapshot, latestSnapshot, previousSnapshot === null);
      render(latestSnapshot, false);
      return;
    }

    if (message.type === "stats_update") {
      if (!latestSnapshot) {
        return;
      }
      const previousSnapshot = latestSnapshot;
      const previousTimer = latestSnapshot.timer;
      const nextTimer = getTimerPayload(message.timer);
      latestSnapshot = {
        ...latestSnapshot,
        teams: message.teams as Snapshot["teams"],
        score: message.score as Snapshot["score"],
        timer: nextTimer,
        stats: message.stats as Snapshot["stats"],
      };
      if (getTimerSignature(nextTimer) !== getTimerSignature(previousTimer)) {
        applyTimerState(nextTimer);
      }
      render(latestSnapshot, true);
      processOverlayEvents(previousSnapshot, latestSnapshot, false);
    }
  };

  ws.onclose = () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    stopLocalClock();
    reconnectTimer = window.setTimeout(connect, 1500);
  };
}

connect();
