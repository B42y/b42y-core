# Ba2y — Core Module Contract

**Repository:** `b42y-app` (planned)  
**Package:** `@b42y/core`  
**Contract version:** `1.0.0`  
**Status:** Implementation baseline, financial rules frozen for MVP  
**Product:** Ba2y / باقي — Egyptian personal debt tracker  
**Locale:** `ar-EG` at presentation boundaries  
**Currency:** EGP only  
**Architecture:** Pure TypeScript domain engine with abstract persistence ports; React Native/Expo and SQLCipher are separate adapters.

## 0. Contract purpose and source of truth

Implement a **minimal, verifiable debt-ledger engine** that records money owed to and by the device owner, repayments, opening positions, reversals, and corrections. The domain is a personal IOU / debt register, **not** a general accounting package or cash/bank ledger.

Use the normative words **MUST**, **MUST NOT**, **SHOULD**, **MAY**. This contract defines behavior and invariants. The implementation MUST NOT change financial meaning or silently relax a rule without a new contract version and an architecture decision record (ADR).

### Hard boundaries

The core MUST NOT import `react`, `react-native`, `expo`, `expo-sqlite`, native key-storage libraries, database drivers, navigation, UI components, HTTP clients, analytics, or DOM/browser APIs. It MUST NOT know the app brand's graphic tokens. The `@b42y/core` package exports domain entities, validated value objects, pure policies and posting plans, service interfaces, typed errors, and storage abstractions.

Storage, SQLCipher, transactions, encryption, migration, and Android-specific integrations reside in an external adapter, not the pure domain package. However the core **requires** transactional, durable, fail-closed semantics from that adapter. A purely in-memory fake is acceptable in tests only and MUST NOT be a release storage backend.

## 1. Domain definitions

- **Party:** named person or entity. Immutable `partyId`, editable display metadata, active/archived status. Name alone is sufficient; duplicate names and phone numbers are allowed.
- **Owner:** the single local user; the owner is implicit, not an independently stored party in MVP.
- **Financial event:** what the user says occurred. Events with the same journal direction remain semantically distinct (e.g., someone owing more and you paying them more).
- **Journal entry:** immutable posted document representing one financial effect. Two journal lines, exactly one debit and one credit.
- **Party position account:** private technical account belonging to one party. Net **debit minus credit** is the signed amount owed **by that party to the owner**.
- **Position offset account:** one technical counter-account (EGP). Balances every posted entry; does not represent real cash, bank account, revenue, or business profit.
- **Position:** `balanceMinor > 0` = `ليك عنده`; `< 0` = `عليك له`; `= 0` = settled.
- **Opening position:** an initial net claim/liability imported when registering an existing relationship; not a cash event.
- **Reversal:** new journal entry with exactly inverted lines and references to original; never mutation or deletion.
- **Correction:** one atomic logical command posting a reversal and a replacement in that order.
- **Command receipt:** unique persistent record of an executed command and its canonical payload fingerprint; enables idempotency.

### Amount units

Store every EGP amount in **integer piasters** (1 EGP = 100 piasters), called `amountMinor` in code. No floats/decimals in the journal, and no silent rounding. The domain MUST reject zero or negative amount for regular financial postings. Signed balances and signed opening positions can be negative or zero. All numeric inputs and sums MUST be safe integers (`Number.isSafeInteger`) with explicit checked addition/subtraction; `NaN`, `Infinity`, non-integers and overflow are invalid. Standard max input `9_000_000_000_000_000` piasters; balance operations MUST also check integer safety. Larger amounts are not supported by MVP.

Numeric parsing is implemented in the `money` domain with deterministic handling for Western digits (`0-9`), Arabic-Indic (`٠-٩`) and Eastern Arabic-Indic (`۰-۹`), grouping separators, `.` or `٫` decimals, and at most two fractional piaster digits. Ambiguous or malformed strings MUST be rejected, never guessed. Formatting for localized UI is **outside** the core.

## 2. Financial events and effects

Let `B(p)` be the signed position of party `p` in piasters and `A > 0`.

