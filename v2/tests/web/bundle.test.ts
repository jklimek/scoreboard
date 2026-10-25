// The committed scorebug bundle talks only to Scores through the pinned client (S1-A4).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const bundle = read("apps/obs-views/public/scorebug.js");

test("the scoreboard page loads the scorebug bundle, not the legacy one", () => {
  const page = read("apps/obs-views/public/scoreboard.html");
  assert.match(page, /<script type="module" src="\.\/scorebug\.js"><\/script>/);
  assert.doesNotMatch(page, /main\.js/);
});

test("the scorebug bundle has no legacy snapshot API, Python /ws or UltiScores reference", () => {
  assert.doesNotMatch(bundle, /\/api\/v1\/snapshot/);
  assert.doesNotMatch(bundle, /ultiscores/i);
  assert.doesNotMatch(bundle, /location\.host\b/);
  assert.doesNotMatch(bundle, /request_snapshot|clientRole/);
  const sockets = [...bundle.matchAll(/\/ws\b/g)].map((match) => bundle.slice(match.index - 9, match.index + 3));
  assert.ok(sockets.length > 0);
  assert.deepEqual([...new Set(sockets)], ["/api/live/ws"], "the only socket path is the Scores live endpoint");
});

test("the scorebug stores nothing in the browser", () => {
  assert.doesNotMatch(bundle, /localStorage|sessionStorage|document\.cookie|indexedDB/);
});

test("the bundle is built from the byte-exact pinned client", () => {
  const map = JSON.parse(read("apps/obs-views/public/scorebug.js.map")) as { sources: string[]; sourcesContent: string[] };
  const index = map.sources.findIndex((path) => path.endsWith("vendor/scores-live-client/live-client.js"));
  assert.ok(index >= 0);
  assert.equal(map.sourcesContent[index], read("vendor/scores-live-client/live-client.js"));
  assert.equal(map.sources.filter((path) => path.includes("live-client")).length, 1);
});
