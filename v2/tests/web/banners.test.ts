// S2-A2: banners through the actual pinned live client, the source module and a fake Scores that
// speaks the real WebSocket protocol (mocked timers and clock). Includes the W31-D7 proof.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createBannerController } from "../../apps/scores-source/src/banners.ts";
import type { Banner } from "../../apps/scores-source/src/banners.ts";
import { parseScoresFragment } from "../../apps/scores-source/src/config.ts";
import { createScoresSource } from "../../apps/scores-source/src/source.ts";
import type { SourceMoment } from "../../apps/scores-source/src/source.ts";
import { scoreBumps } from "../../apps/scores-source/src/scorebug.ts";
import { createLiveClient } from "../../vendor/scores-live-client/live-client.js";
import { createFakeScores, fakeWebSocket, fixture, fixtureKey, fixtureProfile } from "../support/fake-scores.ts";

const origin = "https://scores.example.invalid";
const channel = `stream:${fixtureProfile}:game`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const game = { standard: id(13), hidden: id(14), basic: id(11) };

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-25T13:00:00.000Z") }));
afterEach(() => mock.timers.reset());

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}
async function advance(ms: number, step = 100) {
  for (let left = ms; left > 0; left -= step) {
    mock.timers.tick(Math.min(step, left));
    await flush();
  }
}

/** One overlay document: source + banner controller with a recording view. */
function setup(scores = createFakeScores()) {
  const { WebSocket, control } = fakeWebSocket(scores);
  const log: string[] = [];
  const shown: Banner[] = [];
  const moments: SourceMoment[] = [];
  const bumps: { home: boolean; away: boolean }[] = [];
  const banners = createBannerController({
    show(banner) {
      shown.push(banner);
      log.push(`show ${banner.id.slice(-3)}`);
    },
    refresh(banner) {
      log.push(`refresh ${banner.id.slice(-3)} ${banner.secondary}`);
    },
    hide(mode) {
      log.push(`hide ${mode}`);
    },
  });
  const params = new URLSearchParams({ scores: origin, profile: fixtureProfile, key: fixtureKey });
  const source = createScoresSource(parseScoresFragment(`#${params}`), {
    WebSocket,
    fetch: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    random: () => 0.5,
    onUpdate(update) {
      bumps.push(scoreBumps(update));
      banners.update(update);
    },
    onMoment(event) {
      moments.push(event);
      banners.moment(event);
    },
  });
  const close = () => {
    banners.close();
    source.close();
  };
  return { scores, control, source, banners, log, shown, moments, bumps, close };
}

test("a live goal enters once per id with the snapshot's content; the initial snapshot is quiet", async () => {
  const board = setup();
  board.scores.snapshot("game-standard-goal");
  await flush();
  await advance(10_000);
  assert.deepEqual(board.log, [], "history in the first snapshot never celebrates");
  board.scores.snapshot("game-standard-goal");
  board.scores.snapshot("game-standard-callahan");
  board.scores.moment("moment-goal-callahan");
  await flush();
  assert.deepEqual(board.log, [], "the banner waits for the settle window");
  await advance(300);
  assert.deepEqual(board.log, ["show 303"]);
  assert.deepEqual(board.shown[0], {
    id: id(303), kind: "goal", side: "away", title: "GOAL", primary: "W31 Fixture Defender", secondary: "Callahan", scoreline: "5–5",
  });
  // At-least-once delivery: the same id again (a new version) is deduplicated by the client.
  board.scores.moment("moment-goal-callahan");
  await advance(10_000);
  assert.deepEqual(board.log, ["show 303", "hide exit"]);
  assert.equal(board.moments.length, 1);
  board.close();
});

test("reload: a new document with the same hub state shows nothing", async () => {
  const scores = createFakeScores();
  const first = setup(scores);
  scores.snapshot("game-standard");
  await flush();
  scores.snapshot("game-standard-goal");
  scores.moment("moment-goal-named");
  await advance(500);
  assert.deepEqual(first.log, ["show 302"]);
  const reloaded = setup(scores);
  await advance(10_000);
  assert.equal(reloaded.source.state.game?.gameId, game.standard);
  assert.deepEqual(reloaded.log, []);
  assert.deepEqual(reloaded.moments, []);
  first.close();
  reloaded.close();
});