| Public command kind | Egyptian-language meaning | Effect on `B(p)` | Debit line | Credit line |
|---|---|---:|---|---|
| `ADD_RECEIVABLE` | سجل فلوس ليك | `+A` | Party position | Technical offset |
| `ADD_PAYABLE` | سجل فلوس عليك | `-A` | Technical offset | Party position |
| `RECEIVE` | قبضت منه | `-A` | Technical offset | Party position |
| `PAY` | دفعت له | `+A` | Party position | Technical offset |
| `OPENING_RECEIVABLE` | رصيد افتتاحي ليك | `+A` | Party position | Technical offset |
| `OPENING_PAYABLE` | رصيد افتتاحي عليك | `-A` | Technical offset | Party position |
| `REVERSAL` | إلغاء تأثير عملية | opposite original | Invert original credit | Invert original debit |

`ADD_PAYABLE` and `RECEIVE` can produce the same directions but MUST keep distinct event types. Likewise `ADD_RECEIVABLE` and `PAY` MUST remain distinct. Core MUST NOT infer event type from the debit/credit signs. This journal is an internal *position accounting* technique, not a claim that physical money moved.

**No individual-loan allocation** in MVP. All events for a party affect one net position. Do not invent invoices, due dates, installment schedules, cash accounts or transaction matching.

### Examples

1. Ahmed owes owner 1,000 EGP: `ADD_RECEIVABLE(100_000)` ⇒ `B(Ahmed)=+100_000`.
2. Ahmed pays owner 400 EGP: `RECEIVE(40_000)` ⇒ `B(Ahmed)=+60_000`.
3. Owner owes Mohamed 300 EGP: `ADD_PAYABLE(30_000)` ⇒ `B(Mohamed)=-30_000`.
4. Owner pays Mohamed 100 EGP: `PAY(10_000)` ⇒ `B(Mohamed)=-20_000`.
5. Ahmed pays 800 EGP more after (2): `RECEIVE(80_000)` ⇒ `B(Ahmed)=-20_000`; requires explicit direction-change acknowledgment before posting.

## 3. Entities and value contracts

IDs are opaque, stable UUID strings generated by an injected ID provider. No business relationship depends on names or phone numbers. Timestamps are canonical UTC ISO-8601 instants, injectable clock for deterministic tests.

```ts
export type PartyId = string;
export type EntryId = string;
export type CommandId = string;
export type AccountId = string;
export type MoneyMinor = number; // runtime-validated safe integer
export type Currency = 'EGP';
export type PartyStatus = 'ACTIVE' | 'ARCHIVED';

export interface Party {
  readonly id: PartyId;
  displayName: string;
  searchName: string;        // derived, can be recomputed
  phone?: string;
  note?: string;
  status: PartyStatus;
  ledgerRevision: number; // persisted monotonic revision of all financial postings affecting this party
  createdAtUtc: string;
  updatedAtUtc: string;
}

export type FinancialOperation =
  | 'ADD_RECEIVABLE' | 'ADD_PAYABLE'
  | 'RECEIVE' | 'PAY'
  | 'OPENING_RECEIVABLE' | 'OPENING_PAYABLE'
  | 'REVERSAL';

export type JournalSide = 'DEBIT' | 'CREDIT';
export type AccountKind = 'PARTY_POSITION' | 'POSITION_OFFSET';

export interface JournalLine {
  readonly id: string;
  readonly entryId: EntryId;
  readonly lineNo: 1 | 2;
  readonly accountId: AccountId;
  readonly side: JournalSide;
  readonly amountMinor: MoneyMinor;
  readonly currency: Currency;
}

export interface JournalEntry {
  readonly id: EntryId;
  readonly sequence: number;  // assigned by persistent writer
  readonly commandId: CommandId;
  readonly partyId: PartyId;
  readonly operation: FinancialOperation;
  readonly occurredAtUtc: string;
  readonly recordedAtUtc: string;
  readonly note?: string;
  readonly reversalReason?: string;
  readonly reversesEntryId?: EntryId;
  readonly correctionGroupId?: CommandId;
  readonly postingVersion: number;
  readonly lines: readonly [JournalLine, JournalLine];
}
```

