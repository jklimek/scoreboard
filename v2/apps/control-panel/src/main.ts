type JsonObject = Record<string, unknown>;

/** jscolor attaches a .jscolor instance to the input element */
interface JscolorInstance {
  toString(): string;
  fromString(str: string): boolean;
}
interface JscolorInputElement extends HTMLInputElement {
  jscolor?: JscolorInstance;
}

type ViewStatusItem = {
  view_type: string;
  connected_count: number;
  status: "green" | "red";
};

type PollerMetrics = {
  state: string;
  enabled: boolean;
  current_interval_seconds: number;
  total_requests: number;
  error_count: number;
  consecutive_errors: number;
};

type MatchIdentity = {
  game_id?: number | null;
  field_id?: string | null;
  home_name?: string | null;
  away_name?: string | null;
  start_time_iso?: string | null;
};

type TeamState = {
  full_name?: string;
  short_name?: string;
  jersey_color?: string | null;
};

type PlayerLine = {
  name: string;
  goals: number;
  assists: number;
  total: number;
};

type Snapshot = {
  mode: string;
  selected_field_id?: string | null;
  selected_game_id?: number | null;
  poller: PollerMetrics;
  view_status: ViewStatusItem[];
  teams: {
    a: TeamState;
    h: TeamState;
  };
  players: {
    a: Record<string, string>;
    h: Record<string, string>;
  };
  stats: {
    player_stats: {
      a: Record<string, PlayerLine>;
      h: Record<string, PlayerLine>;
    };
  };
  match_context: {
    last_match?: MatchIdentity | null;
    current_match?: MatchIdentity | null;
    next_match?: MatchIdentity | null;
    selected_match?: MatchIdentity | null;
  };
};

const wsStatus = document.getElementById("ws-status") as HTMLDivElement;
const modeSelect = document.getElementById("mode") as HTMLSelectElement;
const fieldInput = document.getElementById("field-id") as HTMLInputElement;
const manualGameInput = document.getElementById("manual-game-id") as HTMLInputElement;
const homeJerseyColorLabel = document.getElementById("home-jersey-color-label") as HTMLLabelElement;
const awayJerseyColorLabel = document.getElementById("away-jersey-color-label") as HTMLLabelElement;
const homeJerseyColorInput = document.getElementById("home-jersey-color") as JscolorInputElement;
const awayJerseyColorInput = document.getElementById("away-jersey-color") as JscolorInputElement;

const pollerState = document.getElementById("poller-state") as HTMLParagraphElement;
const pollerEnabled = document.getElementById("poller-enabled") as HTMLParagraphElement;
const pollerInterval = document.getElementById("poller-interval") as HTMLParagraphElement;
const pollerErrors = document.getElementById("poller-errors") as HTMLParagraphElement;
const pollerRequests = document.getElementById("poller-requests") as HTMLParagraphElement;

const ctxLast = document.getElementById("ctx-last") as HTMLParagraphElement;
const ctxCurrent = document.getElementById("ctx-current") as HTMLParagraphElement;
const ctxNext = document.getElementById("ctx-next") as HTMLParagraphElement;
const ctxSelected = document.getElementById("ctx-selected") as HTMLParagraphElement;

const viewGrid = document.getElementById("view-status-grid") as HTMLDivElement;
const logs = document.getElementById("logs") as HTMLPreElement;

const startButton = document.getElementById("start-loop") as HTMLButtonElement;
const stopButton = document.getElementById("stop-loop") as HTMLButtonElement;
const saveSelectionButton = document.getElementById("save-selection") as HTMLButtonElement;
const customOverlayEnabled = document.getElementById("custom-overlay-enabled") as HTMLInputElement;
const customOverlayTitle = document.getElementById("custom-overlay-title") as HTMLInputElement;
const customOverlayPrimary = document.getElementById("custom-overlay-primary") as HTMLInputElement;
const customOverlaySecondary = document.getElementById("custom-overlay-secondary") as HTMLInputElement;
const customOverlayDisplayMs = document.getElementById("custom-overlay-display-ms") as HTMLInputElement;
const customOverlayTeam = document.getElementById("custom-overlay-team") as HTMLSelectElement;
const customOverlayPlayer = document.getElementById("custom-overlay-player") as HTMLSelectElement;
const customOverlaySend = document.getElementById("custom-overlay-send") as HTMLButtonElement;
const customOverlayClear = document.getElementById("custom-overlay-clear") as HTMLButtonElement;

let ws: WebSocket | null = null;
let heartbeatTimer: number | null = null;
let reconnectTimer: number | null = null;
let latestSnapshot: Snapshot | null = null;
/** Only update jersey color inputs from the first snapshot (initial load). Later snapshots must not overwrite user's picker. */
let jerseyColorsUpdatedFromSnapshot = false;

