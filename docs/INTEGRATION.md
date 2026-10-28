# Mobile integration

Install the package in `b42y-app`, import `createCoreService`, and implement `LedgerStore` over SQLCipher. Inject a UTC clock and cryptographically generated UUID provider from the app. The core never opens the database or obtains keys itself. Never use the test fake in a release.

The adapter must serialize writes with `BEGIN IMMEDIATE`; start with WAL and `synchronous=FULL` for power-loss durability. Enforce unique command IDs, entry IDs, sequence and reversal references; foreign keys and immutable-entry triggers; and atomically commit receipts, party revisions, journal header, both lines, and position projections. Implement indexed lookups for receipt, entry, reversal, position, party history, and paginated party search; implement `getTotals()` as a checked aggregate over position rows without loading all parties into JavaScript. `auditEntries` and `auditReceipts` must iterate lazily in a stable snapshot, in sequence order for entries. Allocate sequences inside the writer; committed gaps are valid. Rebuild projections only from immutable lines. On open, verify cipher availability, key, schema, SQLite integrity and foreign keys. Persist recovery state and fail closed on any violation, including failure to complete an audit. Test interruption, restart, rollback, backup, migrations, indexed query plans, configured durability, and encryption on Android before release. Measure device read latency and memory before tuning SQLite page cache size or adding a totals projection.

```ts
import { createCoreService, CoreError } from "@b42y/core";
import type { LedgerStore, Clock, IdGenerator } from "@b42y/core";

declare const store: LedgerStore;
declare const clock: Clock;
declare const ids: IdGenerator;
const core = createCoreService({ store, clock, ids });
const person = await core.createParty({
  commandId: ids.newId(),
  displayName: "Ahmed",
});
await core.post({
  commandId: ids.newId(),
  partyId: person.id,
  operation: "ADD_RECEIVABLE",
  amountMinor: 100_000,
  occurredAtUtc: clock.nowUtc(),
});
const repayment = {
  commandId: ids.newId(),
  partyId: person.id,
  operation: "RECEIVE" as const,
  amountMinor: 40_000,
  occurredAtUtc: clock.nowUtc(),
};
const preview = await core.previewPost(repayment);
try {
  await core.post({
    ...repayment,
    ...(preview.needsConfirmation
      ? {
          confirmation: {
            previewFingerprint: preview.previewFingerprint,
            expectedPartyRevision: preview.partyRevision,
          },
        }
      : {}),
  });
  console.log(await core.getPartyPosition(person.id)); // 60000
} catch (error) {
  if (error instanceof CoreError) console.log(error.code);
  else throw error;
}
```

Show the preview to the user and obtain explicit approval before passing a required confirmation. The example illustrates the API, not a complete UI flow. An Expo/Metro import and native SQLCipher test are separate release gates.