The domain may use richer opaque/branded types internally. These interfaces describe **semantics**; transport/serialization schemas MUST be explicitly versioned. All `readonly` immutable fields must also be protected by the durable adapter, not merely TypeScript typing.

## 4. Domain rules: hard invariants

| ID | Requirement |
|---|---|
| `CORE-01` | Every posted journal entry has **exactly two** positive EGP lines: one `PARTY_POSITION` and one `POSITION_OFFSET`, equal amounts and opposite sides. |
| `CORE-02` | Journal lines belong to accounts of the correct party and global offset only; the party/account relationship never changes after posting. |
| `CORE-03` | Every posted entry has debits equal to credits, with no orphan header/lines. |
| `CORE-04` | Posting is **atomic and durable**: journal header, 2 lines, command receipt, and any cache/projection commit together, or none do. |
| `CORE-05` | Posted entries/lines are append-only; reversal/correction is the only normal way to change financial effect. |
| `CORE-06` | `commandId` is globally unique in one ledger; retry with same ID and identical canonical payload returns the original result; different payload is `IDEMPOTENCY_CONFLICT`. |
| `CORE-07` | At most one reversal is allowed per original entry, enforced by writer and persistence uniqueness. Reversal must invert the exact stored original lines. |
| `CORE-08` | Signed party balance derives solely from posted **party-position** journal lines, never a mutable party.balance column. |
| `CORE-09` | Global totals equal sum of positive party net positions and absolute values of negative party net positions. Archived parties still count. |
| `CORE-10` | Every amount and computed balance is safely representable in integer piasters; currency remains EGP. |
| `CORE-11` | An archived party cannot receive new debt/payment postings; reactivation required. Its history and balance are preserved. |
| `CORE-12` | A direction-changing posting or settlement on zero/unexpected balance cannot commit without fresh explicit acknowledgment of the computed after-position. |
| `CORE-13` | Opening balance posting is allowed only before the party has posted financial history. Zero opening writes no journal financial entry. |
| `CORE-14` | Corrections post reversal + replacement inside **one** atomic transaction; a failed replacement must not leave a standalone correction reversal. |
| `CORE-15` | Every accepted financial operation has occurred/recorded timestamps and deterministic local posting order; device time is **not** trusted security evidence. |
| `CORE-16` | Invariant or storage integrity failure disables all financial writes until recovery; do not automatically reset the ledger. |

## 5. Party lifecycle

- Create: `displayName` required, trimmed and nonblank. Optional `phone`/`note`. New party gets exactly one position account in durable adapter. Duplicate names/phones allowed. Phone number is *not* identity.
- Update: only display name, phone, note and derived search index may change. Existing entries retain their original notes/IDs/operation semantics.
- Archive: soft archive is allowed with a nonzero balance. Archive must not exclude that balance from global totals.
- Reactivate: returns party to `ACTIVE` and allows new commands.
- Delete: a party with any posted journal history **must never be physically deleted**. A never-posted party may be deleted after explicit confirmation through an application service. Merge is not P0.
- Search normalization: implement deterministic Unicode/whitespace/Arabic-variant matching as a separate pure function; preserve displayed spelling. No matching by mutable name for accounting.

## 6. Commands and public application API

The exported **application facade** has no UI dependencies and delegates atomicity to an injected unit-of-work persistence port. These names and result shapes are the stable external use-case contract (minor naming refinements require backward-compatible adapters).

