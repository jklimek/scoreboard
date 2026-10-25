// The actual pinned live client, driven through the source module by a fake Scores that speaks the
// real WebSocket protocol, with mocked timers and clock.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { parseScoresFragment } from "../../apps/scores-source/src/config.ts";
import { createScoresSource } from "../../apps/scores-source/src/source.ts";
import type { ScoresSource, SourceUpdate } from "../../apps/scores-source/src/source.ts";
import { clockText, formatClock, scoreBumps, scoreText, scorebugModel } from "../../apps/scores-source/src/scorebug.ts";
import { createFakeScores, fakeWebSocket, fixtureKey, fixtureProfile } from "../support/fake-scores.ts";

const origin = "https://scores.example.invalid";
const channel = `stream:${fixtureProfile}:game`;
const start = Date.parse("2026-10-25T10:20:00.000Z");

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: start }));
afterEach(() => mock.timers.reset());

/** Lets queued socket frames (microtasks) and client promises run. */
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}
async function advance(ms: number, step = 1000) {
  for (let left = ms; left > 0; left -= step) {
    mock.timers.tick(Math.min(step, left));
    await flush();
  }
}

function setup(options: { key?: string; profile?: string; scores?: ReturnType<typeof createFakeScores>; down?: boolean } = {}) {
  const scores = options.scores ?? createFakeScores();
  const { WebSocket, control } = fakeWebSocket(scores);
  control.down = options.down ?? false;
  const updates: SourceUpdate[] = [];
  const requests: string[] = [];
  const params = new URLSearchParams({ scores: origin, profile: options.profile ?? fixtureProfile, key: options.key ?? fixtureKey });
  const source = createScoresSource(parseScoresFragment(`#${params}`), {
    WebSocket,
    fetch: (async (url: string) => {
      requests.push(String(url));
      return new Response(null, { status: 500 });
    }) as unknown as typeof fetch,
    random: () => 0.5,
    onUpdate: (update) => updates.push(update),
  });
  return { scores, control, source, updates, requests };
}
const model = (source: ScoresSource) => scorebugModel(source.state.game!, origin);
const frames = (sent: string[]) => sent.map((text) => JSON.parse(text) as Record<string, unknown>);

test("keyed auth is the first frame of the one socket, which follows only the game stream", async () => {
  const { scores, control, source, requests } = setup();
  scores.snapshot("game-live");
  await flush();
  assert.equal(control.sockets.length, 1);
  const socket = control.sockets[0]!;
  assert.equal(socket.url, "wss://scores.example.invalid/api/live/ws");
  assert.doesNotMatch(socket.url, new RegExp(fixtureKey));
  assert.equal(socket.sent[0], JSON.stringify({ op: "auth", key: fixtureKey }));
  assert.deepEqual(frames(socket.sent).slice(1), [{ op: "subscribe", channels: [channel] }]);
  assert.deepEqual(source.channels, [channel]);
  assert.equal(source.state.status, "live");
  assert.deepEqual(requests, []);
  source.close();
});

test("a snapshot becomes the scorebug model: names, colours, logo, score source and a running clock", async () => {
  const { scores, source } = setup();
  scores.snapshot("game-live");
  await flush();
  const bug = model(source);
  assert.equal(bug.gameId, "00000000-0000-4000-8000-000000000011");
  assert.deepEqual(
    { name: bug.home.name, abbreviation: bug.home.abbreviation, colours: bug.home.colours },
    { name: "W31 Fixture Home", abbreviation: "W3H", colours: { primary: "#1b6f7d", secondary: "#ffffff", text: "#ffffff" } },
  );
  // A relative Scores logo path resolves against the configured origin; no logo stays null.
  assert.equal(bug.home.logoUrl, `${origin}/api/public/v1/broadcast/logos/00000000-0000-4000-8000-000000000201/128?v=1`);
  assert.equal(bug.away.logoUrl, null);
  assert.deepEqual(bug.score, { home: 3, away: 2, source: "observed" });
  assert.deepEqual([bug.home.timeoutsLeft, bug.home.timeoutLimit, bug.away.timeoutsLeft], [1, 2, 2]);
  const ticks: string[] = [];
  const stop = source.tickClock((ms) => ticks.push(formatClock(ms)), 1000);
  assert.equal(ticks.at(-1), "10:00");
  await advance(61_000);
  assert.equal(ticks.at(-1), "11:01");
  stop();
  source.close();
});

