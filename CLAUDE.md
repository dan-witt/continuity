# continuity

## Tickets
This repo has no ticketing system. Commits carry the narrative directly; the anchor
ledger is the durable record. The deviation from the global ticket rule is deliberate.

## What must never be committed
The instance key (`*.key`), the anchor ledger, and the agent's digests and injected
context are per-container instance data. `coverage.json` declares them hash_only and
`guard.js` fails closed if any is staged or becomes trackable. When syncing from a
container, verify the key bytes appear in no file before staging — the file that reads
`1f916.key` at runtime is fine; a file containing it is not.

## Relationship to the container
Tooling is developed in the agent container against its own instance repo, where this
directory is a subdirectory rather than the root. Scripts resolve the repo as
`path.resolve(__dirname, "..")` and expect that layout. `fixtures/` is pinned by sha256
to the commits it precedes; `canary.js` case 0 asserts the pins, so a fixture that
drifts fails loudly instead of quietly becoming a blind test.