```ts
export type PostOperation =
  | 'ADD_RECEIVABLE' | 'ADD_PAYABLE' | 'RECEIVE' | 'PAY';
export type OpeningOperation = 'OPENING_RECEIVABLE' | 'OPENING_PAYABLE';
export type ReplacementOperation = PostOperation | OpeningOperation;

export interface PostCommand {
  commandId: CommandId;
  partyId: PartyId;
  operation: PostOperation;
  amountMinor: MoneyMinor; // strictly positive validated integer
  occurredAtUtc: string;
  note?: string;
  confirmation?: {
    previewFingerprint: string;
    expectedPartyRevision: number;
  };
}

export interface PreviewResult {
  partyId: PartyId;
  currentPositionMinor: MoneyMinor; // signed
  deltaMinor: MoneyMinor;           // signed
  nextPositionMinor: MoneyMinor;    // signed
  partyRevision: number;           // monotonically advancing persisted revision
  needsConfirmation: boolean;
  warning?: 'SIGN_FLIP' | 'ZERO_SETTLEMENT' | 'UNEXPECTED_SETTLEMENT';
  previewFingerprint?: string;
}

export interface PostResult {
  entryIds: readonly EntryId[];
  partyId: PartyId;
  resultingPositionMinor: MoneyMinor;
  lastSequence: number;
}

export interface OpeningCommand {
  commandId: CommandId;
  partyId: PartyId;
  targetPositionMinor: MoneyMinor; // signed, zero allowed
  occurredAtUtc: string;
  note?: string;
}

export interface ReverseCommand {
  commandId: CommandId;
  originalEntryId: EntryId;
  reason?: string;
}

export interface CorrectionCommand {
  commandId: CommandId; // ONE public parent ID
  originalEntryId: EntryId;
  replacement: {
    partyId: PartyId;              // may differ from original
    operation: ReplacementOperation; // opening type only when correcting an opening entry
    amountMinor: MoneyMinor;
    occurredAtUtc: string;
    note?: string;
  };
  reason?: string;
  confirmations?: readonly {
    partyId: PartyId;
    expectedPartyRevision: number;
    previewFingerprint: string;
  }[];
}

export interface CoreService {
  createParty(command: {commandId: CommandId; displayName: string; phone?: string; note?: string}): Promise<Party>;
  editParty(command: {commandId: CommandId; partyId: PartyId; displayName?: string; phone?: string | null; note?: string | null}): Promise<Party>;
  archiveParty(command: {commandId: CommandId; partyId: PartyId}): Promise<void>;
  reactivateParty(command: {commandId: CommandId; partyId: PartyId}): Promise<void>;
  deleteUnpostedParty(command: {commandId: CommandId; partyId: PartyId}): Promise<void>;
  previewPost(command: PostCommand): Promise<PreviewResult>;
  previewCorrection(command: CorrectionCommand): Promise<readonly PreviewResult[]>;
  post(command: PostCommand): Promise<PostResult>;
  setOpeningPosition(command: OpeningCommand): Promise<PostResult>;
  reverse(command: ReverseCommand): Promise<PostResult>;
  correct(command: CorrectionCommand): Promise<PostResult>;
  getPartyPosition(partyId: PartyId): Promise<MoneyMinor>;
  getTotals(): Promise<{receivableMinor: MoneyMinor; payableMinor: MoneyMinor}>;
  getPartyHistory(partyId: PartyId, paging: {cursor?: string; limit: number}): Promise<HistoryPage>;
  listParties(query: PartyQuery): Promise<PartyPage>;
  verifyLedger(): Promise<LedgerIntegrityReport>;
}
```

`HistoryPage`, `PartyQuery`, `PartyPage`, and `LedgerIntegrityReport` must be precisely versioned during implementation. The key requirement is they preserve party identity, full history, ordering and financial recomputability. The facade may be split into command/query interfaces if the semantics above remain unchanged.

### Preview and acknowledgement logic

The core MUST compute a preview before posting and **recompute it inside the same write transaction** at commit time. A command may proceed without confirmation when it is unambiguous and does not cross sign direction.

Require explicit confirmation for:
1. any action that crosses positive ↔ negative position;
2. `RECEIVE` when current position is `<= 0` (zero/unexpected settlement);
3. `PAY` when current position is `>= 0` (zero/unexpected settlement).

The core MUST provide a `previewCorrection` operation that previews resulting positions of every affected party before correction; confirmation requirements must be evaluated using the projected effects of **both** the reversal and replacement, not a standalone replacement. The preview fingerprint binds the command's canonical meaning, party ID, amount, current signed position, expected party revision, next position and warning type. No authorization or cryptographic device security is implied by a preview fingerprint: it merely proves the acknowledged state is the one being posted. A party revision increments on **every** successful posting affecting that party (including reversal and correction), even if net balance returns to its prior value. This prevents stale-preview ABA behavior.

