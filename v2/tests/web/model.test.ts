// S2-A1: the pure scorebug and banner models over every golden fixture (no invented values).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { bannerFor, playerLabel } from "../../apps/scores-source/src/banners.ts";
import { readGameSnapshot } from "../../apps/scores-source/src/game.ts";
import type { GameSnapshot } from "../../apps/scores-source/src/game.ts";
import { readMoment } from "../../apps/scores-source/src/moments.ts";
import { scoreText, scorebugModel, timeoutView } from "../../apps/scores-source/src/scorebug.ts";
import { fixture } from "../support/fake-scores.ts";

const origin = "https://scores.example.invalid";
const names = readdirSync(new URL("../fixtures/scores/", import.meta.url)).map((file) => file.replace(/\.json$/, "")).filter((name) => name !== "README.md");
const game = (name: string) => readGameSnapshot(fixture(name).data)!;
const model = (name: string) => scorebugModel(game(name), origin);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const banner = (name: string, n: number) => {
  const snapshot = game(name);
  return bannerFor(snapshot.timeline.find((entry) => entry.id === id(n))!, snapshot);
};
const edit = (name: string, change: (data: Record<string, any>) => void) => {
  const data = structuredClone(fixture(name).data) as Record<string, any>;
  change(data);
  return readGameSnapshot(data);
};

test("every snapshot fixture reads, every moment fixture is a moment", () => {
  const snapshots = names.filter((name) => name.startsWith("game-"));
  const moments = names.filter((name) => name.startsWith("moment-"));
  assert.equal(snapshots.length, 16);
  assert.equal(moments.length, 11);
  for (const name of snapshots) assert.ok(readGameSnapshot(fixture(name).data), name);
  assert.deepEqual(
    Object.fromEntries(moments.map((name) => [name, readMoment(fixture(name).data)?.kind])),
    {
      "moment-amended": "event.amended",
      "moment-goal": "goal",
      "moment-goal-callahan": "goal",
      "moment-goal-hidden": "goal",
      "moment-goal-named": "goal",
      "moment-goal-no-assist": "goal",
      "moment-restore": "event.voided",
      "moment-result-official": "other",
      "moment-revoid": "event.voided",
      "moment-timeout": "timeout",
      "moment-voided": "event.voided",
    },
  );
  assert.deepEqual(readMoment(fixture("moment-amended").data), { kind: "event.amended", id: id(321), targetId: id(302), targetKind: "goal" });
  assert.deepEqual(readMoment(fixture("moment-restore").data), { kind: "event.voided", id: id(323), targetId: id(322), targetKind: "event.voided" });
  assert.deepEqual(readMoment(fixture("moment-revoid").data), { kind: "event.voided", id: id(324), targetId: id(323), targetKind: "event.voided" });
  for (const data of [null, {}, { id: "x" }, { id: "x", kind: "event.voided" }]) assert.equal(readMoment(data), null);
});

test("possession comes only from game.possession, never from offence", () => {
  const sides = (name: string) => [model(name).home.possession, model(name).away.possession];
  assert.deepEqual(sides("game-live"), [false, false], "BASIC: null");
  assert.deepEqual(sides("game-standard"), [false, true], "offence home, possession away");
  assert.deepEqual(sides("game-standard-goal"), [false, false], "between points: null");
  assert.deepEqual(sides("game-hidden-stats"), [true, false]);
  assert.deepEqual(sides("game-result-only"), [false, false]);
  const offenceOnly = edit("game-standard", (data) => (data.possession = null))!;
  assert.equal(offenceOnly.possession, null);
  assert.deepEqual([scorebugModel(offenceOnly, origin).home.possession, scorebugModel(offenceOnly, origin).away.possession], [false, false]);
  assert.equal(edit("game-standard", (data) => (data.possession = "both")), null, "an unsupported value is an error");
});

