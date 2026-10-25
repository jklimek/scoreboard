import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScoresFragment, parseScoresOrigin } from "../../apps/scores-source/src/config.ts";
import { createScoresSource } from "../../apps/scores-source/src/source.ts";
import { fixtureKey } from "../support/fake-scores.ts";

const fragment = (params: Record<string, string>) => `#${new URLSearchParams(params)}`;
const valid = { scores: "https://scores.example.invalid", profile: "w31-fixture", key: fixtureKey };

test("a valid fragment yields the origin, profile and a non-enumerable key", () => {
  const result = parseScoresFragment(fragment({ ...valid, diag: "1" }));
  assert.ok(result.ok);
  assert.equal(result.config.origin, "https://scores.example.invalid");
  assert.equal(result.config.profile, "w31-fixture");
  assert.equal(result.config.key, fixtureKey);
  assert.equal(result.config.diag, true);
  // The key never shows up when the config is serialized, spread or logged.
  assert.doesNotMatch(JSON.stringify(result.config), new RegExp(fixtureKey));
  assert.equal(Object.keys(result.config).includes("key"), false);
});

test("origins: https anywhere, http only on loopback, never a path or credentials", () => {
  for (const origin of ["https://scores.example.invalid", "https://scores.example.invalid/", "https://scores.example.invalid:8443"])
    assert.ok(parseScoresOrigin(origin), origin);
  for (const origin of ["http://localhost:8141", "http://127.0.0.1:8141", "http://[::1]:8141"])
    assert.ok(parseScoresOrigin(origin), origin);
  for (const origin of [
    "http://scores.example.invalid",
    "http://192.168.1.10:8141",
    "ws://localhost:8141",
    "ftp://scores.example.invalid",
    "javascript:alert(1)",
    "https://scores.example.invalid/api",
    "https://scores.example.invalid/?x=1",
    "https://user:pass@scores.example.invalid",
    "scores.example.invalid",
    "",
  ])
    assert.equal(parseScoresOrigin(origin), null, origin);
});

test("invalid or missing settings are setup errors", () => {
  const cases: [Record<string, string>, string][] = [
    [{ profile: valid.profile, key: valid.key }, "missing-origin"],
    [{ ...valid, scores: "http://scores.example.invalid" }, "invalid-origin"],
    [{ scores: valid.scores, key: valid.key }, "missing-profile"],
    [{ ...valid, profile: "W31-Fixture" }, "invalid-profile"],
    [{ ...valid, profile: "ab" }, "invalid-profile"],
    [{ ...valid, profile: "-w31-" }, "invalid-profile"],
    [{ ...valid, profile: "w".repeat(49) }, "invalid-profile"],
    [{ scores: valid.scores, profile: valid.profile }, "missing-key"],
    [{ ...valid, key: fixtureKey.slice(1) }, "invalid-key"],
    [{ ...valid, key: `${fixtureKey}A` }, "invalid-key"],
    [{ ...valid, key: `${fixtureKey.slice(1)}+` }, "invalid-key"],
  ];
  for (const [params, problem] of cases) {
    const result = parseScoresFragment(fragment(params));
    assert.equal(result.ok, false, problem);
    assert.equal(!result.ok && result.problem, problem);
  }
  assert.deepEqual(parseScoresFragment(""), { ok: false, problem: "missing-origin", diag: false });
});

test("a setup error never opens a connection", () => {
  let sockets = 0;
  let requests = 0;
  const source = createScoresSource(parseScoresFragment(fragment({ ...valid, key: "short" })), {
    WebSocket: class {
      constructor() {
        sockets++;
      }
    } as unknown as typeof WebSocket,
    fetch: (async () => {
      requests++;
      return new Response();
    }) as typeof fetch,
  });
  assert.deepEqual(source.state, { status: "setup-error", game: null, problem: "invalid-key" });
  assert.deepEqual(source.channels, []);
  source.tickClock(() => assert.fail("no clock without a source"))();
  source.close();
  assert.equal(sockets, 0);
  assert.equal(requests, 0);
});
