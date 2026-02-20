// apps/commentator-hub/src/main.ts
var teamsTitle = document.getElementById("teams-title");
var homeScore = document.getElementById("home-score");
var awayScore = document.getElementById("away-score");
var gameClock = document.getElementById("game-clock");
var timeline = document.getElementById("timeline");
var homeTable = document.getElementById("home-player-table");
var awayTable = document.getElementById("away-player-table");
var momentumCards = document.getElementById("momentum-cards");
var notes = document.getElementById("notes");
var playerFilter = document.getElementById("player-filter");
var ws = null;
var heartbeatTimer = null;
var reconnectTimer = null;
var latestSnapshot = null;
var localClockTimer = null;
var localClockBaseSeconds = 0;
var localClockBaseTimestamp = 0;
var lastRenderedClock = "";
var lastAppliedTimerSignature = "";
var notesStorageKey = "scoreboard-v2-commentator-notes";
notes.value = localStorage.getItem(notesStorageKey) ?? "";
notes.addEventListener("input", () => {
  localStorage.setItem(notesStorageKey, notes.value);
});
function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60).toString().padStart(2, "0");
  const secs = (safe % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}
function getLocalClockSeconds(now = Date.now()) {
  if (localClockBaseTimestamp === 0) {
    return 0;
  }
  const elapsed = (now - localClockBaseTimestamp) / 1e3;
  return localClockBaseSeconds + elapsed;
}
function renderClockFromLocalState() {
  const clockText = formatClock(getLocalClockSeconds());
  if (clockText !== lastRenderedClock) {
    gameClock.textContent = clockText;
    lastRenderedClock = clockText;
  }
}
function startLocalClock() {
  if (localClockTimer !== null) return;
  localClockTimer = window.setInterval(renderClockFromLocalState, 250);
}
function stopLocalClock() {
  if (localClockTimer !== null) {
    window.clearInterval(localClockTimer);
    localClockTimer = null;
  }
}
function setLocalClock(seconds) {
  localClockBaseSeconds = Math.max(0, seconds);
  localClockBaseTimestamp = Date.now();
  renderClockFromLocalState();
}
function getTimerPayload(timer) {
  const fallback = {
    running: false,
    offset_seconds: 0,
    base_offset_seconds: 0,
    running_started_at_unix_ms: null
  };
  if (!timer || typeof timer !== "object") {
    return fallback;
  }
  const typed = timer;
  return {
    running: typeof typed.running === "boolean" ? typed.running : false,
    offset_seconds: typeof typed.offset_seconds === "number" ? typed.offset_seconds : 0,
    base_offset_seconds: typeof typed.base_offset_seconds === "number" ? typed.base_offset_seconds : void 0,
    running_started_at_unix_ms: typeof typed.running_started_at_unix_ms === "number" ? typed.running_started_at_unix_ms : null
  };
}
function getTimerSignature(timer) {
  const base = timer.base_offset_seconds ?? timer.offset_seconds ?? 0;
  const start = timer.running_started_at_unix_ms ?? "none";
  return `${timer.running ? "1" : "0"}|${base}|${start}`;
}
function getClockSecondsFromTimer(timer, nowMs = Date.now()) {
  const base = timer.base_offset_seconds ?? timer.offset_seconds ?? 0;
  if (timer.running && typeof timer.running_started_at_unix_ms === "number") {
    const elapsed = (nowMs - timer.running_started_at_unix_ms) / 1e3;
    return Math.max(0, base + elapsed);
  }
  return Math.max(0, timer.offset_seconds ?? base);
}
function applyTimerState(timer) {
  const signature = getTimerSignature(timer);
  if (signature === lastAppliedTimerSignature) {
    return;
  }
  setLocalClock(getClockSecondsFromTimer(timer));
  lastAppliedTimerSignature = signature;
}
function renderPlayerTable(table, playerStats) {
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
      ${rows.map(
    ([number, line]) => `
        <tr>
          <td>#${number} ${line.name}</td>
          <td>${line.goals}</td>
          <td>${line.assists}</td>
          <td>${line.total}</td>
        </tr>`
  ).join("")}
    </tbody>
  `;
}
function normalizeEventType(event) {
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
function resolvePlayerLabel(num, playerStats) {
  if (!num || num === "?" || num === "-1" || num === "XX") return "";
  const line = playerStats?.[num];
  return line?.name ? `#${num} ${line.name}` : `#${num}`;
}
function renderTimeline(events, teams, playerStats) {
  const selectedTypes = new Set(
    Array.from(document.querySelectorAll(".checks input:checked")).map(
      (el) => el.value
    )
  );
  const homeLabel = teams?.h.short_name || teams?.h.full_name || "H";
  const awayLabel = teams?.a.short_name || teams?.a.full_name || "A";
  const html = events.slice().reverse().filter((event) => selectedTypes.has(normalizeEventType(event))).map((event) => {
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
      const assistPart = assistNo && assistNo !== "-1" && assistNo !== "XX" ? ` to ${assistLabel}` : "";
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
  }).join("");
  timeline.innerHTML = html || "<li>No events for selected filters.</li>";
}
function renderMomentum(snapshot) {
  const adv = snapshot.stats.advanced_stats;
  const homeLabel = snapshot.teams.h.short_name || snapshot.teams.h.full_name || "Home";
  const awayLabel = snapshot.teams.a.short_name || snapshot.teams.a.full_name || "Away";
  const cards = [
    {
      label: "Hold Rate",
      value: `${homeLabel} ${adv.hold_rate.h ?? 0}% | ${awayLabel} ${adv.hold_rate.a ?? 0}%`
    },
    {
      label: "Break Rate",
      value: `${homeLabel} ${adv.break_rate.h ?? 0}% | ${awayLabel} ${adv.break_rate.a ?? 0}%`
    },
    {
      label: "Scoring Runs",
      value: `${homeLabel} ${adv.scoring_runs.h ?? 0} | ${awayLabel} ${adv.scoring_runs.a ?? 0}`
    },
    {
      label: "Tempo",
      value: `${adv.avg_point_duration ?? 0}s/point`
    },
    {
      label: "Turnovers / Point",
      value: `${adv.turnovers_per_point ?? 0}`
    }
  ];
  momentumCards.innerHTML = cards.map(
    (card) => `
      <div class="momentum-card">
        <p>${card.label}</p>
        <strong>${card.value}</strong>
      </div>`
  ).join("");
}
function applySnapshot(snapshot) {
  latestSnapshot = snapshot;
  teamsTitle.textContent = `${snapshot.teams.h.full_name || "HOME"} vs ${snapshot.teams.a.full_name || "AWAY"}`;
  homeScore.textContent = String(snapshot.score.home ?? 0);
  awayScore.textContent = String(snapshot.score.away ?? 0);
  applyTimerState(getTimerPayload(snapshot.timer));
  renderPlayerTable(homeTable, snapshot.stats.player_stats.h ?? {});
  renderPlayerTable(awayTable, snapshot.stats.player_stats.a ?? {});
  renderTimeline(snapshot.stats.game_events ?? [], snapshot.teams, snapshot.stats.player_stats);
  renderMomentum(snapshot);
}
function sendHeartbeat() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "heartbeat", timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
  }
}
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.onopen = () => {
    ws?.send(
      JSON.stringify({
        type: "register",
        clientRole: "commentator_hub",
        instanceId: "commentator-main",
        screenLabel: "Commentator screen"
      })
    );
    ws?.send(JSON.stringify({ type: "request_snapshot" }));
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
    }
    heartbeatTimer = window.setInterval(sendHeartbeat, 5e3);
    startLocalClock();
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") {
      const snapshot = message.snapshot;
      snapshot.timer = getTimerPayload(snapshot.timer);
      applySnapshot(snapshot);
    } else if (message.type === "stats_update" && latestSnapshot) {
      latestSnapshot.stats = message.stats;
      latestSnapshot.score = message.score;
      latestSnapshot.timer = getTimerPayload(message.timer);
      latestSnapshot.teams = message.teams;
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
document.querySelectorAll(".checks input").forEach((element) => {
  element.addEventListener("change", () => {
    if (latestSnapshot) {
      renderTimeline(
        latestSnapshot.stats.game_events ?? [],
        latestSnapshot.teams,
        latestSnapshot.stats.player_stats
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
//# sourceMappingURL=main.js.map