test("a reconnect never animates replayed or resynced goals; a fresh goal after it may", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.control.down = true;
  board.scores.dropAll();
  await flush();
  assert.equal(board.source.state.status, "degraded");
  // Missed while disconnected: the hub buffers the moment for replay.
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  board.control.down = false;
  await advance(3000);
  assert.equal(board.source.state.status, "live");
  assert.equal(board.source.state.game?.timeline.at(-1)?.id, id(302));
  assert.deepEqual(board.log, [], "the replayed goal never enters");
  assert.deepEqual(board.moments, [], "replays never reach the view");
  assert.deepEqual(board.bumps.at(-1), { home: false, away: false }, "the resync never bumps");
  board.scores.snapshot("game-standard-callahan");
  board.scores.moment("moment-goal-callahan");
  await advance(500);
  assert.deepEqual(board.log, ["show 303"]);
  board.close();
});

test("after an unchanged reconnect a fresh live goal enters, but its first snapshot does not bump", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.dropAll();
  await advance(2000);
  assert.equal(board.source.state.status, "live");
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  await advance(500);
  assert.deepEqual(board.bumps.at(-1), { home: false, away: false }, "first snapshot after a reconnect");
  assert.deepEqual(board.log, ["show 302"], "a fresh live moment is not a replay");
  board.close();
});

test("event.amended updates the banner on air without a new entrance", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  await advance(500);
  board.scores.snapshot("game-standard-amended");
  await flush();
  board.scores.moment("moment-amended");
  await flush();
  assert.deepEqual(board.log, ["show 302", "refresh 302 Assist: W31 Handler"], "the snapshot carries the correction; the moment adds nothing new");
  await advance(7000);
  assert.deepEqual(board.log.slice(2), ["hide exit"]);
  assert.equal(board.shown.length, 1);
  board.close();
});

test("event.voided retracts the banner on air at once", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  await advance(500);
  // The void's snapshot no longer has the goal: retracted at once, before the void moment.
  board.scores.snapshot("game-standard");
  await flush();
  assert.deepEqual(board.log, ["show 302", "hide cut"]);
  board.scores.moment("moment-voided");
  await advance(10_000);
  assert.deepEqual(board.log, ["show 302", "hide cut"]);

  board.close();
});

test("a waiting goal is dropped by its void moment", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.snapshot("game-standard-timeout");
  board.scores.moment("moment-timeout");
  await advance(500);
  assert.deepEqual(board.log, ["show 304"]);
  const timeoutData = fixture("game-standard-timeout").data as { timeline: unknown[]; score: Record<string, unknown> };
  const goal = (fixture("game-standard-goal").data as { timeline: unknown[] }).timeline.at(-1);
  board.scores.snapshotData({ ...timeoutData, timeline: [...timeoutData.timeline, goal] });
  board.scores.moment("moment-goal-named");
  await flush();
  assert.deepEqual(board.banners.queued.map((banner) => banner.id), [id(302)]);
  board.scores.moment("moment-voided");
  await flush();
  assert.deepEqual(board.banners.queued, []);
  await advance(10_000);
  assert.deepEqual(board.log, ["show 304", "hide exit"], "the voided goal never entered");
  board.close();
});

test("a timeout banner names the team and its timeouts left", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.snapshot("game-standard-timeout");
  board.scores.moment("moment-timeout");
  await advance(500);
  assert.deepEqual(board.shown.map((banner) => [banner.title, banner.primary, banner.secondary]), [["TIMEOUT", "W31 Fixture Home", "1 of 2 left this half"]]);
  await advance(5000);
  assert.deepEqual(board.log, ["show 304", "hide exit"]);
  board.close();
});