test("a missing result is never 0:0, a missing team is neutral, and a stopped clock stays put", async () => {
  const { scores, source } = setup();
  scores.snapshot("game-no-result");
  await flush();
  let bug = model(source);
  assert.deepEqual(bug.score, { home: null, away: null, source: "none" });
  assert.deepEqual([scoreText(bug.score.home), scoreText(bug.score.away)], ["-", "-"]);
  assert.equal(bug.away.name, null);
  assert.equal(bug.away.abbreviation, null);
  assert.deepEqual(bug.home.colours, { primary: null, secondary: null, text: null });
  assert.equal(bug.home.timeoutsLeft, null);
  assert.equal(clockText(bug.clock, source.serverNow()), "0:00");

  scores.snapshot("game-official");
  await flush();
  bug = model(source);
  assert.deepEqual(bug.score, { home: 15, away: 12, source: "official" });
  await advance(30_000);
  assert.equal(clockText(bug.clock, source.serverNow()), "90:00");
  source.close();
});

test("Q77: a lost connection keeps the score and the running clock, then resyncs without animating", async () => {
  const { scores, control, source, updates } = setup();
  scores.snapshot("game-live");
  await flush();
  const shown = source.state.game;
  scores.dropAll();
  await flush();
  assert.equal(source.state.status, "degraded");
  assert.equal(source.state.game, shown, "the last game stays on air");
  // While disconnected the clock keeps running from the last authoritative clock.
  control.down = true;
  await advance(30_000);
  assert.equal(source.state.status, "degraded");
  assert.equal(clockText(source.state.game!.clock, source.serverNow()), "10:30");
  // A goal happened during the outage; the reconnect brings it as a resync snapshot.
  scores.snapshotQuietly("game-live-goal");
  control.down = false;
  await advance(30_000);
  assert.equal(source.state.status, "live");
  assert.deepEqual(model(source).score, { home: 4, away: 2, source: "observed" });
  const resync = updates.findLast((update) => update.state.game !== update.previous.game)!;
  assert.equal(resync.liveSnapshot, false);
  assert.deepEqual(scoreBumps(resync), { home: false, away: false });
  // The reopened socket authenticated first again and resumed by version.
  const last = frames(control.sockets.at(-1)!.sent);
  assert.equal(last[0]!.op, "auth");
  assert.deepEqual(Object.keys((last[1]!.resume ?? {}) as object), [channel]);
  // The next live snapshot of the same game may bump the changed digits.
  scores.snapshot("game-official");
  await flush();
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: true, away: true });
  source.close();
});

test("animations: never on the first render, a game switch, or a resync; a live moment ends the resync", async () => {
  const { scores, source, updates } = setup();
  scores.snapshot("game-live");
  await flush();
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: false, away: false });
  scores.snapshot("game-no-result");
  await flush();
  assert.equal(updates.at(-1)!.liveSnapshot, true);
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: false, away: false }, "another game");
  scores.snapshot("game-live");
  await flush();
  // Reconnect with nothing missed: no snapshot, back to live, still resyncing until news arrives.
  scores.dropAll();
  await advance(2000);
  assert.equal(source.state.status, "live");
  scores.moment("moment-goal");
  scores.snapshot("game-live-goal");
  await flush();
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: true, away: false });
  source.close();
});

test("Q77: removed clears the game at once; a later outage is not degraded; a new snapshot shows again", async () => {
  const { scores, source, updates } = setup();
  scores.snapshot("game-live");
  await flush();
  scores.remove();
  await flush();
  assert.deepEqual(source.state, { status: "unavailable", game: null, problem: null });
  scores.dropAll();
  await advance(5000);
  assert.equal(source.state.status, "unavailable");
  assert.equal(source.state.game, null);
  scores.snapshot("game-live");
  await flush();
  assert.equal(source.state.status, "live");
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: false, away: false });
  source.close();
});

