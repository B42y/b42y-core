# Contract traceability

The financial semantics in `CORE_CONTRACT.md` are normative. Its example TypeScript shapes are reviewed separately. The local in-memory suite now runs; native SQLCipher durability and device recovery remain unverified.

| Invariant  | Implementation and local evidence                                                                 | Status                                                 |
| ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| CORE-01–03 | `makeEntry`, `validateEntry`, streaming audit; balanced line and ownership tests                  | Local verified; adapter pending                        |
| CORE-04    | Serialized `LedgerStore.write`; correction failure injection at both appends, receipt, and commit | Local verified; durable adapter pending                |
| CORE-05    | Immutable entry port; reversal and correction lineage tests                                       | Local verified; adapter pending                        |
| CORE-06    | Canonical payload comparison, SHA-256 index, receipt shape/kind audit, retry tests                | Local verified; adapter pending                        |
| CORE-07    | Indexed reversal lookup and uniqueness; active-original tests                                     | Local verified; adapter pending                        |
| CORE-08–09 | Line-derived audit and projected position; totals and model tests                                 | Local verified; projection rebuild and adapter pending |
| CORE-10    | Checked arithmetic and independent `bigint` property oracle                                       | Local verified                                         |
| CORE-11    | Active party check, archive/reactivation tests                                                    | Local verified                                         |
| CORE-12    | Versioned preview fingerprint and revision check inside writer; stale-preview tests               | Local verified                                         |
| CORE-13    | History-based opening check, zero-entry receipt tests                                             | Local verified                                         |
| CORE-14    | Atomic two-entry correction, per-party preview, staged rollback tests                             | Local verified; adapter pending                        |
| CORE-15    | Injected clock, allocated monotonic sequence, accepted gaps                                       | Local verified; adapter pending                        |
| CORE-16    | Initialization and explicit bounded-memory audit, persisted read-only recovery port               | Local verified; durable adapter pending                |

`MONEY-001–002` run in `tests/unit/money.test.ts`. `LEDGER-001–017` and `LEDGER-019–025`, `LEDGER-027–029` run in `tests/integration/core.test.ts`, with added corruption, failure-stage, sequence-gap, and cross-party correction cases in `tests/integration/hardening.test.ts`. `LEDGER-018` has the `bigint` property suite in `tests/properties/ledger.test.ts`. `LEDGER-026` is covered by the journal-authoritative projection check, though a native rebuild test is pending.

The seeded 100,000-entry benchmark includes a party holding 95% of entries. It checks ordinary and backdated posting, position, totals, and two history pages without a full audit scan. A separate 10,000-party workload measures totals and party search. Host latency is reported separately from future device targets. The in-memory test store now uses ordered per-party history and party-ID indexes; index insertion is expected logarithmic work, not a constant-time guarantee. Native indexed query plans remain pending. Digest boundary, receipt-linkage, and full rollback tests verify the local core only.

SQLCipher encryption, foreign keys, immutable-row triggers, device durability, migration, backup/recovery, indexed query plans, projection rebuild, and Expo consumption must pass in the mobile adapter before production release. No publication or encrypted durability is claimed here.
