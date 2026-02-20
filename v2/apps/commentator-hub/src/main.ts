type JsonObject = Record<string, unknown>;

type PlayerLine = {
  name: string;
  goals: number;
  assists: number;
  total: number;
};

type Snapshot = {
  teams: {
    h: { full_name: string; short_name: string };
    a: { full_name: string; short_name: string };
  };
  score: { home: number; away: number };
  timer: {
    running: boolean;
    offset_seconds: number;
    base_offset_seconds?: number;
    running_started_at_unix_ms?: number | null;
  };
  stats: {
    player_stats: { h: Record<string, PlayerLine>; a: Record<string, PlayerLine> };
    game_events: Array<Record<string, unknown>>;
    advanced_stats: {
      hold_rate: Record<string, number>;
      break_rate: Record<string, number>;
      scoring_runs: Record<string, number>;
      turnovers_per_point: number;
      avg_point_duration: number;
      top_contributors: {
        h: Array<{ number: string; name: string; total: number; goals: number; assists: number }>;
        a: Array<{ number: string; name: string; total: number; goals: number; assists: number }>;
      };
    };
  };
};

const teamsTitle = document.getElementById("teams-title") as HTMLHeadingElement;
const homeScore = document.getElementById("home-score") as HTMLSpanElement;
const awayScore = document.getElementById("away-score") as HTMLSpanElement;
const gameClock = document.getElementById("game-clock") as HTMLDivElement;
const timeline = document.getElementById("timeline") as HTMLUListElement;
const homeTable = document.getElementById("home-player-table") as HTMLTableElement;
const awayTable = document.getElementById("away-player-table") as HTMLTableElement;
const momentumCards = document.getElementById("momentum-cards") as HTMLDivElement;
const notes = document.getElementById("notes") as HTMLTextAreaElement;
const playerFilter = document.getElementById("player-filter") as HTMLInputElement;

let ws: WebSocket | null = null;
let heartbeatTimer: number | null = null;
let reconnectTimer: number | null = null;
let latestSnapshot: Snapshot | null = null;
let localClockTimer: number | null = null;
let localClockBaseSeconds = 0;
let localClockBaseTimestamp = 0;
let lastRenderedClock = "";
let lastAppliedTimerSignature = "";