function appendLog(line: string): void {
  const stamp = new Date().toLocaleTimeString();
  logs.textContent = `[${stamp}] ${line}\n${logs.textContent}`.slice(0, 8000);
}

function formatMatch(identity?: MatchIdentity | null): string {
  if (!identity || !identity.game_id) {
    return "-";
  }
  const teams = [identity.home_name, identity.away_name].filter(Boolean).join(" vs ");
  const start = identity.start_time_iso ? new Date(identity.start_time_iso).toLocaleTimeString() : "n/a";
  return `#${identity.game_id} (${identity.field_id ?? "-"}) ${teams || "teams pending"} @ ${start}`;
}

function normalizeHexColor(raw?: string | null): string | null {
  if (!raw) return null;
  const candidate = raw.trim();
  if (!candidate) return null;
  const matched = /^#?[0-9a-fA-F]{6}$/.test(candidate);
  if (!matched) return null;
  return `#${candidate.replace("#", "").toLowerCase()}`;
}

function applySnapshot(snapshot: Snapshot): void {
  latestSnapshot = snapshot;
  modeSelect.value = snapshot.mode ?? "AUTO";
  fieldInput.value = snapshot.selected_field_id ?? fieldInput.value;
  if (snapshot.selected_game_id) {
    manualGameInput.value = String(snapshot.selected_game_id);
  }
  if (!jerseyColorsUpdatedFromSnapshot) {
    const homeColor = normalizeHexColor(snapshot.teams?.h?.jersey_color);
    const awayColor = normalizeHexColor(snapshot.teams?.a?.jersey_color);
    if (homeColor) {
      const homeHex = homeColor.replace("#", "");
      if (homeJerseyColorInput.jscolor?.fromString(homeHex)) {
        homeJerseyColorInput.value = homeJerseyColorInput.jscolor.toString();
      } else {
        homeJerseyColorInput.value = homeHex;
      }
    }
    if (awayColor) {
      const awayHex = awayColor.replace("#", "");
      if (awayJerseyColorInput.jscolor?.fromString(awayHex)) {
        awayJerseyColorInput.value = awayJerseyColorInput.jscolor.toString();
      } else {
        awayJerseyColorInput.value = awayHex;
      }
    }
    jerseyColorsUpdatedFromSnapshot = true;
  }

  const homeTeamName =
    snapshot.teams?.h?.full_name?.trim() ||
    snapshot.teams?.h?.short_name?.trim() ||
    "Home";
  const awayTeamName =
    snapshot.teams?.a?.full_name?.trim() ||
    snapshot.teams?.a?.short_name?.trim() ||
    "Away";
  homeJerseyColorLabel.textContent = `${homeTeamName} color`;
  awayJerseyColorLabel.textContent = `${awayTeamName} color`;

  pollerState.textContent = snapshot.poller.state;
  pollerEnabled.textContent = `enabled: ${snapshot.poller.enabled ? "yes" : "no"}`;
  pollerInterval.textContent = `${snapshot.poller.current_interval_seconds.toFixed(2)}s`;
  pollerErrors.textContent = `${snapshot.poller.error_count} errors`;
  pollerRequests.textContent = `requests: ${snapshot.poller.total_requests}`;

  ctxLast.textContent = formatMatch(snapshot.match_context.last_match);
  ctxCurrent.textContent = formatMatch(snapshot.match_context.current_match);
  ctxNext.textContent = formatMatch(snapshot.match_context.next_match);
  ctxSelected.textContent = formatMatch(snapshot.match_context.selected_match);

  renderViewStatus(snapshot.view_status ?? []);
  refreshCustomOverlayTeamOptions();
  refreshCustomOverlayPlayers();
}

function renderViewStatus(items: ViewStatusItem[]): void {
  viewGrid.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "view-card";
    card.innerHTML = `
      <span class="view-card-title">${item.view_type}</span>
      <span class="view-light">
        <span class="dot ${item.status}"></span>
        <span class="view-count">${item.connected_count}</span>
      </span>
    `;
    viewGrid.appendChild(card);
  }
}

function sendCommand(command: string, payload: JsonObject = {}): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    appendLog(`Cannot send command '${command}' while websocket is disconnected.`);
    return;
  }
  ws.send(JSON.stringify({ type: "command", command, payload }));
}

function buildPlayerValue(team: "a" | "h", number: string): string {
  return `${team}:${number}`;
}

