// Pure scorebug view model over the typed game snapshot (no DOM, no network).
import { clockElapsedMs, formatClock } from "../../../vendor/scores-live-client/live-client.js";
import type { ClockConfidence, GameClock, GameSnapshot, GameTeam, GameTimeouts, Hex, Side } from "./game.ts";
import type { SourceUpdate } from "./source.ts";

export interface ScorebugTeam {
  side: Side;
  /** Null when the side has no team yet (render a neutral placeholder). */
  name: string | null;
  /** Null falls back to the neutral accent. */
  colour: Hex | null;
  /** Logo URL on the configured Scores origin, or null (no logo, or one elsewhere). */
  logoUrl: string | null;
  /** Null when the timeout log does not cover the game. */
  timeoutsLeft: number | null;
  timeoutLimit: number;
  timeouts: TimeoutView;
  /** The team has the disc (`game.possession`); never guessed. */
  possession: boolean;
}

/**
 * Timeouts left of the rule's limit: one dot per timeout up to `maxTimeoutDots`, a `left/limit`
 * count above that, nothing when the log does not cover them or the rule allows none.
 */
export type TimeoutView =
  | { kind: "dots"; active: number; total: number }
  | { kind: "count"; text: string }
  | { kind: "none" };
export const maxTimeoutDots = 5;

export function timeoutView({ left, limit }: GameTimeouts): TimeoutView {
  if (left === null || limit === 0) return { kind: "none" };
  if (limit > maxTimeoutDots) return { kind: "count", text: `${left}/${limit}` };
  return { kind: "dots", active: Math.min(left, limit), total: limit };
}

/** Operator-only signals (diag chip and body attributes), never shown on air. */
export interface OperatorSignals {
  /** `freshness.ageWarning`: the game is in play but its scorer has been silent. */
  stale: boolean;
  clock: ClockConfidence;
}

export interface ScorebugModel {
  gameId: string;
  home: ScorebugTeam;
  away: ScorebugTeam;
  /** Null is a missing result, never zero. */
  score: { home: number | null; away: number | null; source: "none" | "observed" | "official" };
  clock: GameClock;
  /** `game` / `half`: the period the timeout limits count over. */
  timeoutsPer: "game" | "half";
  operator: OperatorSignals;
}

/** Placeholder for a missing score; a missing result is never shown as 0. */
export const missingScore = "-";

/**
 * A logo loads only from the configured Scores origin: relative paths resolve against it; another
 * origin (absolute or protocol-relative), credentials or a non-http(s) scheme mean no logo.
 */
export function resolveLogoUrl(url: string, origin: string): string | null {
  try {
    const resolved = new URL(url, `${origin}/`);
    if (resolved.origin !== origin || !/^https?:$/.test(resolved.protocol)) return null;
    return resolved.username || resolved.password ? null : resolved.href;
  } catch {
    return null;
  }
}

function team(side: Side, value: GameTeam | null, game: GameSnapshot, origin: string): ScorebugTeam {
  const timeouts = game.timeouts[side];
  return {
    side,
    name: value?.displayName.trim() || null,
    colour: value?.primary ?? null,
    logoUrl: value?.logo ? resolveLogoUrl(value.logo, origin) : null,
    timeoutsLeft: timeouts.left,
    timeoutLimit: timeouts.limit,
    timeouts: timeoutView(timeouts),
    possession: game.possession === side,
  };
}

export function scorebugModel(game: GameSnapshot, origin: string): ScorebugModel {
  return {
    gameId: game.gameId,
    home: team("home", game.teams.home, game, origin),
    away: team("away", game.teams.away, game, origin),
    score: { ...game.score },
    clock: game.clock,
    timeoutsPer: game.timeouts.per,
    operator: { stale: game.ageWarning, clock: game.clock.confidence },
  };
}

export { formatClock };

export const scoreText = (score: number | null) => (score === null ? missingScore : String(score));

export const clockText = (clock: GameClock, serverNowMs: number) =>
  formatClock(clockElapsedMs(clock, serverNowMs));

/**
 * Which score digits may bump: only a changed, known score of the same game in a live snapshot.
 * Never on the first render, the first snapshot after a reconnect, a game switch or after unavailable.
 */
export function scoreBumps(update: SourceUpdate): { home: boolean; away: boolean } {
  const before = update.previous.game;
  const after = update.state.game;
  if (!update.liveSnapshot || !before || !after || before.gameId !== after.gameId)
    return { home: false, away: false };
  const bump = (side: Side) => after.score[side] !== null && after.score[side] !== before.score[side];
  return { home: bump("home"), away: bump("away") };
}
