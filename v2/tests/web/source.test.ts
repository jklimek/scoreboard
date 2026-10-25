// The actual pinned live client, driven through the source module by a fake Scores that speaks the
// real WebSocket protocol, with mocked timers and clock.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { parseScoresFragment } from "../../apps/scores-source/src/config.ts";
import { createScoresSource } from "../../apps/scores-source/src/source.ts";
import type { ScoresSource, SourceUpdate } from "../../apps/scores-source/src/source.ts";
import { clockText, formatClock, scoreBumps, scoreText, scorebugModel } from "../../apps/scores-source/src/scorebug.ts";
import { createFakeScores, fakeWebSocket, fixture, fixtureKey, fixtureProfile } from "../support/fake-scores.ts";

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
  assert.deepEqual({ name: bug.home.name, colour: bug.home.colour }, { name: "W31 Fixture Home", colour: "#1b6f7d" });
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
  assert.equal(bug.away.colour, null);
  assert.equal(bug.home.colour, null);
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
  // A goal happened during the outage: the hub versions the snapshot and buffers the moment.
  scores.snapshot("game-live-goal");
  const missed = scores.moment("moment-goal");
  const before = scores.sent.length;
  control.down = false;
  await advance(30_000);
  assert.equal(source.state.status, "live");
  assert.deepEqual(model(source).score, { home: 4, away: 2, source: "observed" });
  const resync = updates.findLast((update) => update.state.game !== update.previous.game)!;
  assert.equal(resync.liveSnapshot, false);
  assert.deepEqual(scoreBumps(resync), { home: false, away: false });
  // The reopened socket authenticated first again and resumed by version; the hub sent the
  // retained snapshot restamped with the current server time, then replayed the missed moment.
  const last = frames(control.sockets.at(-1)!.sent);
  assert.equal(last[0]!.op, "auth");
  assert.deepEqual(Object.keys((last[1]!.resume ?? {}) as object), [channel]);
  const answer = scores.sent.slice(before).filter((frame) => frame.v === 1);
  assert.deepEqual(answer.map((frame) => [frame.type, frame.replay]), [["snapshot", undefined], ["moment", true]]);
  assert.equal(answer[1]!.version, missed.version);
  assert.ok(Date.parse(String(answer[0]!.serverNow)) > Date.parse(missed.serverNow), "restamped on resubscribe");
  // The first live snapshot after the resync may bump the changed digits.
  scores.snapshot("game-official");
  await flush();
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: true, away: true });
  source.close();
});

test("animations: never on the first render, a game switch, or the first snapshot after a reconnect", async () => {
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
  // Nothing missed: the client's resume cursor trails (snapshots do not advance it), so the hub
  // resends the retained snapshot, which the client drops as already applied. Same game, live.
  const shown = source.state.game;
  const done = updates.length;
  scores.dropAll();
  await advance(2000);
  assert.equal(source.state.status, "live");
  assert.deepEqual(updates.slice(done).map((update) => [update.state.status, update.state.game === shown]), [
    ["degraded", true],
    ["live", true],
  ]);
  // Whether a snapshot is the resync answer or news is not visible to the source: the first one
  // after a reconnect never animates (conservative); a live moment or snapshot ends the resync.
  scores.snapshot("game-live-goal");
  scores.moment("moment-goal");
  await flush();
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: false, away: false });
  scores.snapshot("game-official");
  await flush();
  assert.deepEqual(scoreBumps(updates.at(-1)!), { home: true, away: true });
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

test("Q77: a key revoked while connected clears the game at once, before any reconnect", async () => {
  const { scores, control, source, updates } = setup();
  scores.snapshot("game-live");
  await flush();
  let socketsAtClear = 0;
  const done = updates.length;
  scores.revoke();
  // The server says `error NOT_FOUND` (no channel) before its 1008 close (B06-UP).
  assert.deepEqual(scores.sent.at(-1), { op: "error", code: "NOT_FOUND", message: "Unknown stream key" });
  await flush();
  assert.deepEqual(source.state, { status: "unavailable", game: null, problem: null });
  socketsAtClear = control.sockets.length;
  assert.equal(socketsAtClear, 1, "cleared on the frame, not on a refused reconnect");
  assert.deepEqual(
    updates.slice(done).map((update) => update.state.status),
    ["unavailable"],
    "never degraded on the way",
  );
  await advance(10 * 60_000, 5000);
  assert.ok(control.sockets.length > 2, "the client keeps retrying with backoff");
  assert.equal(source.state.status, "unavailable");
  assert.ok(updates.slice(done).every((update) => update.state.game === null));
  source.close();
});

