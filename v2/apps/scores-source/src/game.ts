// The part of the Scores `BroadcastGame` snapshot (contracts `broadcast/game.ts`, B07 team brand)
// that scoreboard views read, with a structural check. Anything else in the payload is ignored.

export type Side = "home" | "away";
export type Hex = string;

export interface GameTeam {
  displayName: string;
  /** Primary brand colour; null falls back to the neutral accent. */
  primary: Hex | null;
  /** The small logo as published (usually a path on the Scores origin); null without a logo. */
  logo: string | null;
}

export type ClockConfidence = "good" | "uncertain" | "unknown";

export interface GameClock {
  running: boolean;
  elapsedMs: number;
  anchorServerTs: string;
  /** Operator information only (never an on-air marker). */
  confidence: ClockConfidence;
}

export interface GameTimeouts {
  /** Null when the timeout log does not cover the game. */
  left: number | null;
  /** The rule's limit per `per` period (any count, asymmetric between sides). */
  limit: number;
}

/** A public player reference (Q32 names: all null when hidden; `number` is the roster jersey). */
export interface PlayerRef {
  number: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  shortName: string | null;
}

/** A `goal` or `timeout` entry of the public timeline (ids are the moment ids). */
export interface TimelineEntry {
  id: string;
  kind: "goal" | "timeout";
  side: Side;
  /** Goal only; null when the point is not known. */
  scoreAfter: { home: number; away: number } | null;
  scorer: PlayerRef | null;
  assist: PlayerRef | null;
  callahan: boolean;
}

export interface GameSnapshot {
  gameId: string;
  teams: { home: GameTeam | null; away: GameTeam | null };
  /** `null` is a missing result, never zero. `source` names which score is shown. */
  score: { home: number | null; away: number | null; source: "none" | "observed" | "official" };
  /** Current possession; null at BASIC or outside play (never derived from `offence`). */
  possession: Side | null;
  timeouts: { per: "game" | "half"; home: GameTimeouts; away: GameTimeouts };
  clock: GameClock;
  /** The scorer has been silent past the liveness threshold (operator information only). */
  ageWarning: boolean;
  /** Goal and timeout entries of the public timeline, newest last (other kinds dropped). */
  timeline: TimelineEntry[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isCountOrNull = (value: unknown) => value === null || isCount(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringOrNull = (value: unknown) => value === null || isString(value);
const isHexOrNull = (value: unknown) => value === null || (isString(value) && /^#[0-9a-f]{6}$/.test(value));
const isSide = (value: unknown): value is Side => value === "home" || value === "away";

function readTeam(value: unknown): GameTeam | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || !isString(value.displayName)) return undefined;
  const { colours, logo } = value;
  if (!isObject(colours) || !isHexOrNull(colours.primary)) return undefined;
  if (logo !== null && (!isObject(logo) || !isString(logo.small))) return undefined;
  return {
    displayName: value.displayName,
    primary: colours.primary as Hex | null,
    logo: logo === null ? null : (logo.small as string),
  };
}

function readTimeouts(value: unknown): GameTimeouts | undefined {
  if (!isObject(value) || !isCountOrNull(value.left) || !isCount(value.limit)) return undefined;
  return { left: value.left as number | null, limit: value.limit };
}

/** A player reference, null for `null`, undefined when malformed. */
export function readPlayerRef(value: unknown): PlayerRef | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  const fields = ["number", "displayName", "firstName", "lastName", "shortName"] as const;
  if (!fields.every((field) => isStringOrNull(value[field]))) return undefined;
  return Object.fromEntries(fields.map((field) => [field, value[field]])) as unknown as PlayerRef;
}

function readScore(value: unknown) {
  if (value === null) return null;
  return isObject(value) && isCount(value.home) && isCount(value.away) ? { home: value.home, away: value.away } : undefined;
}

/** Goal and timeout entries; undefined when the timeline (or one of those entries) is malformed. */
function readTimeline(value: unknown): TimelineEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: TimelineEntry[] = [];
  for (const item of value) {
    if (!isObject(item) || !isString(item.id) || !isString(item.kind)) return undefined;
    if (item.kind !== "goal" && item.kind !== "timeout") continue;
    if (!isSide(item.side)) return undefined;
    const scoreAfter = readScore(item.scoreAfter);
    const scorer = readPlayerRef(item.scorer);
    const assist = readPlayerRef(item.assist);
    if (scoreAfter === undefined || scorer === undefined || assist === undefined) return undefined;
    if (item.callahan !== null && typeof item.callahan !== "boolean") return undefined;
    entries.push({ id: item.id, kind: item.kind, side: item.side, scoreAfter, scorer, assist, callahan: item.callahan === true });
  }
  return entries;
}

/** The typed view of a `stream:{slug}:game` snapshot, or null when the payload is not supported. */
export function readGameSnapshot(data: unknown): GameSnapshot | null {
  if (!isObject(data)) return null;
  const { game, teams, score, timeouts, clock, possession, freshness } = data;
  if (!isObject(game) || !isString(game.id)) return null;
  if (!isObject(teams) || !isObject(score) || !isObject(timeouts) || !isObject(clock) || !isObject(freshness))
    return null;
  const home = readTeam(teams.home);
  const away = readTeam(teams.away);
  if (home === undefined || away === undefined) return null;
  if (!isCountOrNull(score.home) || !isCountOrNull(score.away)) return null;
  if (score.source !== "none" && score.source !== "observed" && score.source !== "official") return null;
  if (possession !== null && !isSide(possession)) return null;
  const homeTimeouts = readTimeouts(timeouts.home);
  const awayTimeouts = readTimeouts(timeouts.away);
  if (!homeTimeouts || !awayTimeouts || (timeouts.per !== "game" && timeouts.per !== "half")) return null;
  const { running, elapsedMs, anchorServerTs, confidence } = clock;
  if (typeof running !== "boolean" || typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0)
    return null;
  if (!isString(anchorServerTs) || !Number.isFinite(Date.parse(anchorServerTs))) return null;
  if (confidence !== "good" && confidence !== "uncertain" && confidence !== "unknown") return null;
  if (typeof freshness.ageWarning !== "boolean") return null;
  const timeline = readTimeline(data.timeline);
  if (!timeline) return null;
  return {
    gameId: game.id,
    teams: { home, away },
    score: { home: score.home as number | null, away: score.away as number | null, source: score.source },
    possession,
    timeouts: { per: timeouts.per, home: homeTimeouts, away: awayTimeouts },
    clock: { running, elapsedMs, anchorServerTs, confidence },
    ageWarning: freshness.ageWarning,
    timeline,
  };
}
