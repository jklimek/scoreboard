# Scores live client (pinned copy)

Byte-exact copies of the official `@scores/live-client` browser module and its hand-written types.
Never edit these files: `tests/web/live-client-pin.test.ts` fails when a file's SHA-256 differs from
the table below.

- Repository: `ultimatepolska/scores`
- Release commit: `78d4ecc277ea8f2fb71c1ca08ba5ed51274a1733` (committed 2026-10-25T01:57:57+02:00)
- Pinned: 2026-10-25
- The same `live-client.js` bytes are served publicly by every Scores deployment at
  `/broadcast/live-client.js`; the scoreboard bundles this copy with esbuild and never loads code
  from a Scores origin at runtime.

| File | Scores path | Last change | SHA-256 |
| ---- | ----------- | ----------- | ------- |
| `live-client.js` | `packages/live-client/src/live-client.js` | `b4517c582d0a23d811282f02745090f0755ed67f` | `425b249985b9b5a98fefcbb5742b81d2550f77bc65cd7044edfa807bae89cc79` |
| `live-client.d.ts` | `packages/live-client/src/live-client.d.ts` | `b4517c582d0a23d811282f02745090f0755ed67f` | `72b5a540d8142d7860bfc2e07a8b55818a1bdee5b69792e87aab7b568d9495f3` |

## Update procedure

1. In a Scores checkout, fetch the release commit to pin.
2. From `v2/`: `node scripts/pin-live-client.mjs --scores <scores checkout> --ref <commit>`
   (reads the files with `git show <commit>:packages/live-client/src/…` and rewrites this file).
3. `npm test && npm run build:web && npm run test:browser`, then commit the vendored files, this
   file and the rebuilt bundles together.
