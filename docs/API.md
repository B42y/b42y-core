# API

Import `createCoreService` and `CoreError` from `@b42y/core`. Inject a `LedgerStore`, `Clock`, and `IdGenerator`. Commands use stable UUID `commandId` values. `post`, `setOpeningPosition`, `reverse`, and `correct` return versioned `PostResult` objects. Every amount is an integer number of EGP piasters.

`createParty`, `editParty`, `archiveParty`, `reactivateParty`, `previewDeleteUnpostedParty`, and `deleteUnpostedParty` manage parties. `previewPost`, `previewReverse`, and `previewCorrection` expose position changes; pass fresh fingerprints and expected revisions when confirmation is required. `getPartyPosition`, `getTotals`, `getPartyHistory`, `listParties`, and `verifyLedger` are queries.

`CoreError.code` is a stable machine identifier. `INVALID_COMMAND` covers malformed command shapes and unknown fields; semantic failures retain their domain codes. The UI supplies localized text. A `TRANSACTION_FAILED` response can mean the commit succeeded but its response was lost; retry with the identical `commandId` and payload. UUID case, UTC timestamp precision, and display-name whitespace are normalized before idempotency comparison.

History cursors bind a party and a journal sequence high-water mark. Complete the cursor chain for a stable audit snapshot; start a new query to include later postings.