function parsePlayerValue(value: string): { team: "a" | "h"; number: string } | null {
  const [teamRaw, numberRaw] = value.split(":");
  if ((teamRaw === "a" || teamRaw === "h") && numberRaw) {
    return { team: teamRaw, number: numberRaw };
  }
  return null;
}

function refreshCustomOverlayTeamOptions(): void {
  const snapshot = latestSnapshot;
  const selected = customOverlayTeam.value;
  const homeLabel = snapshot?.teams?.h?.full_name || snapshot?.teams?.h?.short_name || "Home";
  const awayLabel = snapshot?.teams?.a?.full_name || snapshot?.teams?.a?.short_name || "Away";
  customOverlayTeam.innerHTML = [
    '<option value="">None</option>',
    `<option value="h">${escapeHtml(homeLabel)}</option>`,
    `<option value="a">${escapeHtml(awayLabel)}</option>`,
  ].join("");
  if (selected === "h" || selected === "a") {
    customOverlayTeam.value = selected;
  }
}

function escapeHtml(raw: string): string {
  const div = document.createElement("div");
  div.textContent = raw;
  return div.innerHTML;
}

function refreshCustomOverlayPlayers(): void {
  const snapshot = latestSnapshot;
  if (!snapshot) return;

  const filter = customOverlayTeam.value;
  const selected = customOverlayPlayer.value;
  const rows: Array<{ value: string; label: string; total: number }> = [];
  const teams: Array<"h" | "a"> = filter === "h" || filter === "a" ? [filter] : ["h", "a"];
  for (const team of teams) {
    const teamName = snapshot.teams[team]?.full_name || snapshot.teams[team]?.short_name || (team === "h" ? "Home" : "Away");
    const playerStats = snapshot.stats?.player_stats?.[team] ?? {};
    const playerNames = snapshot.players?.[team] ?? {};

    for (const number of Object.keys({ ...playerNames, ...playerStats })) {
      const statLine = playerStats[number];
      const name = statLine?.name || playerNames[number] || `#${number}`;
      const goals = statLine?.goals ?? 0;
      const assists = statLine?.assists ?? 0;
      const total = goals + assists;
      rows.push({
        value: buildPlayerValue(team, number),
        label: `${teamName} · ${name} (G ${goals}, A ${assists})`,
        total,
      });
    }
  }

  rows.sort((a, b) => b.total - a.total);

  customOverlayPlayer.innerHTML = `<option value="">No player selected</option>${rows
    .map((row) => `<option value="${escapeHtml(row.value)}">${escapeHtml(row.label)}</option>`)
    .join("")}`;
  if (rows.some((row) => row.value === selected)) {
    customOverlayPlayer.value = selected;
  }
}

function syncCustomOverlayFieldsWithPlayer(): void {
  const snapshot = latestSnapshot;
  if (!snapshot) return;
  const selectedPlayer = parsePlayerValue(customOverlayPlayer.value);
  if (!selectedPlayer) return;

  const line = snapshot.stats?.player_stats?.[selectedPlayer.team]?.[selectedPlayer.number];
  const playerName =
    line?.name || snapshot.players?.[selectedPlayer.team]?.[selectedPlayer.number] || `#${selectedPlayer.number}`;
  customOverlayPrimary.value = playerName;
  const goals = line?.goals ?? 0;
  const assists = line?.assists ?? 0;
  customOverlaySecondary.value = `#${selectedPlayer.number} · GOALS ${goals} · ASSISTS ${assists}`;
}