const notesStorageKey = "scoreboard-v2-commentator-notes";
notes.value = localStorage.getItem(notesStorageKey) ?? "";
notes.addEventListener("input", () => {
  localStorage.setItem(notesStorageKey, notes.value);
});

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const secs = (safe % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function getLocalClockSeconds(now = Date.now()): number {
  if (localClockBaseTimestamp === 0) {
    return 0;
  }
  const elapsed = (now - localClockBaseTimestamp) / 1000;
  return localClockBaseSeconds + elapsed;
}

function renderClockFromLocalState(): void {
  const clockText = formatClock(getLocalClockSeconds());
  if (clockText !== lastRenderedClock) {
    gameClock.textContent = clockText;
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

function getTimerPayload(timer: unknown): Snapshot["timer"] {
  const fallback: Snapshot["timer"] = {
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

function getTimerSignature(timer: Snapshot["timer"]): string {
  const base = timer.base_offset_seconds ?? timer.offset_seconds ?? 0;
  const start = timer.running_started_at_unix_ms ?? "none";
  return `${timer.running ? "1" : "0"}|${base}|${start}`;
}

function getClockSecondsFromTimer(timer: Snapshot["timer"], nowMs = Date.now()): number {
  const base = timer.base_offset_seconds ?? timer.offset_seconds ?? 0;
  if (timer.running && typeof timer.running_started_at_unix_ms === "number") {
    const elapsed = (nowMs - timer.running_started_at_unix_ms) / 1000;
    return Math.max(0, base + elapsed);
  }
  return Math.max(0, timer.offset_seconds ?? base);
}

function applyTimerState(timer: Snapshot["timer"]): void {
  const signature = getTimerSignature(timer);
  if (signature === lastAppliedTimerSignature) {
    return;
  }
  setLocalClock(getClockSecondsFromTimer(timer));
  lastAppliedTimerSignature = signature;
}

function renderPlayerTable(table: HTMLTableElement, playerStats: Record<string, PlayerLine>): void {
  const filter = playerFilter.value.trim().toLowerCase();
  const rows = Object.entries(playerStats).filter(([number, line]) => {
    if (!filter) {
      return true;
    }
    return number.includes(filter) || line.name.toLowerCase().includes(filter);
  });

  table.innerHTML = `
    <thead>
      <tr><th>Player</th><th>G</th><th>A</th><th>P</th></tr>
    </thead>
    <tbody>
      ${rows
        .map(
          ([number, line]) => `
        <tr>
          <td>#${number} ${line.name}</td>
          <td>${line.goals}</td>
          <td>${line.assists}</td>
          <td>${line.total}</td>
        </tr>`,
        )
        .join("")}
    </tbody>
  `;
}

function normalizeEventType(event: Record<string, unknown>): string {
  const subtype = String(event.subtype ?? "");
  if (subtype) {
    return subtype;
  }
  const y = String(event.y ?? "");
  if (y === "S") return "score";
  if (y === "T") return "turnover";
  if (y === "TO") return "timeout";
  if (y === "O") return "offence";
  if (y === "E") return "end";
  if (y === "H") return "halftime";
  return "event";
}

function resolvePlayerLabel(
  num: string,
  playerStats: Record<string, PlayerLine> | undefined,
): string {
  if (!num || num === "?" || num === "-1" || num === "XX") return "";
  const line = playerStats?.[num];
  return line?.name ? `#${num} ${line.name}` : `#${num}`;
}

function renderTimeline(
  events: Array<Record<string, unknown>>,
  teams?: Snapshot["teams"],
  playerStats?: Snapshot["stats"]["player_stats"],
): void {
  const selectedTypes = new Set(
    Array.from(document.querySelectorAll<HTMLInputElement>(".checks input:checked")).map(
      (el) => el.value,
    ),
  );
  const homeLabel = teams?.h.short_name || teams?.h.full_name || "H";
  const awayLabel = teams?.a.short_name || teams?.a.full_name || "A";

  const html = events
    .slice()
    .reverse()
    .filter((event) => selectedTypes.has(normalizeEventType(event)))
    .map((event) => {
      const type = normalizeEventType(event);
      const t = Number(event.t ?? 0);
      const sideKey = String(event.e ?? event.side ?? "").toUpperCase();
      const sideLabel = sideKey === "H" ? homeLabel : sideKey === "A" ? awayLabel : sideKey;
      let summary = type.toUpperCase();
      if (type === "score") {
        const scorerNo = String(event.s ?? event.data?.scorer_no ?? "?");
        const assistNo = String(event.a ?? event.data?.assist_no ?? "?");
        const stats = sideKey === "H" ? playerStats?.h : playerStats?.a;
        const scorerLabel = resolvePlayerLabel(scorerNo, stats) || `#${scorerNo}`;
        const assistLabel = resolvePlayerLabel(assistNo, stats) || `#${assistNo}`;
        const assistPart =
          assistNo && assistNo !== "-1" && assistNo !== "XX"
            ? ` to ${assistLabel}`
            : "";
        summary = `SCORE by ${sideLabel} | ${scorerLabel}${assistPart}`;
      } else if (type === "turnover") {
        summary = `TURNOVER by ${sideLabel}`;
      } else if (type === "timeout") {
        summary = `TIMEOUT by ${sideLabel}`;
      } else if (type === "offence") {
        summary = `OFFENCE starts: ${sideLabel}`;
      } else if (type === "halftime") {
        summary = "HALFTIME";
      } else if (type === "end") {
        summary = "END OF GAME";
      }
      return `<li class="${type}"><strong>${formatClock(t)}</strong> - ${summary}</li>`;
    })
    .join("");

  timeline.innerHTML = html || "<li>No events for selected filters.</li>";
}

function renderMomentum(snapshot: Snapshot): void {
  const adv = snapshot.stats.advanced_stats;
  const homeLabel = snapshot.teams.h.short_name || snapshot.teams.h.full_name || "Home";
  const awayLabel = snapshot.teams.a.short_name || snapshot.teams.a.full_name || "Away";
  const cards = [
    {
      label: "Hold Rate",
      value: `${homeLabel} ${adv.hold_rate.h ?? 0}% | ${awayLabel} ${adv.hold_rate.a ?? 0}%`,
    },
    {
      label: "Break Rate",
      value: `${homeLabel} ${adv.break_rate.h ?? 0}% | ${awayLabel} ${adv.break_rate.a ?? 0}%`,
    },
    {
      label: "Scoring Runs",
      value: `${homeLabel} ${adv.scoring_runs.h ?? 0} | ${awayLabel} ${adv.scoring_runs.a ?? 0}`,
    },
    {
      label: "Tempo",
      value: `${adv.avg_point_duration ?? 0}s/point`,
    },
    {
      label: "Turnovers / Point",
      value: `${adv.turnovers_per_point ?? 0}`,
    },
  ];

  momentumCards.innerHTML = cards
    .map(
      (card) => `
      <div class="momentum-card">
        <p>${card.label}</p>
        <strong>${card.value}</strong>
      </div>`,
    )
    .join("");
}

function applySnapshot(snapshot: Snapshot): void {
  latestSnapshot = snapshot;
  teamsTitle.textContent = `${snapshot.teams.h.full_name || "HOME"} vs ${
    snapshot.teams.a.full_name || "AWAY"
  }`;
  homeScore.textContent = String(snapshot.score.home ?? 0);
  awayScore.textContent = String(snapshot.score.away ?? 0);
  applyTimerState(getTimerPayload(snapshot.timer));

  renderPlayerTable(homeTable, snapshot.stats.player_stats.h ?? {});
  renderPlayerTable(awayTable, snapshot.stats.player_stats.a ?? {});
  renderTimeline(snapshot.stats.game_events ?? [], snapshot.teams, snapshot.stats.player_stats);
  renderMomentum(snapshot);
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
    ws?.send(
      JSON.stringify({
        type: "register",
        clientRole: "commentator_hub",
        instanceId: "commentator-main",
        screenLabel: "Commentator screen",
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
      const snapshot = message.snapshot as Snapshot;
      snapshot.timer = getTimerPayload(snapshot.timer);
      applySnapshot(snapshot);
    } else if (message.type === "stats_update" && latestSnapshot) {
      latestSnapshot.stats = message.stats as Snapshot["stats"];
      latestSnapshot.score = message.score as Snapshot["score"];
      latestSnapshot.timer = getTimerPayload(message.timer);
      latestSnapshot.teams = message.teams as Snapshot["teams"];
      applySnapshot(latestSnapshot);
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

document.querySelectorAll<HTMLInputElement>(".checks input").forEach((element) => {
  element.addEventListener("change", () => {
    if (latestSnapshot) {
      renderTimeline(
        latestSnapshot.stats.game_events ?? [],
        latestSnapshot.teams,
        latestSnapshot.stats.player_stats,
      );
    }
  });
});

playerFilter.addEventListener("input", () => {
  if (latestSnapshot) {
    renderPlayerTable(homeTable, latestSnapshot.stats.player_stats.h ?? {});
    renderPlayerTable(awayTable, latestSnapshot.stats.player_stats.a ?? {});
  }
});

connect();
