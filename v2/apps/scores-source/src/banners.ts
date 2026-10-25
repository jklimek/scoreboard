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
  /** Pause after a banner leaves (covers its exit). */
  gapMs?: number;
  /** Banners waiting behind the one on air; beyond it the oldest waiting one is dropped. */
  maxQueued?: number;
}

const sameBanner = (a: Banner, b: Banner) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Feed it every source update and moment. Rules (no timing decides correctness):
 * - a banner is admitted on a live `goal`/`timeout` moment of the shown game (the source checks
 *   W31-D7) whose entry of that kind is in the latest snapshot's timeline, unless its id was in a
 *   baseline snapshot of this game (the first one, the first after a switch or a reconnect: it is
 *   history) or was admitted before; every admitted banner plays in order, one at a time;
 * - every snapshot re-derives the waiting and shown banners; one whose entry is gone is retracted;
 * - `event.voided` retracts only its own target (an undo, `targetKind` `event.voided`, retracts and
 *   starts nothing); `event.amended` re-derives its target from the snapshot;
 * - a game switch, `degraded`, every state without a game and `close` cut everything at once,
 *   including a banner still leaving; a retraction of the leaving banner cuts its exit too.
 */
export function createBannerController(view: BannerView, options: BannerOptions = {}) {
  const holdMs = options.holdMs ?? { goal: 6000, timeout: 5000 };
  const gapMs = options.gapMs ?? 400;
  const maxQueued = options.maxQueued ?? 3;
  /** The latest snapshot of the current game. */
  let game: GameSnapshot | null = null;
  /** Ids never to admit: in a baseline snapshot of this game, or admitted already. */
  let quiet = new Set<string>();
  /** The banner on air (not while it leaves). */
  let current: Banner | null = null;
  /** The banner whose exit is still visible (the gap after `leave("exit")`), so a void can cut it. */
  let leaving: Banner | null = null;
  /** Admitted banners waiting, oldest first. */
  let queue: Banner[] = [];
  /** The hold of `current`; without `current`, the gap while the previous banner leaves. */
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  function next() {
    stopTimer();
    leaving = null;
    const banner = queue.shift();
    if (!banner) return;
    current = banner;
    view.show(banner);
    timer = setTimeout(() => leave("exit"), holdMs[banner.kind]);
  }
  function leave(mode: "exit" | "cut") {
    stopTimer();
    if (!current) return;
    leaving = mode === "exit" ? current : null;
    current = null;
    view.hide(mode);
    timer = setTimeout(next, gapMs);
  }
  function cancel() {
    // A banner on air or still leaving (the gap timer) is cut at once.
    const visible = current !== null || timer !== undefined;
    stopTimer();
    queue = [];
    current = null;
    leaving = null;
    if (visible) view.hide("cut");
  }
  function retract(id: string) {
    queue = queue.filter((banner) => banner.id !== id);
    if (current?.id === id) leave("cut");
    else if (leaving?.id === id) {
      // Review r2: a retraction during the exit cuts it; the gap timer then starts the next one.
      leaving = null;
      view.hide("cut");
    }
  }
  /** Re-derives a banner from the latest snapshot; retracts it when its entry is gone. */
  function rederive(id: string) {
    const entry = game?.timeline.find((item) => item.id === id);
    if (!game || !entry) return retract(id);
    const banner = bannerFor(entry, game);
    queue = queue.map((item) => (item.id === id ? banner : item));
    if (current?.id === id && !sameBanner(current, banner)) view.refresh((current = banner));
    // Review r3: a correction (e.g. a name no longer public) also reaches a banner still leaving.
    else if (leaving?.id === id && !sameBanner(leaving, banner)) view.refresh((leaving = banner));
  }
  function admit(kind: "goal" | "timeout", id: string) {
    if (!game || quiet.has(id)) return;
    const entry = game.timeline.find((item) => item.id === id && item.kind === kind);
    if (!entry) return;
    quiet.add(id);
    queue.push(bannerFor(entry, game));
    if (queue.length > maxQueued) queue.shift();
    if (!current && timer === undefined) next();
  }

  return {
    get current() {
      return current;
    },
    get queued(): readonly Banner[] {
      return queue;
    },
    update({ state, liveSnapshot }: SourceUpdate) {
      const shown = state.game;
      if (!shown || (state.status !== "live" && state.status !== "degraded")) {
        cancel();
        game = null;
        return;
      }
      if (!game || shown.gameId !== game.gameId) {
        // A switch (or the first game): nothing of the previous game survives.
        cancel();
        quiet = new Set();
      }
      // Q77: no animations while degraded; what was waiting or shown may be corrected unseen.
      if (state.status === "degraded") cancel();
      if (shown === game) return;
      const baseline = !game || shown.gameId !== game.gameId || !liveSnapshot;
      game = shown;
      if (baseline) for (const entry of shown.timeline) quiet.add(entry.id);
      for (const banner of [current, leaving, ...queue]) if (banner) rederive(banner.id);
    },
    moment({ moment, game: of }: SourceMoment) {
      if (!game || of !== game) return;
      switch (moment.kind) {
        case "goal":
        case "timeout":
          return admit(moment.kind, moment.id);
        case "event.voided":
          // An undo restores its event in the snapshot; it never retracts or starts anything.
          if (moment.targetKind !== "event.voided") retract(moment.targetId);
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
