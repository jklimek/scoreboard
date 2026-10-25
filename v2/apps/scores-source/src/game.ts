// The part of the Scores `BroadcastGame` snapshot (contracts `broadcast/game.ts`, B07 team brand)
// that scoreboard views read, with a structural check. Anything else in the payload is ignored.

export type Side = "home" | "away";
export type Hex = string;

export interface GameTeam {
  displayName: string;
  abbreviation: string;
  colours: { primary: Hex | null; secondary: Hex | null; text: Hex | null };
  logo: { small: string; large: string; version: string } | null;
}

export interface GameClock {
  running: boolean;
  elapsedMs: number;
  anchorServerTs: string;
}

export interface GameTimeouts {
  used: number | null;
  left: number | null;
  limit: number;
}

export interface GameSnapshot {
  game: { id: string; name: string; status: string };
  teams: { home: GameTeam | null; away: GameTeam | null };
  /** `null` is a missing result, never zero. `source` names which score is shown. */
  score: { home: number | null; away: number | null; source: "none" | "observed" | "official" };
  timeouts: { home: GameTimeouts; away: GameTimeouts };
  clock: GameClock;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isCountOrNull = (value: unknown) => value === null || isCount(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isHexOrNull = (value: unknown) => value === null || (isString(value) && /^#[0-9a-f]{6}$/.test(value));

function readTeam(value: unknown): GameTeam | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || !isString(value.displayName) || !isString(value.abbreviation)) return undefined;
  const colours = value.colours;
  if (!isObject(colours) || ![colours.primary, colours.secondary, colours.text].every(isHexOrNull))
    return undefined;
  const logo = value.logo;
  if (logo !== null && (!isObject(logo) || !isString(logo.small) || !isString(logo.large) || !isString(logo.version)))
    return undefined;
  return {
    displayName: value.displayName,
    abbreviation: value.abbreviation,
    colours: {
      primary: colours.primary as Hex | null,
      secondary: colours.secondary as Hex | null,
      text: colours.text as Hex | null,
    },
    logo: logo === null ? null : { small: logo.small as string, large: logo.large as string, version: logo.version as string },
  };
}

function readTimeouts(value: unknown): GameTimeouts | undefined {
  if (!isObject(value) || !isCountOrNull(value.used) || !isCountOrNull(value.left) || !isCount(value.limit))
    return undefined;
  return { used: value.used as number | null, left: value.left as number | null, limit: value.limit };
}

/** The typed view of a `stream:{slug}:game` snapshot, or null when the payload is not supported. */
export function readGameSnapshot(data: unknown): GameSnapshot | null {
  if (!isObject(data)) return null;
  const { game, teams, score, timeouts, clock } = data;
  if (!isObject(game) || !isString(game.id) || !isString(game.name) || !isString(game.status)) return null;
  if (!isObject(teams) || !isObject(score) || !isObject(timeouts) || !isObject(clock)) return null;
  const home = readTeam(teams.home);
  const away = readTeam(teams.away);
  if (home === undefined || away === undefined) return null;
  if (!isCountOrNull(score.home) || !isCountOrNull(score.away)) return null;
  if (score.source !== "none" && score.source !== "observed" && score.source !== "official") return null;
  const homeTimeouts = readTimeouts(timeouts.home);
  const awayTimeouts = readTimeouts(timeouts.away);
  if (!homeTimeouts || !awayTimeouts) return null;
  const { running, elapsedMs, anchorServerTs } = clock;
  if (typeof running !== "boolean" || typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0)
    return null;
  if (!isString(anchorServerTs) || !Number.isFinite(Date.parse(anchorServerTs))) return null;
  return {
    game: { id: game.id, name: game.name, status: game.status },
    teams: { home, away },
    score: { home: score.home as number | null, away: score.away as number | null, source: score.source },
    timeouts: { home: homeTimeouts, away: awayTimeouts },
    clock: { running, elapsedMs, anchorServerTs },
  };
}