test("an administrative restore never announces the goal again", async () => {
  // The board joined after the goal (it is only history), then saw it voided and restored. The
  // hub announces a restored id again, and this client never saw it as a moment.
  const board = setup();
  board.scores.snapshot("game-standard-goal");
  await flush();
  board.scores.snapshot("game-standard");
  board.scores.moment("moment-voided");
  await flush();
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  board.scores.moment("moment-restore");
  await advance(10_000);
  assert.deepEqual(board.moments.map((event) => event.moment.kind), ["event.voided", "goal", "event.voided"]);
  assert.deepEqual(board.log, [], "known from an earlier snapshot of this game");

  // Without its undo in the same burst (an allocation failure defers it to the next load), the
  // restored goal is still known from an earlier snapshot of this game.
  const late = setup();
  late.scores.snapshot("game-standard-goal");
  await flush();
  late.scores.snapshot("game-standard");
  late.scores.moment("moment-voided");
  await flush();
  late.scores.snapshot("game-standard-goal");
  late.scores.moment("moment-goal-named");
  await advance(10_000);
  assert.deepEqual(late.moments.map((event) => event.moment.kind), ["event.voided", "goal"]);
  assert.deepEqual(late.log, []);
  late.close();

  // Reloaded during the void: the goal is unknown, but its undo arrives in the same burst and
  // cancels it inside the settle window.
  const scores = createFakeScores();
  scores.snapshot("game-standard-goal");
  scores.snapshot("game-standard");
  scores.moment("moment-voided");
  const reloaded = setup(scores);
  await flush();
  scores.snapshot("game-standard-goal");
  scores.moment("moment-goal-named");
  scores.moment("moment-restore");
  await advance(10_000);
  assert.deepEqual(reloaded.moments.map((event) => event.moment.kind), ["goal", "event.voided"]);
  assert.deepEqual(reloaded.log, []);
  board.close();
  reloaded.close();
});

test("an older goal or a backlog never celebrates: only the newest entry of its kind enters", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  // Two goals in one load (an offline scorer syncing): both moments arrive, only the newest enters.
  const data = structuredClone(fixture("game-standard-no-assist").data) as { timeline: { id: string }[] };
  const named = (fixture("game-standard-goal").data as { timeline: unknown[] }).timeline.at(-1) as { id: string };
  data.timeline.splice(-1, 0, named);
  board.scores.snapshotData(data);
  board.scores.moment("moment-goal-named");
  board.scores.moment("moment-goal-no-assist");
  await advance(500);
  assert.deepEqual(board.log, ["show 306"]);
  board.close();
});

test("W31-D7 (client): a live moment not newer than the latest snapshot never reaches onMoment", async () => {
  const scores = createFakeScores();
  const { WebSocket } = fakeWebSocket(scores);
  const live: string[] = [];
  const replayed: string[] = [];
  const client = createLiveClient({
    baseUrl: origin,
    channels: [channel],
    key: fixtureKey,
    transport: "ws",
    WebSocket,
    random: () => 0.5,
    onMoment: (_name, moment, message) => live.push(`${moment.id.slice(-3)}@${message.version}`),
    onReplay: (_name, moment) => replayed.push(moment.id.slice(-3)),
  });
  scores.snapshot("game-standard");
  await flush();
  const old = scores.moment("moment-goal-named");
  await flush();
  const switched = scores.snapshot("game-hidden-stats");
  await flush();
  // Adverse orderings the hub never produces: an old-game moment delivered after the switch
  // snapshot (older version), and a moment exactly at the snapshot's version.
  scores.deliver({ ...fixture("moment-goal-callahan"), version: switched.version - 1 } as never);
  scores.deliver({ ...fixture("moment-goal-hidden"), version: switched.version } as never);
  // A replay of an older version may reach onReplay (never onMoment).
  scores.deliver({ ...fixture("moment-goal-no-assist"), version: switched.version + 5, replay: true } as never);
  await flush();
  assert.deepEqual(live, [`302@${old.version}`]);
  assert.deepEqual(replayed, ["306"]);
  assert.equal(client.get(channel)?.version, switched.version);
  client.close();
});

