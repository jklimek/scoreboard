# Scores source

DOM-free TypeScript module shared by scoreboard views that follow a Scores stream profile.

- `config.ts`: parses the overlay fragment `#scores=<origin>&profile=<slug>&key=<key>[&diag=1]`
  (`https:` origins, `http:` only on loopback; Scores profile slug and 43-character base64url key
  patterns). Invalid or missing settings are a setup error and open no connection.
- `source.ts`: `createScoresSource(config)` wraps one pinned live client
  (`vendor/scores-live-client`) per document, WebSocket only, following only the channels the view
  needs (`stream:{slug}:game` for the scorebug). The key goes only to the client's first-frame
  `auth`; it is never logged, rendered, stored or put in a URL.
- `game.ts`: the typed part of the Scores `BroadcastGame` snapshot the views read, with a
  structural check (an unsupported payload is an explicit `error`).
- `scorebug.ts`: pure scorebug view model, score/clock text and the score-bump rule.

## Status (Q77)

| Status        | Meaning                                                               | On air                       |
| ------------- | --------------------------------------------------------------------- | ---------------------------- |
| `setup-error` | fragment missing or invalid; no network                               | nothing                      |
| `connecting`  | no snapshot yet (also while the first socket cannot open)             | nothing                      |
| `live`        | following the profile                                                 | the game                     |
| `degraded`    | connection lost after it worked                                       | last game, clock keeps going |
| `unavailable` | `removed`, or the key or channel refused (`NOT_FOUND`)                 | nothing (cleared at once)    |
| `error`       | unsupported snapshot payload or protocol mismatch                     | nothing                      |

A reconnect returns to `live`; the next snapshot replaces the state without animating. A revoked
key is noticed on the refused reconnect (the server closes keyed sockets without a reason frame),
so the game clears within the first backoff delay (about 1 s). Connection loss is never treated as
a refusal.
