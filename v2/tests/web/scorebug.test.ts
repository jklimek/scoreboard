import assert from "node:assert/strict";
import { test } from "node:test";
import { readGameSnapshot } from "../../apps/scores-source/src/game.ts";
import type { GameSnapshot } from "../../apps/scores-source/src/game.ts";
import { resolveLogoUrl, scoreBumps, scorebugModel } from "../../apps/scores-source/src/scorebug.ts";
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

test("logos load only from the configured Scores origin", () => {
  const path = "/api/public/v1/broadcast/logos/a/128?v=1";
  assert.equal(resolveLogoUrl(path, origin), `${origin}${path}`);
  assert.equal(resolveLogoUrl("api/public/v1/broadcast/logos/a/128", origin), `${origin}/api/public/v1/broadcast/logos/a/128`);
  assert.equal(resolveLogoUrl(`${origin}${path}`, origin), `${origin}${path}`);
  for (const url of [
    "https://cdn.example.invalid/logo.png", // another origin
    "//cdn.example.invalid/logo.png", // protocol-relative
    "/\\cdn.example.invalid/logo.png", // parsed as protocol-relative
    "http://scores.example.invalid/logo.png", // another scheme of the same host
    "https://scores.example.invalid:8443/logo.png", // another port
    "https://user:secret@scores.example.invalid/logo.png", // credentials
    "https://user@scores.example.invalid/logo.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    `blob:${origin}/00000000-0000-4000-8000-000000000000`,
    "http://[bad",
  ])
    assert.equal(resolveLogoUrl(url, origin), null, url);
});

test("an external logo in a snapshot is no logo (the neutral fallback)", () => {
  const data = structuredClone(fixture("game-live").data) as { teams: { home: { logo: { small: string } } } };
  data.teams.home.logo.small = "https://cdn.example.invalid/logo.png";
  assert.equal(scorebugModel(readGameSnapshot(data)!, origin).home.logoUrl, null);
});

test("the projection keeps only what the scorebug and its banners render", () => {
  assert.deepEqual(game("game-live"), {
    gameId: "00000000-0000-4000-8000-000000000011",
    teams: {
      home: {
        displayName: "W31 Fixture Home",
        primary: "#1b6f7d",
        logo: "/api/public/v1/broadcast/logos/00000000-0000-4000-8000-000000000201/128?v=1",
      },
      away: { displayName: "W31 Fixture Away", primary: "#f5b301", logo: null },
    },
    score: { home: 3, away: 2, source: "observed" },
    // S2: possession, the timeout period, clock confidence, freshness and the goal/timeout timeline.
    possession: null,
    timeouts: { per: "game", home: { left: 1, limit: 2 }, away: { left: 2, limit: 2 } },
    clock: { running: true, elapsedMs: 600000, anchorServerTs: "2026-10-25T10:20:00.000Z", confidence: "good" },
    ageWarning: false,
    timeline: ["291", "292", "293", "296", "294", "295"].map((n) => {
      const id = `00000000-0000-4000-8000-000000000${n}`;
      const timeout = n === "296";
      return {
        id,
        kind: timeout ? "timeout" : "goal",
        side: ["291", "293", "295", "296"].includes(n) ? "home" : "away",
        scoreAfter: timeout ? null : { "291": { home: 1, away: 0 }, "292": { home: 1, away: 1 }, "293": { home: 2, away: 1 }, "294": { home: 2, away: 2 }, "295": { home: 3, away: 2 } }[n]!,
        scorer: null,
        assist: null,
        callahan: false,
      };
    }),
  });
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
