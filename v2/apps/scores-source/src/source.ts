// One Scores live client per document for a stream profile, reduced to typed presentation state.
// Q77 policy: a lost connection or a transient refusal keeps the last game (degraded, clock keeps
// running locally), a removal or refusal clears it at once (unavailable); the two are never
// confused. The status follows the client's `open` callback (W31-D13). Live moments are passed on
// only when they belong to the shown game (W31-D7); replayed moments never are.
import { createClockTicker, createLiveClient } from "../../../vendor/scores-live-client/live-client.js";
import type { LiveClient, LiveClientOptions } from "../../../vendor/scores-live-client/live-client.js";
import type { ConfigResult, SetupProblem } from "./config.ts";
import { readGameSnapshot } from "./game.ts";
import type { GameSnapshot } from "./game.ts";
import { readMoment } from "./moments.ts";
import type { Moment } from "./moments.ts";

export type SourceStatus = "setup-error" | "connecting" | "live" | "degraded" | "unavailable" | "error";
/** Why the status is `error` or `degraded` (`limit`, `rate-limited`, `not-ready`: transient). */
export type SourceProblem = SetupProblem | "invalid-snapshot" | "protocol" | "limit" | "rate-limited" | "not-ready";

export interface SourceState {
  readonly status: SourceStatus;
  /** The authoritative game; null whenever nothing may be shown. */
  readonly game: GameSnapshot | null;
  readonly problem: SourceProblem | null;
}

export interface SourceUpdate {
  readonly previous: SourceState;
  readonly state: SourceState;
  /**
   * A snapshot that arrived while live (not the first one, not the first after a reconnect): it may
   * bump the score and admit banners; the others are baselines.
   */
  readonly liveSnapshot: boolean;
}

/** A live moment of the shown game (W31-D7), with that game's snapshot. */
export interface SourceMoment {
  readonly moment: Moment;
  readonly game: GameSnapshot;
  readonly version: number;
}

export interface ScoresSourceOptions {
  onUpdate?(update: SourceUpdate): void;
  /** Live moments whose game is established; never replays, never while not `live`. */
  onMoment?(event: SourceMoment): void;
  /** Passed through to `createLiveClient` (tests, other runtimes). */
  WebSocket?: LiveClientOptions["WebSocket"];
  fetch?: LiveClientOptions["fetch"];
  random?: LiveClientOptions["random"];
}

export interface ScoresSource {
  readonly state: SourceState;
  /** Followed channels (only `stream:{slug}:game` for the scorebug). */
  readonly channels: readonly string[];
  /** Estimated Scores time in ms (local time until the first envelope). */
  serverNow(): number;
  /** Calls `onTick(elapsedMs)` from the current game clock until the returned stop is called. */
  tickClock(onTick: (elapsedMs: number) => void, intervalMs?: number): () => void;
  close(): void;
}

export const gameChannel = (profile: string) => `stream:${profile}:game`;

export function createScoresSource(config: ConfigResult, options: ScoresSourceOptions = {}): ScoresSource {
  let state: SourceState = config.ok
    ? { status: "connecting", game: null, problem: null }
    : { status: "setup-error", game: null, problem: config.problem };
  if (!config.ok)
    return {
      get state() {
        return state;
      },
      channels: [],
      serverNow: () => Date.now(),
      tickClock: () => () => {},
      close() {},
    };

  const channel = gameChannel(config.config.profile);
  /** A socket has opened at least once: later connection loss is degraded, not connecting. */
  let opened = false;
  /** Reconnected: the next snapshot resynchronizes (or cannot be told apart from it); it must not animate. */
  let resyncing = false;
  /** Envelope version of the shown game's snapshot. */
  let gameVersion = 0;
  let closed = false;

  const set = (next: SourceState, liveSnapshot = false) => {
    const previous = state;
    if (previous.status === next.status && previous.game === next.game && previous.problem === next.problem)
      return;
    state = next;
    options.onUpdate?.({ previous, state, liveSnapshot });
  };
  const clear = (status: SourceStatus, problem: SourceProblem | null = null) => {
    resyncing = false;
    set({ status, game: null, problem });
  };
  /** Keeps whatever is shown (Q77); never revives a cleared or failed state. */
  const degrade = (problem: SourceProblem | null) => {
    if (state.status === "live" || state.status === "connecting" || state.status === "degraded")
      set({ status: "degraded", game: state.game, problem: problem ?? state.problem });
  };

  const client: LiveClient = createLiveClient({
    baseUrl: config.config.origin,
    channels: [channel],
    key: config.config.key,
    // WebSocket only: the key travels in the first frame, never in an SSE query string.
    transport: "ws",
    ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.random ? { random: options.random } : {}),
    onStatus(status) {
      if (closed) return;
      if (status.state === "open") {
        const wasDegraded = state.status === "degraded";
        opened = true;
        if (wasDegraded) {
          resyncing = state.game !== null;
          set({ status: state.game ? "live" : "connecting", game: state.game, problem: null });
        }
      } else if (status.state === "reconnecting" && opened) degrade(null);
    },
    onSnapshot(name, data, message) {
      if (closed || name !== channel) return;
      const game = readGameSnapshot(data);
      if (!game) return clear("error", "invalid-snapshot");
      const liveSnapshot = state.status === "live" && state.game !== null && !resyncing;
      resyncing = false;
      gameVersion = message.version;
      set({ status: "live", game, problem: null }, liveSnapshot);
    },
    onMoment(name, data, message) {
      // W31-D7: moments carry no game id. The hub publishes a channel in version order, a switched
      // game's earlier moments are part of its first snapshot, and the client drops live moments
      // not newer than its latest snapshot, so a live moment newer than the shown snapshot, while
      // that snapshot is still the client's latest, belongs to the shown game. Anything else is
      // dropped. It never ends the post-reconnect bump suppression (only a snapshot does).
      if (closed || name !== channel || state.status !== "live" || !state.game) return;
      if (!(message.version > gameVersion) || client.get(channel)?.version !== gameVersion) return;
      const moment = readMoment(data);
      if (moment) options.onMoment?.({ moment, game: state.game, version: message.version });
    },
    onRemoved(name) {
      if (!closed && name === channel) clear("unavailable");
    },
    onError(error) {
      if (closed || (error.channel !== undefined && error.channel !== channel)) return;
      switch (error.code) {
        // A key refused at auth or while connected (revoked, expired, archived: B06-UP) arrives
        // without a channel, a refused channel names it. Never a transport loss.
        case "NOT_FOUND":
          return clear("unavailable");
        // Transient: the client closes or retries and resumes; the board keeps its data.
        case "LIMIT":
          return degrade("limit");
        case "RATE_LIMITED":
          return degrade("rate-limited");
        case "NOT_READY":
          return degrade("not-ready");
        // A protocol mismatch: surfaced to the operator, the last game stays on air (Q77).
        case "VALIDATION_ERROR":
          if (state.game) return degrade("protocol");
          if (state.status !== "unavailable") clear("error", "protocol");
      }
    },
  });

  return {
    get state() {
      return state;
    },
    channels: [channel],
    serverNow: () => client.serverNow(),
    tickClock: (onTick, intervalMs) => createClockTicker(client, () => state.game?.clock, onTick, intervalMs),
    close() {
      closed = true;
      client.close();
    },
  };
}
