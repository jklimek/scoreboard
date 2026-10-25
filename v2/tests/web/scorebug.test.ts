import assert from "node:assert/strict";
import { test } from "node:test";
import { readGameSnapshot } from "../../apps/scores-source/src/game.ts";
import type { GameSnapshot } from "../../apps/scores-source/src/game.ts";
import { resolveLogoUrl, scoreBumps } from "../../apps/scores-source/src/scorebug.ts";
import type { SourceState } from "../../apps/scores-source/src/source.ts";
import { fixture } from "../support/fake-scores.ts";

const origin = "https://scores.example.invalid";
const game = (name: string) => readGameSnapshot(fixture(name).data)!;
const live = (value: GameSnapshot | null): SourceState => ({ status: value ? "live" : "unavailable", game: value, problem: null });

test("every snapshot fixture reads as a game; other payloads do not", () => {
  for (const name of ["game-live", "game-live-goal", "game-official", "game-no-result"]) assert.ok(game(name), name);
  for (const data of [null, [], "x", { game: {} }, { ...fixture("game-live").data as object, score: { home: -1, away: 0, source: "observed" } }])
    assert.equal(readGameSnapshot(data), null);
  const colour = structuredClone(fixture("game-live").data) as { teams: { home: { colours: { primary: string } } } };
  colour.teams.home.colours.primary = "red";
  assert.equal(readGameSnapshot(colour), null);
});

test("logo URLs resolve against the Scores origin and only to http(s)", () => {
  assert.equal(resolveLogoUrl("/api/public/v1/broadcast/logos/a/128?v=1", origin), `${origin}/api/public/v1/broadcast/logos/a/128?v=1`);
  assert.equal(resolveLogoUrl("https://cdn.example.invalid/logo.png", origin), "https://cdn.example.invalid/logo.png");
  assert.equal(resolveLogoUrl("javascript:alert(1)", origin), null);
  assert.equal(resolveLogoUrl("data:image/png;base64,AAAA", origin), null);
});

test("score bumps need a live snapshot of the same game with a changed, known score", () => {
  const before = game("game-live");
  const after = game("game-live-goal");
  assert.deepEqual(scoreBumps({ previous: live(before), state: live(after), liveSnapshot: true }), { home: true, away: false });
  assert.deepEqual(scoreBumps({ previous: live(before), state: live(after), liveSnapshot: false }), { home: false, away: false });
  assert.deepEqual(scoreBumps({ previous: live(null), state: live(after), liveSnapshot: true }), { home: false, away: false });
  const unknown = { ...after, score: { home: null, away: null, source: "none" as const } };
  assert.deepEqual(scoreBumps({ previous: live(before), state: live(unknown), liveSnapshot: true }), { home: false, away: false });
  assert.deepEqual(scoreBumps({ previous: live(before), state: live(game("game-no-result")), liveSnapshot: true }), { home: false, away: false });
});