## 7. Opening position

- `setOpeningPosition` targets an **initial signed net position**.
- Allowed only if there is no posted journal history for that party, including historical entries later reversed.
- Positive targets produce one `OPENING_RECEIVABLE`; negative targets produce one `OPENING_PAYABLE` of absolute target magnitude.
- Zero target produces **no journal financial entry** but a stable no-op receipt for idempotent retries. It does not consume the ability to set a nonzero opening position before financial history exists.
- Opening entries are not payment/cash events.
- To change an already posted opening entry, use the correction workflow with explicit audit links, not a second opening command. The replacement for an opening entry MUST be another `OPENING_RECEIVABLE` or `OPENING_PAYABLE` **on the same party**; it may change amount/direction. Correcting an opening entry to zero uses standalone reversal rather than fabricating a zero-value journal entry. Opening-operation types MUST NOT be used to replace non-opening debt/payment entries.

## 8. Reverse/correct semantics

**Reverse:** exact inversion of original 2 lines, posted as its own immutable entry. The original is not edited, even to set `status=REVERSED`; its current visible status is **derived** from the presence of an immutable reversal reference. A reversal cannot itself be reversed as a standard P0 command. A second reversal request must fail unless it is the identical idempotent retry.

**Correct:** one parent command atomically posts (a) a reversal of the selected currently active non-reversal entry and (b) a replacement entry, with a shared correction group ID. The two child IDs are deterministically derived from the parent command ID or allocated/stored inside the same atomic unit of work, so retrying cannot duplicate either. Replacement for an ordinary debt/payment entry may change party, event type, amount, occurredAt or note. Opening corrections follow the narrower same-party rule in §7. Both old and new parties must have current read models updated atomically. A correction on an archived party requires reactivation before writing. For direction-changing effects, fresh previews must be acknowledged for every affected party.

History MUST include original, reversal and replacement; the visual status `تم تصحيحها` is derived, not stored by overwriting original journal rows. Correcting an already reversed original returns a typed conflict. Correction of the latest replacement is allowed, preserving the full lineage.

## 9. Persistence boundary — required capabilities, not DB code

`@b42y/core` depends on an injected durable persistence abstraction supporting all of the following inside **one serialized write transaction**:

- Read original command receipt and canonical command-payload hash.
- Read/validate party and its current revision / position.
- Read original entry and reversal references where relevant.
- Allocate irreversible local entry sequence(s), stable entry IDs, and party revisions.
- Insert immutable journal header, exactly 2 validated lines, and correction/reversal lineage.
- Insert command receipt(s) with result and canonical payload hash.
- Update any **derived** cache/projection for each affected party.
- Re-read and validate pending postings before commit; commit or rollback all changes.

All mutating party lifecycle operations MUST also have stable command IDs and adapter-enforced idempotent behavior. The local party `ledgerRevision` advances on any posted line affecting that party, including opening, reversal and correction; name changes or archival do not alter the ledger revision. Core service MUST call this port rather than opening SQLite connections directly. Database adapters MUST enforce foreign keys, uniqueness, CHECK constraints and immutable entry/line DB triggers as defense in depth. Cross-row balance and ownership require transactional checks; basic SQLite `CHECK` alone cannot assert two-row journal balance.

SQLCipher is mandatory in the **mobile release adapter**, not the pure core. At mobile DB open: verify encryption availability and correct key; **fail closed** on missing cipher, wrong key, unsupported schema or integrity breach. No fallback to plaintext SQLite. Backup/restore, key storage, schema migrations and recovery have separate infra-level contracts and test suites and are not implemented in the pure core.

### Journal write pseudocode

```text
runCommand(command):
  validate input and canonicalize payload
  store.withSerializedWriteTransaction(tx => {
    if tx.receiptByCommandId(command.id) exists:
      require same canonical payload fingerprint
      return prior result
    party = tx.getPartyAndRevision(command.partyId)
    require party active
    before = tx.sumPostedPositionLines(party.id)
    plan = domain.planPosting(command, before, party.revision)
    require matching fresh preview acknowledgement if needed
    tx.insertJournalHeaderAndExactlyTwoLines(plan)
    tx.validatePostedLinesAndOwnership(plan)
    tx.bumpPartyRevision(party.id)
    tx.insertCommandReceipt(command.id, canonicalPayloadHash, result)
    tx.updateOptionalBalanceCache(plan)
    return result
  })
```

