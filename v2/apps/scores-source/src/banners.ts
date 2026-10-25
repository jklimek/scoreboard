// Goal and timeout banners (DOM-free): which live moment may enter a banner, what it says (always
// from the latest snapshot, never from local arithmetic) and the one-at-a-time queue. The view only
// plays `show`, `refresh` and `hide`.
import type { GameSnapshot, PlayerRef, Side, TimelineEntry } from "./game.ts";
import type { SourceMoment, SourceUpdate } from "./source.ts";

export interface Banner {
  /** The moment id (the timeline entry id). */
  id: string;
  kind: "goal" | "timeout";
  side: Side;
  title: "GOAL" | "TIMEOUT";
  /** Scorer, else the team (a hidden or unknown scorer is never named). */
  primary: string;
  /** `Assist: …`, `Callahan`, timeouts left, or nothing (no, unknown or hidden assist). */
  secondary: string | null;
  /** The score after the goal, from the snapshot; null when the snapshot does not know it. */
  scoreline: string | null;
}

const clean = (value: string | null) => value?.trim() || null;

/**
 * The permitted label of a public player reference: display name, else first and last name, else
 * short name, else the jersey number (`#0` is a number); null when nothing is public.
 */
export function playerLabel(ref: PlayerRef | null): string | null {
  if (!ref) return null;
  const full = [clean(ref.firstName), clean(ref.lastName)].filter(Boolean).join(" ");
  const number = clean(ref.number);
  return clean(ref.displayName) ?? (full || null) ?? clean(ref.shortName) ?? (number ? `#${number}` : null);
}

export const teamLabel = (game: GameSnapshot, side: Side) =>
  game.teams[side]?.displayName.trim() || (side === "home" ? "Home" : "Away");

/** The banner of a goal or timeout timeline entry of `game`. */
export function bannerFor(entry: TimelineEntry, game: GameSnapshot): Banner {
  const base = { id: entry.id, kind: entry.kind, side: entry.side };
  if (entry.kind === "timeout") {
    const { left, limit } = game.timeouts[entry.side];
    const per = game.timeouts.per === "half" ? " this half" : "";
    return {
      ...base,
      title: "TIMEOUT",
      primary: teamLabel(game, entry.side),
      secondary: left === null ? null : `${left} of ${limit} left${per}`,
      scoreline: null,
    };
  }
  const assist = playerLabel(entry.assist);
  return {
    ...base,
    title: "GOAL",
    primary: playerLabel(entry.scorer) ?? teamLabel(game, entry.side),
    secondary: entry.callahan ? "Callahan" : assist ? `Assist: ${assist}` : null,
    scoreline: entry.scoreAfter ? `${entry.scoreAfter.home}–${entry.scoreAfter.away}` : null,
  };
}

export interface BannerView {
  show(banner: Banner): void;
  /** New content for the banner on air (no new entrance). */
  refresh(banner: Banner): void;
  /** `exit`: the banner's time is up; `cut`: retracted or cancelled, gone at once. */
  hide(mode: "exit" | "cut"): void;
}

export interface BannerOptions {
  holdMs?: { goal: number; timeout: number };
  /**
   * Wait before an idle rail shows a new banner: a correction published in the same hub load (a
   * mistaken goal and its void, a restore and its undo) arrives within it and cancels the banner.
   */
  settleMs?: number;
  /** Pause after a banner leaves (covers its exit). */
  gapMs?: number;
  /** Waiting banners kept; the oldest is dropped beyond it. */
  maxQueued?: number;
}

const sameBanner = (a: Banner, b: Banner) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Feed it every source update and moment. Rules:
 * - a banner enters (after `settleMs`, one at a time) only on a live `goal`/`timeout` moment of the shown game (the source checks
 *   W31-D7) whose timeline entry is in the latest snapshot and is the newest of its kind there,
 *   and whose id was not in an earlier snapshot of this game (an administrative restore, a backlog
 *   or a duplicate never announces);
 * - every snapshot re-derives the waiting and shown banners; one whose entry is gone is retracted;
 * - `event.voided` retracts its target; a void of a void (a restore) also retracts what entered
 *   after the latest snapshot; `event.amended` re-derives its target from the snapshot;
 * - a game switch, `degraded` and every state without a game cancel everything at once.
 */