test("game switch: everything is cancelled and no old-game moment animates on the new game", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  await advance(500);
  assert.deepEqual(board.log, ["show 302"]);

  // 1. The new game's snapshot first, then a delayed old-game moment with a stale version.
  const switched = board.scores.snapshot("game-hidden-stats");
  await flush();
  assert.deepEqual(board.log, ["show 302", "hide cut"], "the switch cancels the banner at once");
  assert.equal(board.source.state.game?.gameId, game.hidden);
  board.scores.deliver({ ...fixture("moment-goal-callahan"), version: switched.version - 1 } as never);
  // Even a stale moment whose id is in the new game's timeline is dropped by the version guard.
  board.scores.deliver({ ...fixture("moment-goal-hidden"), version: switched.version - 2 } as never);
  await advance(10_000);
  assert.deepEqual(board.log, ["show 302", "hide cut"]);
  assert.equal(board.moments.length, 1);

  // 2. A moment newer than the snapshot that is not in its timeline (not the shown game's): no banner.
  board.scores.moment("moment-goal-no-assist");
  await advance(10_000);
  assert.equal(board.moments.length, 2, "passed on: newer than the snapshot (W31-D7)");
  assert.deepEqual(board.log, ["show 302", "hide cut"], "no timeline entry in the shown game: suppressed");
  board.close();
});

test("game switch: an old-game moment published just before the switch never shows on either game", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  // The hub publishes in order: the old game's goal (its snapshot and moment), then the switch.
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  board.scores.snapshot("game-hidden-stats");
  await flush();
  assert.equal(board.moments.length, 1, "attributed to the old game while it was shown");
  await advance(10_000);
  assert.deepEqual(board.log, [], "cancelled inside the settle window by the switch");
  board.close();
});

test("game switch across a reconnect: the new game only, its moments replay quietly", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.control.down = true;
  board.scores.dropAll();
  await flush();
  // While disconnected: an old-game goal, the switch, then a goal of the new game.
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  board.scores.snapshot("game-hidden-stats");
  board.scores.snapshot("game-hidden-stats");
  board.scores.moment("moment-goal-hidden");
  assert.deepEqual(board.scores.ring().map((entry) => entry.id), [id(307)], "the old game's moment left the replay ring");
  board.control.down = false;
  await advance(3000);
  assert.equal(board.source.state.status, "live");
  assert.equal(board.source.state.game?.gameId, game.hidden);
  assert.deepEqual(board.moments, []);
  await advance(10_000);
  assert.deepEqual(board.log, []);
  board.close();
});

test("degraded and unavailable cancel banners at once; no animation while degraded", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  await advance(500);
  board.scores.dropAll();
  await flush();
  assert.equal(board.source.state.status, "degraded");
  assert.deepEqual(board.log, ["show 302", "hide cut"]);
  await advance(3000);
  assert.equal(board.source.state.status, "live");
  assert.deepEqual(board.log, ["show 302", "hide cut"], "nothing comes back after the resume");

  board.scores.snapshot("game-standard-timeout");
  board.scores.moment("moment-timeout");
  await advance(500);
  board.scores.remove();
  await flush();
  assert.equal(board.source.state.status, "unavailable");
  assert.deepEqual(board.log.slice(2), ["show 304", "hide cut"]);

  board.scores.snapshot("game-standard-timeout");
  await flush();
  board.scores.snapshot("game-standard-callahan");
  board.scores.moment("moment-goal-callahan");
  await advance(500);
  board.scores.revoke();
  await flush();
  assert.equal(board.source.state.status, "unavailable");
  assert.deepEqual(board.log.slice(4), ["show 303", "hide cut"], "a refused key clears the banner at once");
  board.close();
});

test("the source passes on nothing while not live (error, connecting) and nothing after close", async () => {
  const board = setup();
  board.scores.moment("moment-goal-named");
  await flush();
  board.scores.snapshotData({ game: { id: "x" } });
  board.scores.moment("moment-goal-callahan");
  await flush();
  assert.equal(board.source.state.status, "error");
  assert.deepEqual(board.moments, []);
  board.scores.snapshot("game-standard");
  await flush();
  board.close();
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-no-assist");
  await advance(1000);
  assert.deepEqual(board.moments, []);
  assert.deepEqual(board.log, []);
});