For corrections, the transaction creates **two balanced entries** in that same write transaction and updates all parties involved. Idempotency is checked at command level **before** deciding to post again.

## 10. Query semantics

Party position = `SUM(amountMinor when side=DEBIT) − SUM(amountMinor when side=CREDIT)` for its party-position account across all posted journal entries (including reversals). Computations MUST use checked safe-integer accumulation; cached values are only projections and MUST be rebuildable from immutable lines.

Global summaries:
- `receivableMinor = Σ max(partyPositionMinor, 0)`
- `payableMinor = Σ max(-partyPositionMinor, 0)`

These are **net-per-party** aggregates, not gross lifetime receivables/payables. Include archived parties. Exclude the technical offset account. No extra cash balance or profit figure is defined.

History sorts by `occurredAtUtc DESC`, then by monotonically assigned `sequence DESC`; audit verification sorts ascending `sequence`. Pagination must never silently drop reversal/correction records; history display may group them while retaining a complete audit view. No reordering by editable party names or untrusted time alone.

## 11. Canonical errors

All errors are stable machine identifiers; UI translation is external:

```ts
type CoreErrorCode =
  | 'INVALID_PARTY' | 'PARTY_ARCHIVED'
  | 'INVALID_NAME' | 'INVALID_AMOUNT' | 'AMOUNT_OVERFLOW'
  | 'INVALID_DATE' | 'UNSUPPORTED_CURRENCY'
  | 'COMMAND_DUPLICATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT'
  | 'CONFIRMATION_REQUIRED' | 'PREVIEW_STALE'
  | 'OPENING_NOT_ALLOWED' | 'ENTRY_NOT_FOUND'
  | 'ALREADY_REVERSED' | 'REVERSAL_NOT_ALLOWED'
  | 'LEDGER_INTEGRITY_FAILURE' | 'READ_ONLY_RECOVERY'
  | 'STORAGE_UNAVAILABLE' | 'TRANSACTION_FAILED';
```

No raw database error should leak through to user-facing strings. `TRANSACTION_FAILED` MUST NOT return `success`; ambiguous post-commit lifecycle failure must be retriable with same `commandId`.

## 12. Required test suite and acceptance gates

Unit and property tests run in Node/TypeScript without Expo, React Native, SQLite or physical device. Integration tests run the exact same core against an injected in-memory transactional **test fake**. Separate SQLCipher adapter tests run in native Android and prove encryption/integrity/durability.