test("Q77: the verification-failure bound closes without a frame: degraded, data kept, then live", async () => {
  const { scores, control, source, updates } = setup();
  scores.snapshot("game-live");
  await flush();
  const shown = source.state.game;
  const done = updates.length;
  scores.overdue();
  await flush();
  assert.equal(source.state.status, "degraded");
  assert.equal(source.state.game, shown);
  await advance(2000);
  assert.equal(control.sockets.length, 2);
  assert.equal(source.state.status, "live");
  assert.equal(source.state.game, shown, "unchanged resume: the same game, no resync snapshot");
  assert.ok(updates.slice(done).every((update) => update.state.game === shown));
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

for (const fault of ["LIMIT", "NOT_READY"] as const)
  test(`a transient auth refusal (${fault}) on reconnect is degraded and never clears the board`, async () => {
    const { scores, control, source, updates } = setup();
    scores.snapshot("game-live");
    await flush();
    const shown = source.state.game;
    const done = updates.length;
    scores.faults.auth = fault;
    scores.dropAll();
    await advance(2 * 60_000, 1000);
    assert.ok(control.sockets.length > 3, "the client retries with backoff");
    assert.deepEqual(source.state, { status: "degraded", game: shown, problem: fault === "LIMIT" ? "limit" : "not-ready" });
    assert.equal(clockText(source.state.game!.clock, source.serverNow()), "12:00", "the clock keeps running");
    assert.ok(updates.slice(done).every((update) => update.state.game === shown && update.state.status !== "unavailable"));
    scores.faults.auth = undefined;
    await advance(31_000);
    assert.deepEqual(source.state, { status: "live", game: shown, problem: null });
    source.close();
  });

test("RATE_LIMITED is degraded with the last game kept, then the reconnect resumes", async () => {
  const { scores, source } = setup();
  scores.snapshot("game-live");
  await flush();
  const shown = source.state.game;
  scores.rateLimit();
  await flush();
  assert.deepEqual(source.state, { status: "degraded", game: shown, problem: "rate-limited" });
  await advance(2000);
  assert.deepEqual(source.state, { status: "live", game: shown, problem: null });
  source.close();
});

test("a VALIDATION_ERROR with data on air is surfaced as degraded (protocol) and keeps the game", async () => {
  const { scores, control, source } = setup();
  scores.snapshot("game-live");
  await flush();
  const shown = source.state.game;
  // A protocol mismatch on the reopened socket: the subscribe is rejected and never acknowledged.
  scores.faults.invalidChannels = true;
  scores.dropAll();
  await advance(2000);
  assert.deepEqual(source.state, { status: "degraded", game: shown, problem: "protocol" });
  // W31-D13: the client's 30 s ack timeout bounds the stalled subscription, then it reconnects.
  scores.faults.invalidChannels = false;
  await advance(32_000);
  assert.ok(control.sockets.length >= 3);
  assert.deepEqual(source.state, { status: "live", game: shown, problem: null });
  source.close();
});

test("a VALIDATION_ERROR before any data is an explicit error with nothing shown", async () => {
  const scores = createFakeScores();
  scores.faults.invalidChannels = true;
  const { source } = setup({ scores });
  await flush();
  assert.deepEqual(source.state, { status: "error", game: null, problem: "protocol" });
  source.close();
});

for (const [label, skewMs] of [["2 minutes ahead", 120_000], ["1 minute behind", -60_000]] as const)
  test(`an OBS host clock ${label} never moves the running clock across an unchanged reconnect`, async () => {
    // The host (mocked Date) differs from Scores time by `skewMs`.
    const scores = createFakeScores({ now: () => Date.now() - skewMs });
    const { control, source, updates } = setup({ scores });
    const data = structuredClone(fixture("game-live").data) as { clock: { anchorServerTs: string } };
    data.clock.anchorServerTs = new Date(Date.now() - skewMs).toISOString();
    scores.snapshotData(data);
    await flush();
    const ticks: number[] = [];
    const stop = source.tickClock((ms) => ticks.push(ms), 1000);
    await advance(5000);
    assert.equal(formatClock(ticks.at(-1)!), "10:05");
    const snapshots = updates.length;
    const before = scores.sent.length;
    scores.dropAll();
    await advance(2000);
    assert.equal(control.sockets.length, 2);
    assert.equal(source.state.status, "live");
    // Unchanged resume: no envelope at all on the new connection, so no new `serverNow` sample.
    assert.deepEqual(scores.sent.slice(before).map((frame) => frame.op ?? frame.type), ["subscribed"]);
    assert.equal(updates.length, snapshots + 2, "degraded, then live: no resync snapshot");
    assert.equal(formatClock(ticks.at(-1)!), "10:07", "the estimate survives the reopen");
    // The new connection's first pong (15 s keep-alive) replaces the estimate without a jump.
    await advance(20_000);
    assert.equal(formatClock(ticks.at(-1)!), "10:27");
    for (let index = 1; index < ticks.length; index++) {
      const step = ticks[index]! - ticks[index - 1]!;
      assert.ok(step >= 0 && step <= 1000, `tick ${index} moved by ${step} ms`);
    }
    stop();
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
  assert.equal(first.source.state.game!.gameId, "00000000-0000-4000-8000-000000000011");
  assert.equal(second.source.state.game!.gameId, "00000000-0000-4000-8000-000000000012");
  scores.remove("w31-other");
  await flush();
  assert.equal(second.source.state.status, "unavailable");
  assert.equal(first.source.state.status, "live");
  first.source.close();
  second.source.close();
});
