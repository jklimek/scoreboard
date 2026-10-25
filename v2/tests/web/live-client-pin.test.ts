import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const vendor = new URL("../../vendor/scores-live-client/", import.meta.url);
const provenance = readFileSync(new URL("PROVENANCE.md", vendor), "utf8");
const rows = [...provenance.matchAll(/^\| `([^`]+)` \| `([^`]+)` \| `([0-9a-f]{40})` \| `([0-9a-f]{64})` \|$/gm)];

test("the provenance names the release commit and both pinned files", () => {
  assert.match(provenance, /^- Repository: `ultimatepolska\/scores`$/m);
  assert.match(provenance, /^- Release commit: `[0-9a-f]{40}`/m);
  assert.deepEqual(rows.map((row) => row[1]).sort(), ["live-client.d.ts", "live-client.js"]);
  const files = readdirSync(vendor).filter((name) => !name.startsWith(".") && name !== "PROVENANCE.md").sort();
  assert.deepEqual(files, ["live-client.d.ts", "live-client.js"]);
});

test("every pinned file is byte-identical to its recorded SHA-256", () => {
  for (const [, name, , , sha256] of rows) {
    const actual = createHash("sha256").update(readFileSync(new URL(name!, vendor))).digest("hex");
    assert.equal(actual, sha256, `${name} differs from PROVENANCE.md; re-pin with scripts/pin-live-client.mjs`);
  }
});
