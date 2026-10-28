# Ba2y / باقي — Core Module Contract

**First milestone:** `@b42y/core` as a pure TypeScript package. No React Native screens, Expo integration, or database driver in this milestone.

## Read first

[CORE_CONTRACT.md](CORE_CONTRACT.md) is the normative specification for party identities, EGP integer money, signed party balances, balanced two-line postings, idempotent commands, immutable journal history, reversals/corrections, storage ports and the acceptance matrix.

## Implementation order

1. C1 — money and party value objects, normalization and pure rules.
2. C2 — double-entry posting plans, reversal, corrections and property tests.
3. C3 — command/query core services, transaction/persistence ports, fake adapter tests.
4. C4 — contract tests and stable public APIs.

**Only after C4:** build encrypted SQLCipher persistence adapter and then Expo screens. Database isolation does not weaken the storage transaction contract.

## Branding and product

Ba2y (باقي), GitHub org `b42y`, Egyptian Arabic audience, EGP only, offline-first.
