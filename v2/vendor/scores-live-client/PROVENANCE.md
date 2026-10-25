# Scores live client (pinned copy)

Byte-exact copies of the official `@scores/live-client` browser module and its hand-written types.
Never edit these files: `tests/web/live-client-pin.test.ts` fails when a file's SHA-256 differs from
the table below.

- Repository: `ultimatepolska/scores`
- Candidate commit: `e06f964b477474068eb22e381d4e03daf386215a` (committed 2026-10-25T15:57:09Z)
- Status: B06-UP candidate on Scores branch `wave31/b06-upstream` (PR ultimatepolska/scores#219), not yet on Scores main. After #219 merges, rerun step 2 without `--candidate` on the merge commit (same bytes expected).
- Pinned: 2026-10-25
- The same `live-client.js` bytes are served publicly by every Scores deployment at
  `/broadcast/live-client.js`; the scoreboard bundles this copy with esbuild and never loads code
  from a Scores origin at runtime.

| File | Scores path | Last change | SHA-256 |
| ---- | ----------- | ----------- | ------- |
| `live-client.js` | `packages/live-client/src/live-client.js` | `e06f964b477474068eb22e381d4e03daf386215a` | `aa3cfeb2043ef13c9a344befb63ac9d968a12f3264f67753eee7accadbd2bfa0` |
| `live-client.d.ts` | `packages/live-client/src/live-client.d.ts` | `b4517c582d0a23d811282f02745090f0755ed67f` | `72b5a540d8142d7860bfc2e07a8b55818a1bdee5b69792e87aab7b568d9495f3` |

## Update procedure

1. In a Scores checkout, fetch the release commit to pin.
2. From `v2/`: `node scripts/pin-live-client.mjs --scores <scores checkout> --ref <commit>`
   (reads the files with `git show <commit>:packages/live-client/src/…` and rewrites this file).
3. `npm test && npm run build:web && npm run test:browser`, then commit the vendored files, this
   file and the rebuilt bundles together.
