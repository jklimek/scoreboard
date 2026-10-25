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
  team display name, primary colour and small logo, score and its source, timeouts left/limit,
  clock), with a structural check (an unsupported payload is an explicit `error`).
- `scorebug.ts`: pure scorebug view model, score/clock text and the score-bump rule. A logo loads
  only when its resolved origin is the configured Scores origin (relative paths resolve against
  it); another origin, a protocol-relative URL, credentials or a non-http(s) scheme mean no logo.

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
- Animations: the first snapshot after any reconnect is the resync (or cannot be told apart from
  it) and never animates; later live snapshots of the same game bump the changed digits. Replayed
  moments never animate. Connection loss is never treated as a refusal.
- After a refusal the board shows again with the next snapshot the profile publishes; reloading
  the browser source shows the current one at once.