test("timeouts: left of each side's limit, asymmetric, per game or half, hidden when not covered", () => {
  const views = (name: string) => [model(name).home.timeouts, model(name).away.timeouts];
  assert.deepEqual(views("game-asymmetric-timeouts"), [{ kind: "dots", active: 2, total: 3 }, { kind: "dots", active: 0, total: 1 }]);
  assert.equal(model("game-asymmetric-timeouts").timeoutsPer, "half");
  assert.deepEqual(views("game-live"), [{ kind: "dots", active: 1, total: 2 }, { kind: "dots", active: 2, total: 2 }]);
  assert.equal(model("game-live").timeoutsPer, "game");
  assert.deepEqual(views("game-result-only"), [{ kind: "none" }, { kind: "none" }], "manual result: not covered");
  assert.deepEqual(views("game-partial"), [{ kind: "none" }, { kind: "dots", active: 1, total: 2 }], "one side not covered");
  assert.deepEqual(views("game-no-result"), [{ kind: "none" }, { kind: "none" }]);
  // No fixed three-dot assumption: any limit, a count above five, nothing when none are allowed.
  assert.deepEqual(timeoutView({ left: 0, limit: 0 }), { kind: "none" });
  assert.deepEqual(timeoutView({ left: 4, limit: 5 }), { kind: "dots", active: 4, total: 5 });
  assert.deepEqual(timeoutView({ left: 3, limit: 7 }), { kind: "count", text: "3/7" });
  assert.deepEqual(timeoutView({ left: 9, limit: 2 }), { kind: "dots", active: 2, total: 2 });
  assert.deepEqual(timeoutView({ left: null, limit: 7 }), { kind: "none" });
});