export function createBannerController(view: BannerView, options: BannerOptions = {}) {
  const holdMs = options.holdMs ?? { goal: 6000, timeout: 5000 };
  const settleMs = options.settleMs ?? 300;
  const gapMs = options.gapMs ?? 400;
  const maxQueued = options.maxQueued ?? 2;
  /** The latest snapshot of the current game. */
  let game: GameSnapshot | null = null;
  /** Ids in an earlier snapshot of this game, or already announced. */
  let known = new Set<string>();
  /** Ids that entered after the latest snapshot. */
  let recent = new Set<string>();
  let current: Banner | null = null;
  let queue: Banner[] = [];
  /** The hold of the shown banner, else the wait (settle or gap) before the next one. */
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  function next() {
    stopTimer();
    const banner = queue.shift();
    if (!banner) return;
    current = banner;
    view.show(banner);
    timer = setTimeout(() => leave("exit"), holdMs[banner.kind]);
  }
  function leave(mode: "exit" | "cut") {
    stopTimer();
    if (!current) return;
    current = null;
    view.hide(mode);
    timer = setTimeout(next, gapMs);
  }
  function cancel() {
    stopTimer();
    queue = [];
    if (current) {
      current = null;
      view.hide("cut");
    }
  }
  function retract(id: string) {
    queue = queue.filter((banner) => banner.id !== id);
    if (current?.id === id) leave("cut");
  }
  /** Re-derives a banner from the latest snapshot; retracts it when its entry is gone. */
  function rederive(id: string) {
    const entry = game?.timeline.find((item) => item.id === id);
    if (!game || !entry) return retract(id);
    const banner = bannerFor(entry, game);
    queue = queue.map((item) => (item.id === id ? banner : item));
    if (current?.id === id && !sameBanner(current, banner)) view.refresh((current = banner));
  }
  function enter(id: string) {
    if (!game || known.has(id)) return;
    known.add(id);
    const entry = game.timeline.find((item) => item.id === id);
    const newest = game.timeline.filter((item) => item.kind === entry?.kind).pop();
    if (!entry || newest !== entry) return;
    recent.add(id);
    queue.push(bannerFor(entry, game));
    if (queue.length > maxQueued) queue.shift();
    if (!current && timer === undefined) timer = setTimeout(next, settleMs);
  }

  return {
    get current() {
      return current;
    },
    get queued(): readonly Banner[] {
      return queue;
    },
    update({ state }: SourceUpdate) {
      const shown = state.game;
      if (!shown || (state.status !== "live" && state.status !== "degraded")) {
        cancel();
        game = null;
        return;
      }
      if (!game || shown.gameId !== game.gameId) {
        // A switch: nothing of the previous game survives.
        cancel();
        known = new Set();
        recent = new Set();
        game = shown;
        return;
      }
      // Q77: no animations while degraded; what was waiting or shown may be corrected unseen.
      if (state.status === "degraded") cancel();
      if (shown === game) return;
      for (const entry of game.timeline) known.add(entry.id);
      game = shown;
      recent = new Set();
      for (const banner of [...(current ? [current] : []), ...queue]) rederive(banner.id);
    },
    moment({ moment, game: of }: SourceMoment) {
      if (!game || of !== game) return;
      switch (moment.kind) {
        case "goal":
        case "timeout":
          return enter(moment.id);
        case "event.voided":
          retract(moment.targetId);
          if (moment.targetKind === "event.voided") for (const id of recent) retract(id);
          return;
        case "event.amended":
          if (current?.id === moment.targetId || queue.some((banner) => banner.id === moment.targetId))
            rederive(moment.targetId);
      }
    },
    close: cancel,
  };
}
export type BannerController = ReturnType<typeof createBannerController>;
