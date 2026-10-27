# Scoreboard V2

> **Moved to PSGU Scores (2026-10):** see the notice in the [root README](../README.md). This
> branch is a frozen reference.

V2 is a full rewrite of the scoreboard platform with a modern, typed, realtime-first architecture.

## Goals

- Single deployable system with clear internal service boundaries.
- Adaptive polling of UltiScores with robust backoff and recovery.
- Typed websocket contracts with role-based clients.
- Dedicated applications for:
  - OBS views
  - Control panel
  - Commentator hub

## Directory Layout

- `apps/api` - FastAPI gateway (REST + websocket)
- `apps/control-panel` - Operator UI
- `apps/commentator-hub` - Commentator UI
- `apps/obs-views` - OBS-ready views
- `apps/scores-source` - shared Scores stream-profile source for views (see its README)
- `vendor/scores-live-client` - pinned official Scores live client (`PROVENANCE.md`)
- `services/reactive_poller` - Adaptive UltiScores polling engine
- `services/match_orchestrator` - Match selection and loop control
- `services/stats_engine` - Stats aggregation and advanced metrics
- `services/connection_registry` - Client identity, heartbeat, and view status
- `shared/contracts` - Typed models for REST and websocket payloads
- `infra` - Container/runtime assets

## Quick Start

Run these from the repository root (`/home/kuba/dev/scoreboard`):

1. Create virtualenv:
   - `python3 -m venv v2/.venv`
2. Install dependencies:
   - `v2/.venv/bin/python -m pip install -e 'v2[dev]'`
3. Configure endpoints:
   - copy `v2/.env.example` to `v2/.env`
   - for local testing data, keep `SCOREBOARD_V2_ENV=development` (uses `ULTISCORES_TEST_URL`)
   - to force a custom endpoint, set `ULTISCORES_URL`
4. Run API:
   - `PYTHONPATH=. v2/.venv/bin/uvicorn v2.apps.api.main:app --reload --host 0.0.0.0 --port 8100`
5. Open UIs:
   - `http://localhost:8100/control-panel`
   - `http://localhost:8100/commentator-hub`
   - `http://localhost:8100/obs/scoreboard`

## Frontend Build

Frontend apps are TypeScript-based and bundled with esbuild.

- Install frontend tooling:
  - `cd v2 && npm install`
- Build:
  - `npm run build:web`
- Watch:
  - `npm run watch:web`

## Scorebug from Scores (B06)

`/ui/obs/scoreboard.html` follows one Scores stream profile directly from the browser source; it
does not use this server's `/ws`, `/api/v1/snapshot` or UltiScores (only the one-shot
`/api/v1/obs-config` background colour). The other OBS views still use the legacy pipeline.

- URL (stable across games): `http://<scoreboard>/ui/obs/scoreboard.html#scores=<Scores origin>&profile=<slug>&key=<stream key>`.
  The origin must be `https:` (or `http:` on localhost/127.0.0.1/[::1]); the key goes only to the
  WebSocket auth frame and is never logged, rendered, stored or sent in a URL (the fragment stays
  in the browser). Add `&diag=1` for an operator status chip (not for air).
- On air: names, colours, logos, score, clock, possession (from `game.possession` only) and
  timeouts left of each side's limit; a goal or timeout banner on a live moment of the shown game
  (content from the snapshot; every live goal plays in order; never for what a first, switch or
  resync snapshot already holds, on replay, while degraded or for a restored goal on Scores
  `bb5ce05e` or later; retracted at once by its own void, a switch or a refusal). Operator-only:
  `data-source-freshness`, `data-source-clock` and the diag chip.
- Status: `<body data-source-status>` is `setup-error`, `connecting`, `live`, `degraded`
  (connection lost or a transient refusal: last score stays and the clock keeps running locally),
  `unavailable` (removed, or the key refused at auth or while connected: cleared at once) or
  `error` (unsupported payload). Nothing is on air without data; a missing result shows `-`, never
  `0`. Full rules and the accepted residuals (W31-D12, W31-D13) are in
  `apps/scores-source/README.md`.
- Operator-status bound: a silent network loss (half-open socket) is detected only by the live
  client's 45 s silence watchdog (checked every 15 s), so the status can read `live` for up to
  about 60 s while the board correctly keeps the score and runs the clock.
- Tests (from `v2/`): `npm test` (Node `node --test`: pin checksum, config, the pinned client
  against a fake Scores, bundle boundaries), `npm run typecheck`, `npm run test:browser` (headless
  Chromium from `~/.cache/ms-playwright`, ports 8131/8141 or `SCOREBOARD_PORT`/`FAKE_SCORES_PORT`).
- Updating the live client: `node scripts/pin-live-client.mjs --scores <Scores checkout> --ref <commit>`
  (`--candidate <note>` for a commit not yet on Scores main), then rebuild and commit the vendored
  files with the bundles (`vendor/scores-live-client/PROVENANCE.md`).

