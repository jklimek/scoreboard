// S2-A2: banners through the actual pinned live client, the source module and a fake Scores that
// speaks the real WebSocket protocol (mocked timers and clock). Includes the W31-D7 proof.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createBannerController } from "../../apps/scores-source/src/banners.ts";
import type { Banner } from "../../apps/scores-source/src/banners.ts";
import { parseScoresFragment } from "../../apps/scores-source/src/config.ts";
import { readGameSnapshot } from "../../apps/scores-source/src/game.ts";
import { createScoresSource } from "../../apps/scores-source/src/source.ts";
import type { SourceMoment, SourceState } from "../../apps/scores-source/src/source.ts";
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

/** `game-standard` data whose timeline also has the last entry of each named variant, in order. */
function standardWith(...variants: string[]) {
  const data = structuredClone(fixture("game-standard").data) as { timeline: unknown[] };
  for (const name of variants) data.timeline.push((fixture(name).data as { timeline: unknown[] }).timeline.at(-1));
  return data;
}

/** A recording view. */
function recorder() {
  const log: string[] = [];
  const shown: Banner[] = [];
  const view = {
    show(banner: Banner) {
      shown.push(banner);
      log.push(`show ${banner.id.slice(-3)}`);
    },
    refresh(banner: Banner) {
      log.push(`refresh ${banner.id.slice(-3)} ${banner.secondary}`);
    },
    hide(mode: "exit" | "cut") {
      log.push(`hide ${mode}`);
    },
  };
  return { log, shown, view };
}

