# Contract traceability

The TypeScript in `CORE_CONTRACT.md` is illustrative; its financial semantics are normative. Dependency installation is blocked by registry access (`EACCES`), so executable test files are not yet verified. Source-only TypeScript checking, formatting, and a manual compiled correction smoke test passed.

| Requirement               | Code                                                          | Test evidence                 | Status                                     |
| ------------------------- | ------------------------------------------------------------- | ----------------------------- | ------------------------------------------ |
| CORE-01, CORE-02, CORE-03 | `makeEntry`, `validateEntry`, `LedgerTransaction.appendEntry` | LEDGER-001, LEDGER-019        | Blocked: suite and adapter pending         |
| CORE-04                   | `LedgerStore.write` contract                                  | LEDGER-012, failure injection | Blocked: suite and durable adapter pending |
| CORE-05                   | Append-only port, reversal/correction                         | LEDGER-008, 009, 011, 024     | Blocked: suite and adapter pending         |
| CORE-06                   | Canonical payload and receipt in serialized write             | LEDGER-006, 007, 022, 023     | Blocked: suite and adapter pending         |
| CORE-07                   | `original`, reversal uniqueness                               | LEDGER-009, 010               | Blocked: suite and adapter pending         |
| CORE-08, CORE-09          | `position`, `getTotals`                                       | LEDGER-001–005, 020, 026      | Blocked: suite and adapter pending         |
| CORE-10                   | `money.ts` checked arithmetic                                 | MONEY-001, 002; LEDGER-025    | Blocked: full test suite unavailable       |
| CORE-11                   | party active check and archive                                | LEDGER-016                    | Blocked: suite and adapter pending         |
| CORE-12                   | preview and transaction confirmation                          | LEDGER-005, 021, 029          | Blocked: suite and adapter pending         |
| CORE-13                   | opening history check and zero receipt                        | LEDGER-014, 015               | Blocked: suite and adapter pending         |
| CORE-14                   | two correction postings in one `write`                        | LEDGER-011–013, 024, 027–029  | Blocked: suite and adapter pending         |
| CORE-15                   | injected clock and monotonic sequence                         | LEDGER-001, history tests     | Blocked: suite and adapter pending         |
| CORE-16                   | `verifyLedger`, persistent recovery port                      | integrity failure test        | Blocked: suite and adapter pending         |

| Scenario             | Evidence                          | Status                                     |
| -------------------- | --------------------------------- | ------------------------------------------ |
| MONEY-001, MONEY-002 | `tests/unit/money.test.ts`        | Blocked: full test suite unavailable       |
| LEDGER-001–017       | `tests/integration/core.test.ts`  | Blocked: full test suite / adapter pending |
| LEDGER-018           | `tests/properties/ledger.test.ts` | Blocked: full test suite unavailable       |
| LEDGER-019–025       | `tests/integration/core.test.ts`  | Blocked: full test suite / adapter pending |
| LEDGER-026           | No optional projection is used    | Deferred by contract                       |
| LEDGER-027–029       | `tests/integration/core.test.ts`  | Blocked: full test suite unavailable       |

Every public command is defined by `CoreService` in `src/core.ts`: party create/edit/archive/reactivate/delete, post, opening, reverse, and correct. Its queries include previews, positions, totals, history, search, and verification. Every command uses the same receipt and transaction path. These commands remain blocked from a verified status until the full suite runs.

SQLCipher encryption, foreign keys, immutable triggers, device durability, schema migrations, backup/recovery, and real Expo consumption are adapter-dependent. `examples/metro-smoke` supplies an Expo fixture, but its execution remains blocked. These checks must pass in `b42y-app` before a mobile production release.