| Test ID | Scenario | Expected |
|---|---|---|
| `MONEY-001` | `١٬٢٣٤٫٥٠`, `1234.50`, `۱۲۳۴٫۵۰` | all → `123450` piasters |
| `MONEY-002` | `0`, `-1`, `1.005`, `NaN`, malformed separators | rejected |
| `LEDGER-001` | +1000 EGP to Ahmed | 2 balanced lines, signed balance +100000 |
| `LEDGER-002` | Receive 400 EGP from Ahmed | +60000 |
| `LEDGER-003` | Add 300 EGP payable to Mohamed | -30000 |
| `LEDGER-004` | Pay Mohamed 100 EGP | -20000 |
| `LEDGER-005` | Receive another 800 EGP from Ahmed | requires confirmation, then balance -20000 |
| `LEDGER-006` | Same `commandId`, same canonical payload repeated | exactly one financial posting, same response |
| `LEDGER-007` | Same ID, different payload | conflict; no second post |
| `LEDGER-008` | Attempt mutate or delete posted entry | rejected by contract and persistence adapter |
| `LEDGER-009` | Reverse original | inverted lines, exact opposite effect, linked immutable entry |
| `LEDGER-010` | Reverse same entry again with a new ID | rejected; no new entry |
| `LEDGER-011` | Correct 5000 EGP to 500 EGP | original + reversal + replacement; net +500 EGP |
| `LEDGER-012` | Fail after correction reversal but before replacement | no correction postings committed |
| `LEDGER-013` | Change party in correction | old party reversed, new party gets replacement, both auditable |
| `LEDGER-014` | Opening positive/negative/zero | correct signed result, no financial entry for zero |
| `LEDGER-015` | Set opening after any posting history | rejected |
| `LEDGER-016` | Archive party with balance | history/total unchanged, new posting blocked |
| `LEDGER-017` | Two parties sharing same name/phone | distinct IDs and balances |
| `LEDGER-018` | Randomized posting/reversal command sequence | independently calculated signed oracle always matches |
| `LEDGER-019` | Invalid/unbalanced/wrong-account journal plan | never commits |
| `LEDGER-020` | All parties totals, incl. archived | exact net-per-party sum |
| `LEDGER-021` | Preview state changes before commit | `PREVIEW_STALE`, no unexpected posting |
| `LEDGER-022` | Two posts in rapid succession with same command ID | one receipt, one entry |
| `LEDGER-023` | Completed commit, response lost, retry | original result recovered without duplicate |
| `LEDGER-024` | Valid correction on latest replacement | original lineage preserved, final signed balance correct |
| `LEDGER-025` | Integer overflow in long-running balance | reject/rollback, no incorrect sum |
| `LEDGER-027` | Correct an opening balance to another value/direction | same party, opening semantics retained, history preserved |
| `LEDGER-028` | Correct an opening balance to zero | reversal only, no zero-amount line |
| `LEDGER-029` | Correction across parties previews resulting balances | stale or missing confirmations reject before posting |
| `LEDGER-026` | Rebuild projection from journal | matches live projection and totals |

### Definition of done — `@b42y/core` package

1. `pnpm test` (or the project-selected equivalent) runs pure, deterministic domain and service tests without Expo or SQLite.
2. Every `CORE-01..CORE-16` invariant is covered by at least one executable test (and integration tests cover real durable behavior as appropriate).
3. All defined command behaviors, balance directions, opening balances, reversals, corrections, partial repayments and idempotency are tested against an **independent numerical oracle**.
4. The public package has typed exports, no framework/database imports, clear errors, versioned payload types, and documented external ports.
5. Property-based tests include random sequences, amount overflow and repeated commands.
6. A thin SQLCipher mobile-adapter integration test suite exists **before** considering core-to-mobile integration production-ready. The pure core passing is not proof of encrypted durability.
7. No UI, navigation, payment processing, authentication, cloud sync, arbitrary ledger edit, multi-currency, invoice tracking or feature creep is part of this milestone.

## 13. Deliverable sequence — implement ONLY core first

**Milestone C1 — Pure primitives:** Money parsing and safe arithmetic; identifiers; party validation; event types and directional balance math; unit tests.

**Milestone C2 — Journal plan engine:** exactly-two-line balanced posting plans, original-line inversion, correction grouping; property-based tests and independent oracle.

**Milestone C3 — Application/core services:** ports for party/ledger/receipts, preview freshness, command validation, opening balance, reversal and correction; deterministic in-memory transactional test fake.

**Milestone C4 — Core release gate:** full contract test matrix, stable typed API and package build, readme plus accepted ADRs. Then begin SQLCipher adapter milestone. **Do not implement React Native screens as part of C1–C4.**

## 14. Explicit deferred decisions

- App PIN/biometrics and Android device-bound key storage: infrastructure/security phase.
- Backup transport and encryption implementation: offline/backup adapter phase.
- Cloud sync and concurrent device editing: excluded from MVP.
- Multi-loan allocation and debt due dates: excluded from MVP.
- Import existing contacts, reminders, voice input, reports: excluded from core MVP.
- UI texts, translations, rendering, currency formatting, accessibility: mobile UI phase.
- Real device SQLCipher validation and migrations: mobile infrastructure phase.

---

**Core invariant in one sentence:** No balance exists outside the exact, immutable sum of posted balanced journal lines, and no command can violate atomicity, idempotency or audit history.
