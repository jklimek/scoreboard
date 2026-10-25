# Scores source

DOM-free TypeScript module shared by scoreboard views that follow a Scores stream profile.

- `config.ts`: parses the overlay fragment `#scores=<origin>&profile=<slug>&key=<key>[&diag=1]`
  (`https:` origins, `http:` only on loopback; Scores profile slug and 43-character base64url key
  patterns). Invalid or missing settings are a setup error and open no connection.
- `source.ts`: `createScoresSource(config)` wraps one pinned live client
  (`vendor/scores-live-client`) per document, WebSocket only, following only the channels the view
  needs (`stream:{slug}:game` for the scorebug). The key goes only to the client's first-frame
  `auth`; it is never logged, rendered, stored or put in a URL.
- `game.ts`: the typed part of the Scores `BroadcastGame` snapshot the scorebug renders (game id,
  team display name, primary colour and small logo, score and its source, possession, timeouts
  left/limit and their period, clock and its confidence, `freshness.ageWarning`, and the `goal`/
  `timeout` entries of the public timeline), with a structural check (an unsupported payload is an
  explicit `error`).
- `moments.ts`: the part of a B01 moment the scorebug acts on (`goal`, `timeout`, `event.voided`,
  `event.amended`; every other kind is ignored).
- `scorebug.ts`: pure scorebug view model, score/clock text, timeouts view and the score-bump rule.
  A logo loads only when its resolved origin is the configured Scores origin (relative paths
  resolve against it); another origin, a protocol-relative URL, credentials or a non-http(s) scheme
  mean no logo.
- `banners.ts`: goal and timeout banners: which live moment may enter, the content (always from
  the latest snapshot) and the one-at-a-time queue; the view only plays `show`/`refresh`/`hide`.

## What the scorebug shows

