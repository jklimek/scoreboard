# Synthetic Scores fixtures

Hand-made `stream:w31-fixture:game` envelopes in the Scores B01/B04 shapes (`BroadcastGame` snapshots,
B01 moments, a `removed` message). All names, ids and colours are invented (`W31 Fixture …`,
`00000000-0000-4000-8000-…` ids); no real teams, people or keys. The test fake server re-stamps
`version` and `serverNow` when it sends them.

| Fixture | Golden case |
| ------- | ----------- |
| `game-live`, `game-live-goal` | BASIC: no possession, scorers unknown, goal `…301` |
| `game-standard` (+ `-goal`, `-amended`, `-callahan`, `-no-assist`, `-timeout`) | STANDARD: names, possession, timeouts per half; goal `…302` and its amendment, Callahan `…303`, timeout `…304`, no assist `…306` |
| `game-hidden-stats` | Q36: every name null, players and leaders empty, numbers kept; goal `…307` |
| `game-result-only` | manual result: `score.source` official, `observed` null, sequence unavailable |
| `game-partial` | partial coverage, one side's timeouts not covered, `clock.confidence` uncertain, `ageWarning` |
| `game-jerseys` | zero, missing and duplicate jersey numbers; name fallbacks |
| `game-no-logos` | no logos and no colours |
| `game-asymmetric-timeouts` | per half, limits 3 and 1 |
| `game-official`, `game-no-result` | official result; a scheduled game without a result or away team |
| `moment-*` | goal (`…301` unnamed, `…302` named, `…303` Callahan, `…306` no assist, `…307` hidden names), timeout, `event.amended`, `event.voided` (`…322`), its undo (restore, `…323`) and the undo's void (`…324`), `result.official` |

They were validated against the Scores contracts (`broadcastEnvelopeSchema`, `broadcastGameSchema`,
`broadcastMomentSchema` at Scores `bb5ce05e`, W31 B06-UP). Re-validate after editing. The restore
sequence follows `bb5ce05e`: a restore is the snapshot and the undo only, never the goal again.