async function callControlEndpoint(
  url: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; snapshot?: Snapshot } | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      appendLog(`Control call failed: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = (await response.json()) as { ok: boolean; message: string; snapshot?: Snapshot };
    appendLog(`Control: ${data.message}`);
    if (data.snapshot) {
      applySnapshot(data.snapshot);
    } else {
      ws?.send(JSON.stringify({ type: "request_snapshot" }));
    }
    return { ok: data.ok, snapshot: data.snapshot };
  } catch (error) {
    appendLog(`Control call error: ${String(error)}`);
    return null;
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer);
  }
  heartbeatTimer = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() }));
    }
  }, 5000);
}

function connectWebsocket(): void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  wsStatus.textContent = "WS: connecting";

  ws.onopen = () => {
    wsStatus.textContent = "WS: connected";
    ws?.send(
      JSON.stringify({
        type: "register",
        clientRole: "control_panel",
        instanceId: "control-panel-main",
        screenLabel: "Operator station",
      }),
    );
    ws?.send(JSON.stringify({ type: "request_snapshot" }));
    startHeartbeat();
    appendLog("Websocket connected.");
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data) as JsonObject;
    const type = String(message.type ?? "");
    if (type === "snapshot") {
      applySnapshot(message.snapshot as Snapshot);
    } else if (type === "view_status") {
      renderViewStatus((message.items as ViewStatusItem[]) ?? []);
    } else if (type === "poller_status") {
      const poller = message.poller as PollerMetrics;
      pollerState.textContent = poller.state;
      pollerEnabled.textContent = `enabled: ${poller.enabled ? "yes" : "no"}`;
      pollerInterval.textContent = `${poller.current_interval_seconds.toFixed(2)}s`;
      pollerErrors.textContent = `${poller.error_count} errors`;
      pollerRequests.textContent = `requests: ${poller.total_requests}`;
    } else if (type === "match_update") {
      const context = message.context as Snapshot["match_context"];
      ctxLast.textContent = formatMatch(context.last_match);
      ctxCurrent.textContent = formatMatch(context.current_match);
      ctxNext.textContent = formatMatch(context.next_match);
      ctxSelected.textContent = formatMatch(context.selected_match);
    } else if (type === "command_result") {
      appendLog(`Command result: ${String(message.message ?? "ok")}`);
      ws?.send(JSON.stringify({ type: "request_snapshot" }));
    } else if (type === "log") {
      appendLog(`${String(message.level ?? "info").toUpperCase()}: ${String(message.message ?? "")}`);
    }
  };

  ws.onerror = () => {
    wsStatus.textContent = "WS: error";
  };

  ws.onclose = () => {
    wsStatus.textContent = "WS: disconnected";
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    reconnectTimer = window.setTimeout(connectWebsocket, 1500);
    appendLog("Websocket disconnected. Reconnecting...");
  };
}

saveSelectionButton.addEventListener("click", () => {
  sendCommand("set_mode", { mode: modeSelect.value });
  if (fieldInput.value.trim()) {
    sendCommand("set_field", { field_id: fieldInput.value.trim() });
  }
  if (modeSelect.value === "MANUAL" && manualGameInput.value.trim()) {
    sendCommand("set_manual_match", { game_id: Number(manualGameInput.value) });
  }
  const homeRaw =
    homeJerseyColorInput.jscolor?.toString() ?? homeJerseyColorInput.value.trim();
  const awayRaw =
    awayJerseyColorInput.jscolor?.toString() ?? awayJerseyColorInput.value.trim();
  const homeColor = normalizeHexColor(homeRaw);
  const awayColor = normalizeHexColor(awayRaw);
  if (homeColor) {
    sendCommand("set_team_color", { team: "h", jersey_color: homeColor });
  }
  if (awayColor) {
    sendCommand("set_team_color", { team: "a", jersey_color: awayColor });
  }
});

customOverlayTeam.addEventListener("change", () => {
  refreshCustomOverlayPlayers();
});

customOverlayPlayer.addEventListener("change", () => {
  syncCustomOverlayFieldsWithPlayer();
});

customOverlaySend.addEventListener("click", () => {
  const enabled = customOverlayEnabled.checked;
  const playerSelection = parsePlayerValue(customOverlayPlayer.value);
  const displayMs = Number.parseInt(customOverlayDisplayMs.value || "6500", 10);
  sendCommand("emit_custom_overlay", {
    enabled,
    title: customOverlayTitle.value.trim() || "INFO",
    primary_text: customOverlayPrimary.value.trim(),
    secondary_text: customOverlaySecondary.value.trim(),
    display_ms: Number.isFinite(displayMs) ? displayMs : 6500,
    player_team: playerSelection?.team ?? null,
    player_number: playerSelection?.number ?? null,
  });
});

customOverlayClear.addEventListener("click", () => {
  sendCommand("clear_custom_overlay", {});
});

customOverlayEnabled.addEventListener("change", () => {
  if (!customOverlayEnabled.checked) {
    sendCommand("clear_custom_overlay", {});
  }
});

startButton.addEventListener("click", async () => {
  const manualId = Number(manualGameInput.value.trim());
  if (Number.isFinite(manualId) && manualId > 0) {
    await callControlEndpoint("/api/v1/control/manual-game", { game_id: manualId });
  }
  await callControlEndpoint("/api/v1/control/start");
});

stopButton.addEventListener("click", async () => {
  // REST fallback avoids relying solely on websocket command handling.
  await callControlEndpoint("/api/v1/control/stop");
});

async function bootstrap(): Promise<void> {
  connectWebsocket();
  try {
    const response = await fetch("/api/v1/snapshot");
    if (response.ok) {
      const snapshot = (await response.json()) as Snapshot;
      applySnapshot(snapshot);
    }
  } catch (error) {
    appendLog(`Failed to fetch initial snapshot: ${String(error)}`);
  }
}

void bootstrap();

export {};