- Team names, colours and same-origin logos; the score (`-` when missing, never `0`); the clock.
- **Possession** from `game.possession` only (a marker on that team's card). It is null at BASIC
  and outside play, so nothing shows then; it is never guessed from `offence`.
- **Timeouts** left of each side's own `limit` (asymmetric limits, per game or per half): one dot
  per timeout up to five, a `left/limit` count above that, nothing when `left` is null (the log
  does not cover them) or the limit is 0. No fixed number of dots.
- Nothing is computed locally: no score arithmetic, no stats, no invented names or values.

## Banners (goal, timeout)

- A banner enters only on a **live** `goal` or `timeout` moment of the shown game (W31-D7 below),
  after a 300 ms settle window, one at a time (goal 6 s, timeout 5 s, at most two waiting).
- Its content is the moment's entry in the latest snapshot's timeline: a goal shows the scorer
  (display name, else first and last name, else short name, else `#number`; `#0` is a number),
  `Assist: …` or `Callahan`, and the score after the goal; a missing or hidden scorer shows the
  team, and a null assist (none, unknown or not public) shows nothing. A timeout shows the team
  and `n of limit left` when covered. Colours are the side's.
- It enters only when that entry is the newest of its kind in the snapshot and its id was not in
  an earlier snapshot of this game: an administrative restore (an undone void re-announces the
  goal's id), a backlog synced at once or a duplicate never celebrates. A void of a void (the undo
  that accompanies a restore) also retracts whatever entered since the latest snapshot, so a
  restore seen by a board reloaded during the void is cancelled inside the settle window.
- Corrections: every snapshot re-derives the waiting and shown banners (an amended assist updates
  the banner on air without a new entrance); a banner whose entry is gone (a voided goal) is
  retracted at once, and `event.voided` retracts its target, shown or waiting. The score always
  follows snapshots.
- Never animated: the initial snapshot and its history, replayed moments (`onReplay` is not used),
  anything while `degraded`; a game switch, `degraded` and every state without a game cancel the
  banner and the queue at once.
- A fresh live moment after a reconnect may enter its banner (it is not a replay).

### W31-D7: moment identity

Moments carry no game id. Within one channel the hub publishes in version order (a load sends its
snapshot, then that projection's moments); a switched game's earlier moments are part of its
first snapshot (`quietMoments`, never sent as moments) and leave the replay ring; the client drops
a live moment whose version is not newer than its latest snapshot. So a live moment newer than the
shown snapshot, while that snapshot is still the client's latest, belongs to the shown game. The
source checks exactly that (`status` live, `version >` the snapshot's, `client.get` still at the
snapshot) and drops anything else; the banner then also needs the id in that snapshot's timeline.
`tests/web/banners.test.ts` proves it with the pinned client: a stale-version moment after a
switch snapshot (also one whose id is in the new game), a moment published just before the switch,
and a reconnect across a switch with the old game's moment buffered.

## Operator-only signals

`freshness.ageWarning` (the scorer has gone silent) and `clock.confidence` (`uncertain`,
`unknown`) never change what is on air (Q77 spirit). They appear as `<body data-source-freshness>`
(`fresh`/`stale`), `<body data-source-clock>` (`good`/`uncertain`/`unknown`) and in the diag chip
(`stale`, `clock uncertain`); both attributes are removed when no game is shown.

## Status (Q77)

| Status        | Meaning                                                                         | On air                       |
| ------------- | ------------------------------------------------------------------------------- | ---------------------------- |
| `setup-error` | fragment missing or invalid; no network                                         | nothing                      |
| `connecting`  | no snapshot yet (also while the first socket cannot open)                       | nothing                      |
| `live`        | following the profile                                                           | the game                     |
| `degraded`    | connection lost after it worked, or a transient refusal or protocol error       | last game, clock keeps going |
| `unavailable` | `removed`, or the key or channel refused (`NOT_FOUND`)                          | nothing (cleared at once)    |
| `error`       | unsupported snapshot payload, or a protocol error before any data               | nothing                      |

`problem` (the diag chip, after the status) says why: `limit` (`LIMIT`, key at its connection
limit), `rate-limited` (`RATE_LIMITED`), `not-ready` (`NOT_READY`, Scores checks temporarily
failing) are transient: the client reconnects with backoff and the board keeps its last data.
`protocol` (`VALIDATION_ERROR`) with data on air is `degraded` (the last game stays, Q77), before any
data it is `error`.

- A key revoked, expired or archived while connected is refused with `error NOT_FOUND` before the
  server's 1008 close (Scores B06-UP), so the game clears at once on the open socket. A refused
  reconnect clears the same way.
- A 1008 close without a frame (Scores' verification-failure bound: key checks failing, the key
  is not known to be refused) is connectivity: `degraded`, data kept, then the reconnect resumes.
- W31-D12: if the network fails at the very moment of revocation, the refusal frame is lost and
  the board stays `degraded` until the next authenticated reconnect is refused (that is
  indistinguishable from connectivity loss; Q77 applies).
- W31-D13: the status follows the client's `open` callback. A reopened socket whose subscription
  stalls is bounded by the client's 30 s ack timeout (it then reconnects); what is on air is the
  same either way. No acknowledgement heuristics are added.
- A half-open socket (silent network loss) is noticed only by the client's 45 s silence watchdog,
  checked every 15 s: the status can stay `live` for up to about 60 s while the board keeps the
  score and runs the clock, then it turns `degraded`.
- Clock: the client keeps its server-time estimate across a reconnect until the new connection's
  first `serverNow` sample, so an OBS host clock that is off never moves the running clock after
  an unchanged resume (no snapshot).
- Score bumps: the first snapshot after any reconnect is the resync (or cannot be told apart from
  it) and never bumps, and only a snapshot ends that suppression (a live moment before it does
  not); later live snapshots of the same game bump the changed digits. Replayed moments never
  animate. Connection loss is never treated as a refusal.
- After a refusal the board shows again with the next snapshot the profile publishes; reloading
  the browser source shows the current one at once.