/** One overlay document: source + banner controller with a recording view. */
function setup(scores = createFakeScores()) {
  const { WebSocket, control } = fakeWebSocket(scores);
  const { log, shown, view } = recorder();
  const moments: SourceMoment[] = [];
  const bumps: { home: boolean; away: boolean }[] = [];
  const banners = createBannerController(view);
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
  assert.deepEqual(board.log, ["show 303"], "no settle window: it enters at once");
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

test("reload race: a moment arriving live right after a new document's first snapshot is history", async () => {
  // The hub delivers a load's snapshot, then allocates and sends its moments: a document that
  // subscribes in between gets the retained snapshot (already with the goal), then the goal live.
  const scores = createFakeScores();
  scores.snapshot("game-standard");
  scores.snapshot("game-standard-goal");
  const board = setup(scores);
  await flush();
  assert.equal(board.source.state.game?.timeline.at(-1)?.id, id(302));
  scores.moment("moment-goal-named");
  await advance(10_000);
  assert.deepEqual(board.moments.map((event) => event.moment.id), [id(302)], "a live moment, not a replay");
  assert.deepEqual(board.log, [], "its id was in the baseline snapshot");
  scores.snapshot("game-standard-callahan");
  scores.moment("moment-goal-callahan");
  await flush();
  assert.deepEqual(board.log, ["show 303"], "a later goal enters");
  board.close();
});

test("reconnect race: a moment arriving live right after the resync snapshot is history", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.control.down = true;
  board.scores.dropAll();
  await flush();
  // The goal's snapshot was published while the board was away, its moment not yet.
  board.scores.snapshot("game-standard-goal");
  board.control.down = false;
  await advance(3000);
  assert.equal(board.source.state.status, "live");
  board.scores.moment("moment-goal-named");
  await advance(10_000);
  assert.equal(board.moments.length, 1);
  assert.deepEqual(board.log, [], "its id was in the resync snapshot");
  board.close();
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

test("after an unchanged reconnect the first snapshot is a baseline: no bump, no banner; later goals enter", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.dropAll();
  await advance(2000);
  assert.equal(board.source.state.status, "live");
  // No resync snapshot came (nothing changed), so this one cannot be told apart from it.
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  await advance(500);
  assert.deepEqual(board.bumps.at(-1), { home: false, away: false }, "first snapshot after a reconnect");
  assert.deepEqual(board.log, [], "its goal may be history");
  board.scores.snapshotData(standardWith("game-standard-goal", "game-standard-callahan"));
  board.scores.moment("moment-goal-callahan");
  await flush();
  assert.deepEqual(board.log, ["show 303"]);
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

test("a void or a correcting snapshot cuts its banner while it is still leaving (review r2)", async () => {
  for (const how of ["void moment", "snapshot"] as const) {
    const board = setup();
    board.scores.snapshot("game-standard");
    await flush();
    board.scores.snapshot("game-standard-goal");
    board.scores.moment("moment-goal-named");
    await advance(6100);
    assert.deepEqual(board.log, ["show 302", "hide exit"], how);
    if (how === "void moment") board.scores.moment("moment-voided");
    else board.scores.snapshot("game-standard");
    await flush();
    assert.deepEqual(board.log, ["show 302", "hide exit", "hide cut"], `${how}: the exit is cut`);
    await advance(10_000);
    assert.deepEqual(board.log, ["show 302", "hide exit", "hide cut"], how);
    board.close();
  }
});

test("an unrelated void during an exit cuts nothing and keeps the waiting banner", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  const timeoutData = fixture("game-standard-timeout").data as { timeline: unknown[] };
  const goal = (fixture("game-standard-goal").data as { timeline: unknown[] }).timeline.at(-1);
  board.scores.snapshotData({ ...timeoutData, timeline: [...timeoutData.timeline, goal] });
  board.scores.moment("moment-timeout");
  board.scores.moment("moment-goal-named");
  await advance(5100);
  assert.deepEqual(board.log, ["show 304", "hide exit"]);
  assert.deepEqual(board.banners.queued.map((banner) => banner.id), [id(302)]);
  // Voids the goal 302 only (not the leaving timeout 304).
  board.scores.moment("moment-voided");
  await flush();
  assert.deepEqual(board.log, ["show 304", "hide exit"], "the leaving timeout is not cut");
  assert.deepEqual(board.banners.queued, [], "the voided waiting goal is dropped");
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

test("restore (Scores bb5ce05e): only the undo arrives and nothing enters; voiding the undo adds nothing", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-goal-named");
  await flush();
  board.scores.snapshot("game-standard");
  board.scores.moment("moment-voided");
  await flush();
  assert.deepEqual(board.log, ["show 302", "hide cut"]);
  // The undo restores the goal in the snapshot; the goal is never a moment again.
  board.scores.snapshot("game-standard-goal");
  board.scores.moment("moment-restore");
  await advance(10_000);
  assert.deepEqual(board.scores.ring().map((entry) => entry.id), [id(323)], "the void and the restored goal left the ring");
  // Voiding the undo: the original retraction again (deduplicated by id) and the undo's void.
  board.scores.snapshot("game-standard");
  board.scores.moment("moment-voided");
  board.scores.moment("moment-revoid");
  await advance(10_000);
  assert.deepEqual(board.moments.map((event) => event.moment.id.slice(-3)), ["302", "322", "323", "324"]);
  assert.deepEqual(board.log, ["show 302", "hide cut"]);
  // Review r2 P3: the ring keeps the re-announced retraction and the undo's void, as Scores does.
  assert.deepEqual(board.scores.ring().map((entry) => entry.id), [id(322), id(324)]);

  // Reloaded during the void: the restore brings the goal back without any banner.
  const scores = createFakeScores();
  scores.snapshot("game-standard-goal");
  scores.snapshot("game-standard");
  scores.moment("moment-voided");
  const reloaded = setup(scores);
  await flush();
  scores.snapshot("game-standard-goal");
  scores.moment("moment-restore");
  await advance(10_000);
  assert.equal(reloaded.source.state.game?.timeline.at(-1)?.id, id(302));
  assert.deepEqual(reloaded.moments.map((event) => event.moment.kind), ["event.voided"]);
  assert.deepEqual(reloaded.log, []);
  board.close();
  reloaded.close();
});

test("an unrelated restore never retracts the goal on air", async () => {
  const board = setup();
  board.scores.snapshot("game-standard-goal");
  await flush();
  board.scores.snapshot("game-standard");
  board.scores.moment("moment-voided");
  await flush();
  board.scores.snapshotData(standardWith("game-standard-callahan"));
  board.scores.moment("moment-goal-callahan");
  await flush();
  assert.deepEqual(board.log, ["show 303"]);
  // The older goal …302 is restored while …303 is on air.
  board.scores.snapshotData(standardWith("game-standard-goal", "game-standard-callahan"));
  board.scores.moment("moment-restore");
  await advance(1000);
  assert.equal(board.banners.current?.id, id(303), "an undo retracts nothing");
  await advance(10_000);
  assert.deepEqual(board.log, ["show 303", "hide exit"]);
  board.close();
});

test("two goals in one coalesced snapshot both celebrate, in order", async () => {
  const board = setup();
  board.scores.snapshot("game-standard");
  await flush();
  // An offline scorer syncing: one load, both goals in the snapshot, then both moments.
  board.scores.snapshotData(standardWith("game-standard-goal", "game-standard-no-assist"));
  board.scores.moment("moment-goal-named");
  board.scores.moment("moment-goal-no-assist");
  await flush();
  assert.deepEqual(board.log, ["show 302"]);
  assert.deepEqual(board.banners.queued.map((banner) => banner.id), [id(306)]);
  await advance(6000 + 400);
  assert.deepEqual(board.log, ["show 302", "hide exit", "show 306"]);
  await advance(10_000);
  assert.deepEqual(board.log, ["show 302", "hide exit", "show 306", "hide exit"]);
  board.close();
});

test("the queue keeps at most three waiting banners, dropping the oldest waiting, never the one on air", () => {
  const before = standardWith("game-standard-goal") as { timeline: { id: string }[] };
  const ids = [401, 402, 403, 404, 405].map(id);
  const after = structuredClone(before);
  after.timeline.push(...ids.map((value) => ({ ...before.timeline.at(-1)!, id: value })));
  const live = readGameSnapshot(after)!;
  const previous: SourceState = { status: "connecting", game: null, problem: null };
  const state = (game: SourceState["game"]): SourceState => ({ status: "live", game, problem: null });
  const { log, view } = recorder();
  const banners = createBannerController(view);
  banners.update({ previous, state: state(readGameSnapshot(before)), liveSnapshot: false });
  banners.update({ previous, state: state(live), liveSnapshot: true });
  // A baseline id is refused even though it is in the latest snapshot.
  banners.moment({ moment: { kind: "goal", id: id(302) }, game: live, version: 1 });
  for (const value of ids) banners.moment({ moment: { kind: "goal", id: value }, game: live, version: 1 });
  assert.equal(banners.current?.id, ids[0], "the first one stays on air");
  assert.deepEqual(banners.queued.map((banner) => banner.id), ids.slice(2), "…402, the oldest waiting, is dropped");
  assert.deepEqual(log, ["show 401"]);
  banners.close();
  assert.deepEqual(log, ["show 401", "hide cut"]);
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

test("game switch: an old-game moment published just before the switch is cut by it, never shown on the new game", async () => {
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
  assert.deepEqual(board.log, ["show 302", "hide cut"], "cut at the switch");
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
  board.scores.snapshot("game-standard");
  await flush();

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

test("a cancellation cuts a banner that is still leaving (switch, degraded, unavailable, close)", async () => {
  const cancellations: [string, (board: ReturnType<typeof setup>) => void][] = [
    ["switch", (board) => board.scores.snapshot("game-hidden-stats")],
    ["degraded", (board) => board.scores.dropAll()],
    ["unavailable", (board) => board.scores.remove()],
    ["close", (board) => board.banners.close()],
  ];
  for (const [name, cancel] of cancellations) {
    const board = setup();
    board.scores.snapshot("game-standard");
    await flush();
    board.scores.snapshot("game-standard-timeout");
    board.scores.moment("moment-timeout");
    await advance(5200);
    assert.deepEqual(board.log, ["show 304", "hide exit"], name);
    cancel(board);
    await flush();
    assert.deepEqual(board.log, ["show 304", "hide exit", "hide cut"], `${name}: the exit is cut at once`);
    await advance(10_000);
    assert.deepEqual(board.log, ["show 304", "hide exit", "hide cut"], name);
    board.close();
  }
});