test("Q77: a revoked key clears the game on the refused reconnect and never shows it again", async () => {
  const { scores, control, source, updates } = setup();
  scores.snapshot("game-live");
  await flush();
  scores.revoke();
  // The server closes keyed sockets (1008) without a reason frame; the next auth is refused.
  await advance(2000);
  assert.deepEqual(source.state, { status: "unavailable", game: null, problem: null });
  const cleared = updates.length;
  await advance(10 * 60_000, 5000);
  assert.ok(control.sockets.length > 2, "the client keeps retrying with backoff");
  assert.equal(source.state.status, "unavailable");
  assert.ok(updates.slice(cleared).every((update) => update.state.game === null));
  source.close();
});

test("Q77: an unknown key is unavailable from the start, never live", async () => {
  const { scores, source, updates } = setup({ key: "W31fixtureKEY_unknown-key_00000000000000000" });
  scores.snapshot("game-live");
  await flush();
  assert.equal(source.state.status, "unavailable");
  await advance(60_000);
  assert.ok(updates.every((update) => update.state.status !== "live" && update.state.game === null));
  source.close();
});

test("connectivity loss is never refusal: a long outage stays degraded and recovers", async () => {
  const { scores, control, source, requests } = setup();
  scores.snapshot("game-live");
  await flush();
  control.down = true;
  scores.dropAll();
  await advance(15 * 60_000, 5000);
  assert.equal(source.state.status, "degraded");
  assert.ok(source.state.game);
  control.down = false;
  await advance(31_000);
  assert.equal(source.state.status, "live");
  assert.deepEqual(requests, [], "WebSocket only: no SSE fallback carrying the key in a URL");
  source.close();
});

test("before the first open the source is connecting, not degraded", async () => {
  const { source, requests } = setup({ down: true });
  await advance(60_000);
  assert.equal(source.state.status, "connecting");
  assert.deepEqual(requests, []);
  source.close();
});

test("an unsupported snapshot payload is an explicit error with nothing shown", async () => {
  const { scores, source } = setup();
  scores.snapshot("game-live");
  await flush();
  scores.snapshotData({ game: { id: "x" } });
  await flush();
  assert.deepEqual(source.state, { status: "error", game: null, problem: "invalid-snapshot" });
  scores.snapshot("game-live");
  await flush();
  assert.equal(source.state.status, "live");
  source.close();
});

test("no polling: two hours of live play use one socket and zero HTTP requests", async () => {
  const { scores, control, source, requests } = setup();
  scores.snapshot("game-live");
  await flush();
  const names = ["game-live-goal", "game-live"];
  for (let minute = 1; minute <= 120; minute++) {
    await advance(60_000, 5000);
    scores.snapshot(names[minute % 2]!);
  }
  await flush();
  assert.equal(source.state.status, "live");
  assert.equal(control.sockets.length, 1);
  assert.deepEqual(requests, []);
  const ops = frames(control.sockets[0]!.sent).map((frame) => frame.op);
  assert.deepEqual(ops.slice(0, 2), ["auth", "subscribe"]);
  assert.ok(ops.slice(2).every((op) => op === "ping"), "only keep-alive pings after subscribing");
  assert.ok(scores.received.every((frame) => !JSON.stringify(frame).includes(fixtureKey)));
  source.close();
});

test("two profiles in two documents never share state", async () => {
  const otherKey = "W31fixtureKEY_second-profile_00000000000000";
  const scores = createFakeScores({ keys: { [fixtureKey]: fixtureProfile, [otherKey]: "w31-other" } });
  const first = setup({ scores });
  const second = setup({ scores, key: otherKey, profile: "w31-other" });
  scores.snapshot("game-live");
  scores.snapshot("game-no-result", "w31-other");
  await flush();
  assert.equal(first.source.state.game!.game.id, "00000000-0000-4000-8000-000000000011");
  assert.equal(second.source.state.game!.game.id, "00000000-0000-4000-8000-000000000012");
  scores.remove("w31-other");
  await flush();
  assert.equal(second.source.state.status, "unavailable");
  assert.equal(first.source.state.status, "live");
  first.source.close();
  second.source.close();
});