test("player labels: permitted names only, then the jersey number, never an invented name", () => {
  const entry = (n: number) => game("game-jerseys").timeline.find((item) => item.id === id(n))!;
  assert.equal(playerLabel(entry(351).scorer), "#0", "jersey zero is a number");
  assert.equal(playerLabel(entry(351).assist), null, "no name and no number");
  assert.equal(playerLabel(entry(352).scorer), "#7");
  assert.equal(playerLabel(entry(352).assist), "W31 Short", "short name before the number");
  assert.equal(playerLabel(entry(354).scorer), "W31", "first name alone, empty number");
  assert.equal(playerLabel(entry(354).assist), null, "blank strings are no name");
  const standard = (n: number) => game("game-standard").timeline.find((item) => item.id === id(n))!;
  assert.equal(playerLabel(standard(311).scorer), "W31 Fixture Scorer", "display name first");
  assert.equal(playerLabel(standard(313).scorer), "W31 Handler", "first and last name");
  assert.equal(playerLabel(standard(314).scorer), "W31 Cutter", "short name");
  // Q36: every name hidden, the number stays.
  for (const entry of game("game-hidden-stats").timeline) assert.match(playerLabel(entry.scorer) ?? "", /^#\d+$/);
  assert.equal(playerLabel(null), null);
});

test("goal banners: scorer, assist, Callahan, no assist, hidden names, scoreline from the snapshot", () => {
  assert.deepEqual(banner("game-standard-goal", 302), {
    id: id(302), kind: "goal", side: "home", title: "GOAL", primary: "W31 Fixture Scorer", secondary: "Assist: W31 Fixture Thrower", scoreline: "6–4",
  });
  assert.equal(banner("game-standard-amended", 302).secondary, "Assist: W31 Handler");
  assert.deepEqual(
    [banner("game-standard-callahan", 303).primary, banner("game-standard-callahan", 303).secondary, banner("game-standard-callahan", 303).side],
    ["W31 Fixture Defender", "Callahan", "away"],
  );
  assert.equal(banner("game-standard-no-assist", 306).secondary, null, "no, unknown or hidden assist: nothing is claimed");
  assert.deepEqual([banner("game-hidden-stats", 307).primary, banner("game-hidden-stats", 307).secondary], ["#12", null]);
  // BASIC: no scorer known; the team is named, never "Unknown" or a guess.
  assert.deepEqual([banner("game-live-goal", 301).primary, banner("game-live-goal", 301).secondary, banner("game-live-goal", 301).scoreline], ["W31 Fixture Home", null, "4–2"]);
  assert.equal(banner("game-jerseys", 355).primary, "W31 Fixture Home", "a blank scorer falls back to the team");
  assert.equal(banner("game-jerseys", 355).secondary, "Assist: #0");
  const unknownPoint = edit("game-live-goal", (data) => (data.timeline.at(-1).scoreAfter = null))!;
  assert.equal(bannerFor(unknownPoint.timeline.at(-1)!, unknownPoint).scoreline, null, "no score is invented");
  const noTeam = edit("game-live-goal", (data) => (data.teams.home = null))!;
  assert.equal(bannerFor(noTeam.timeline.at(-1)!, noTeam).primary, "Home");
});

test("timeout banners: the team and its timeouts left when covered", () => {
  assert.deepEqual(banner("game-standard-timeout", 304), {
    id: id(304), kind: "timeout", side: "home", title: "TIMEOUT", primary: "W31 Fixture Home", secondary: "1 of 2 left this half", scoreline: null,
  });
  assert.equal(banner("game-live", 296).secondary, "1 of 2 left");
  const uncovered = edit("game-standard-timeout", (data) => (data.timeouts.home = { used: null, left: null, limit: 2 }))!;
  assert.equal(bannerFor(uncovered.timeline.at(-1)!, uncovered).secondary, null);
});

test("coverage: a result-only game shows the official score and nothing it does not know", () => {
  const result = model("game-result-only");
  assert.deepEqual(result.score, { home: 13, away: 11, source: "official" });
  assert.deepEqual(game("game-result-only").timeline, []);
  assert.deepEqual(result.operator, { stale: false, clock: "unknown" });
  const missing = model("game-no-result");
  assert.deepEqual([scoreText(missing.score.home), scoreText(missing.score.away)], ["-", "-"]);
  assert.deepEqual(model("game-partial").operator, { stale: true, clock: "uncertain" });
  assert.deepEqual(model("game-standard").operator, { stale: false, clock: "good" });
  // Duplicate and missing jersey numbers are only printed, never used to look a player up.
  assert.equal(game("game-jerseys").timeline.length, 5);
});

test("missing logos and colours fall back to neutral, never to another source", () => {
  const bug = model("game-no-logos");
  assert.deepEqual([bug.home.logoUrl, bug.away.logoUrl, bug.home.colour, bug.away.colour], [null, null, null, null]);
  assert.deepEqual([bug.home.name, bug.away.name], ["W31 Fixture Home", "W31 Fixture Away"]);
});

test("an unsupported snapshot is an error, not a partial view", () => {
  const broken: ((data: Record<string, any>) => void)[] = [
    (data) => (data.clock.confidence = "maybe"),
    (data) => (data.freshness = {}),
    (data) => (data.timeouts.per = "quarter"),
    (data) => (data.timeline = null),
    (data) => (data.timeline[0].side = "left"),
    (data) => (data.timeline[0].scorer = { number: 7 }),
    (data) => (data.timeline[0].scoreAfter = { home: -1, away: 0 }),
  ];
  for (const change of broken) assert.equal(edit("game-live", change), null, String(change));
  const other = edit("game-live", (data) => data.timeline.push({ id: id(999), kind: "turnover", side: "home" }))!;
  assert.equal(other.timeline.length, 6, "other kinds are not banner entries");
});

test("the golden snapshot ids are distinct games where they should be", () => {
  const ids = (list: string[]) => new Set(list.map((name) => (game(name) as GameSnapshot).gameId)).size;
  assert.equal(ids(["game-live", "game-live-goal", "game-official"]), 1);
  assert.equal(ids(["game-standard", "game-standard-goal", "game-standard-amended", "game-standard-callahan", "game-standard-timeout", "game-standard-no-assist"]), 1);
  assert.equal(ids(["game-live", "game-no-result", "game-standard", "game-hidden-stats", "game-result-only", "game-partial", "game-jerseys", "game-no-logos", "game-asymmetric-timeouts"]), 9);
});
