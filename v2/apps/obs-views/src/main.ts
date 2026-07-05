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
  logo_url?: string | null;
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
      top_contributors?: {
        h?: PlayerContributor[];
        a?: PlayerContributor[];
      };
    };
  };
  match_context: {
    last_match?: MatchIdentity;
    current_match?: MatchIdentity;
    next_match?: MatchIdentity;
    selected_match?: MatchIdentity;
  };
};

type PlayerContributor = {
  number?: string;
  name: string;
  total: number;
  goals: number;
  assists: number;
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

function applyTeamLogo(elementId: string, url?: string | null): void {
  const el = document.getElementById(elementId) as HTMLImageElement | null;
  if (!el) {
    return;
  }
  const src = typeof url === "string" ? url.trim() : "";
  if (src) {
    if (el.getAttribute("src") !== src) {
      el.src = src;
    }
    el.hidden = false;
  } else {
    el.removeAttribute("src");
    el.hidden = true;
  }
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
    <span class="stat-num home-value"></span>
    <div class="stat-meter">
      <div class="stat-label"></div>
      <div class="bar-track">
        <div class="bar-fill home-fill"></div>
        <div class="bar-fill away-fill"></div>
      </div>
    </div>
    <span class="stat-num away-value"></span>
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

    const homeShare = clampPercent(rowData.homePercent);
    const awayShare = clampPercent(rowData.awayPercent);
    row.classList.toggle("leads-home", rowData.homePercent > rowData.awayPercent);
    row.classList.toggle("leads-away", rowData.awayPercent > rowData.homePercent);
    requestAnimationFrame(() => {
      if (homeFill) homeFill.style.width = `${homeShare}%`;
      if (awayFill) awayFill.style.width = `${awayShare}%`;
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
  const homeHead = document.getElementById("leaders-home-head");
  const awayHead = document.getElementById("leaders-away-head");
  if (homeHead) homeHead.textContent = homeName;
  if (awayHead) awayHead.textContent = awayName;
}

function setBoardTeamLabels(prefix: string, homeName: string, awayName: string): void {
  const homeEl = document.getElementById(`${prefix}-home-name`);
  const awayEl = document.getElementById(`${prefix}-away-name`);
  if (homeEl) homeEl.textContent = homeName;
  if (awayEl) awayEl.textContent = awayName;
}

function renderTeamLeaders(targetId: string, leaders: PlayerContributor[], side: "home" | "away"): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  const top = leaders.slice(0, 3);
  if (top.length === 0) {
    target.innerHTML = `<div class="leader-empty">No scoring yet</div>`;
    return;
  }
  target.innerHTML = top
    .map((player, index) => {
      const numberTag = player.number ? `#${player.number}` : "";
      return `
        <div class="leader-row${index === 0 ? " is-top" : ""}">
          <span class="leader-name"><span class="leader-rank">${numberTag}</span>${player.name}</span>
          <span class="leader-line">
            <span class="leader-pill leader-pill--total">${player.total}<small>P</small></span>
            <span class="leader-pill">${player.goals}<small>G</small></span>
            <span class="leader-pill">${player.assists}<small>A</small></span>
          </span>
        </div>
      `;
    })
    .join("");
  target.dataset.side = side;
}

function formatPercentValue(value: unknown): string {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return "0%";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}%`;
}

function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || Number.isFinite(seconds) === false || seconds <= 0) {
    return "--";
  }
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function flashUpdate(target: HTMLElement | null): void {
  if (!target) return;
  target.classList.remove("flash-update");
  void target.offsetWidth;
  target.classList.add("flash-update");
}

function renderRoster(listId: string, roster: Record<string, string>): void {
  const list = document.getElementById(listId);
  if (!list) return;
  const rows = Object.entries(roster).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (rows.length === 0) {
    list.innerHTML = `<div class="leader-empty">No roster</div>`;
    return;
  }
  list.innerHTML = rows
    .map(
      ([number, name]) => `
        <div class="player-row">
          <span class="player-id">#${number}</span>
          <span class="player-name">${name}</span>
        </div>
      `,
    )
    .join("");
  flashUpdate(list);
}

function renderPlayerStats(
  listId: string,
  stats: Record<string, { name: string; goals: number; assists: number; total: number }>,
): void {
  const list = document.getElementById(listId);
  if (!list) return;
  const rows = Object.entries(stats)
    .sort(
      ([, a], [, b]) => b.total - a.total || b.goals - a.goals || b.assists - a.assists,
    )
    .slice(0, 5);
  if (rows.length === 0) {
    list.innerHTML = `<div class="leader-empty">No scoring yet</div>`;
    return;
  }
  list.innerHTML = rows
    .map(
      ([number, line], index) => `
        <div class="player-row${index === 0 ? " is-top" : ""}">
          <span class="player-id">#${number}</span>
          <span class="player-name">${line.name}</span>
          <span class="leader-line">
            <span class="leader-pill leader-pill--total">${line.total}<small>P</small></span>
            <span class="leader-pill">${line.goals}<small>G</small></span>
            <span class="leader-pill">${line.assists}<small>A</small></span>
          </span>
        </div>
      `,
    )
    .join("");
  flashUpdate(list);
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

  applyTeamLogo("home-logo", snapshot.teams.h.logo_url);
  applyTeamLogo("away-logo", snapshot.teams.a.logo_url);

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
    applyTeamLogo("stats-home-logo", snapshot.teams.h.logo_url);
    applyTeamLogo("stats-away-logo", snapshot.teams.a.logo_url);

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

    renderTeamLeaders("home-leaders", snapshot.stats.advanced_stats.top_contributors?.h ?? [], "home");
    renderTeamLeaders("away-leaders", snapshot.stats.advanced_stats.top_contributors?.a ?? [], "away");

    const avgDurationEl = document.getElementById("tempo-avg-point");
    if (avgDurationEl) {
      avgDurationEl.textContent = formatDuration(snapshot.stats.advanced_stats.avg_point_duration);
    }
    const toPerPointEl = document.getElementById("tempo-to-per-point");
    if (toPerPointEl) {
      const value = snapshot.stats.advanced_stats.turnovers_per_point;
      toPerPointEl.textContent =
        typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "--";
    }
  }

  if (viewType === "roster") {
    setBoardTeamLabels("roster", homeName, awayName);
    applyTeamLogo("roster-home-logo", snapshot.teams.h.logo_url);
    applyTeamLogo("roster-away-logo", snapshot.teams.a.logo_url);
    renderRoster("home-roster-list", snapshot.players.h ?? {});
    renderRoster("away-roster-list", snapshot.players.a ?? {});
  }

  if (viewType === "player_stats") {
    setBoardTeamLabels("player", homeName, awayName);
    applyTeamLogo("player-home-logo", snapshot.teams.h.logo_url);
    applyTeamLogo("player-away-logo", snapshot.teams.a.logo_url);
    renderPlayerStats("home-player-list", snapshot.stats.player_stats.h ?? {});
    renderPlayerStats("away-player-list", snapshot.stats.player_stats.a ?? {});
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
