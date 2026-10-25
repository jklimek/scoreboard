// Pure scorebug view model over the typed game snapshot (no DOM, no network).
import { clockElapsedMs, formatClock } from "../../../vendor/scores-live-client/live-client.js";
import type { GameClock, GameSnapshot, GameTeam, Hex, Side } from "./game.ts";
import type { SourceUpdate } from "./source.ts";

export interface ScorebugTeam {
  side: Side;
  /** Null when the side has no team yet (render a neutral placeholder). */
  name: string | null;
  abbreviation: string | null;
  colours: { primary: Hex | null; secondary: Hex | null; text: Hex | null };
  /** Absolute logo URL (relative Scores paths resolve against the configured origin). */
  logoUrl: string | null;
  /** Null when the timeout log does not cover the game. */
  timeoutsLeft: number | null;
  timeoutLimit: number;
}

export interface ScorebugModel {
  gameId: string;
  home: ScorebugTeam;
  away: ScorebugTeam;
  /** Null is a missing result, never zero. */
  score: { home: number | null; away: number | null; source: "none" | "observed" | "official" };
  clock: GameClock;
}

/** Placeholder for a missing score; a missing result is never shown as 0. */
export const missingScore = "-";

export function resolveLogoUrl(url: string, origin: string): string | null {
  try {
    const resolved = new URL(url, `${origin}/`);
    return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.href : null;
  } catch {
    return null;
  }
}

function team(side: Side, value: GameTeam | null, game: GameSnapshot, origin: string): ScorebugTeam {
  const timeouts = game.timeouts[side];
  return {
    side,
    name: value?.displayName.trim() || null,
    abbreviation: value?.abbreviation ?? null,
    colours: value ? { ...value.colours } : { primary: null, secondary: null, text: null },
    logoUrl: value?.logo ? resolveLogoUrl(value.logo.small, origin) : null,
    timeoutsLeft: timeouts.left,
    timeoutLimit: timeouts.limit,
  };
}

export function scorebugModel(game: GameSnapshot, origin: string): ScorebugModel {
  return {
    gameId: game.game.id,
    home: team("home", game.teams.home, game, origin),
    away: team("away", game.teams.away, game, origin),
    score: { ...game.score },
    clock: game.clock,
  };
}

export { formatClock };

export const scoreText = (score: number | null) => (score === null ? missingScore : String(score));

export const clockText = (clock: GameClock, serverNowMs: number) =>
  formatClock(clockElapsedMs(clock, serverNowMs));

/**
 * Which score digits may bump: only a changed, known score of the same game in a live snapshot.
 * Never on the first render, a resync after a reconnect, a game switch or after unavailable.
 */
export function scoreBumps(update: SourceUpdate): { home: boolean; away: boolean } {
  const before = update.previous.game;
  const after = update.state.game;
  if (!update.liveSnapshot || !before || !after || before.game.id !== after.game.id)
    return { home: false, away: false };
  const bump = (side: Side) => after.score[side] !== null && after.score[side] !== before.score[side];
  return { home: bump("home"), away: bump("away") };
}
