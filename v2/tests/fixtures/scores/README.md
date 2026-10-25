# Synthetic Scores fixtures

Hand-made `stream:w31-fixture:game` envelopes in the Scores B01/B04 shapes (`BroadcastGame` snapshots,
a `goal` moment, a `removed` message). All names, ids and colours are invented (`W31 Fixture …`,
`00000000-0000-4000-8000-…` ids); no real teams, people or keys. The test fake server re-stamps
`version` and `serverNow` when it sends them.

They were validated once against the Scores contracts (`broadcastEnvelopeSchema`,
`broadcastGameSchema`, `broadcastMomentSchema` at Scores `78d4ecc2`). Re-validate after editing.
