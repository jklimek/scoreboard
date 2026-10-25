// Pins the official Scores live client into vendor/scores-live-client (the only update path).
// Usage: node scripts/pin-live-client.mjs --scores <scores checkout> --ref <commit>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "ultimatepolska/scores";
const sourceDir = "packages/live-client/src";
const files = ["live-client.js", "live-client.d.ts"];
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "scores-live-client");

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index > 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    console.error("Usage: node scripts/pin-live-client.mjs --scores <scores checkout> --ref <commit>");
    process.exit(2);
  }
  return value;
}

const checkout = argument("--scores");
const ref = argument("--ref");
const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { maxBuffer: 1 << 24 });
const text = (...args) => git(...args).toString("utf8").trim();

const commit = text("rev-parse", "--verify", `${ref}^{commit}`);
const committedAt = text("show", "-s", "--format=%cI", commit);
const pinned = files.map((name) => {
  const path = `${sourceDir}/${name}`;
  const bytes = git("show", `${commit}:${path}`);
  return {
    name,
    path,
    bytes,
    lastChange: text("log", "-1", "--format=%H", commit, "--", path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});

mkdirSync(target, { recursive: true });
for (const file of pinned) writeFileSync(join(target, file.name), file.bytes);

const rows = pinned.map(
  (file) => `| \`${file.name}\` | \`${file.path}\` | \`${file.lastChange}\` | \`${file.sha256}\` |`,
);
writeFileSync(
  join(target, "PROVENANCE.md"),
  `# Scores live client (pinned copy)

Byte-exact copies of the official \`@scores/live-client\` browser module and its hand-written types.
Never edit these files: \`tests/web/live-client-pin.test.ts\` fails when a file's SHA-256 differs from
the table below.

- Repository: \`${repository}\`
- Release commit: \`${commit}\` (committed ${committedAt})
- Pinned: ${new Date().toISOString().slice(0, 10)}
- The same \`live-client.js\` bytes are served publicly by every Scores deployment at
  \`/broadcast/live-client.js\`; the scoreboard bundles this copy with esbuild and never loads code
  from a Scores origin at runtime.

| File | Scores path | Last change | SHA-256 |
| ---- | ----------- | ----------- | ------- |
${rows.join("\n")}

## Update procedure

1. In a Scores checkout, fetch the release commit to pin.
2. From \`v2/\`: \`node scripts/pin-live-client.mjs --scores <scores checkout> --ref <commit>\`
   (reads the files with \`git show <commit>:${sourceDir}/…\` and rewrites this file).
3. \`npm test && npm run build:web && npm run test:browser\`, then commit the vendored files, this
   file and the rebuilt bundles together.
`,
);
console.log(`Pinned ${repository}@${commit}`);
for (const file of pinned) console.log(`  ${file.name} ${file.sha256}`);
