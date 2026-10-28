export type PartyId = string;
export type EntryId = string;
export type CommandId = string;
export type MoneyMinor = number;
export type PostOperation =
  | "ADD_RECEIVABLE"
  | "ADD_PAYABLE"
  | "RECEIVE"
  | "PAY";
export type OpeningOperation = "OPENING_RECEIVABLE" | "OPENING_PAYABLE";
export type FinancialOperation = PostOperation | OpeningOperation | "REVERSAL";
export type ReplacementOperation = PostOperation | OpeningOperation;
export type CoreErrorCode =
  | "INVALID_PARTY"
  | "PARTY_ARCHIVED"
  | "INVALID_NAME"
  | "INVALID_AMOUNT"
  | "AMOUNT_OVERFLOW"
  | "INVALID_DATE"
  | "UNSUPPORTED_CURRENCY"
  | "COMMAND_DUPLICATE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "CONFIRMATION_REQUIRED"
  | "PREVIEW_STALE"
  | "OPENING_NOT_ALLOWED"
  | "ENTRY_NOT_FOUND"
  | "ALREADY_REVERSED"
  | "REVERSAL_NOT_ALLOWED"
  | "LEDGER_INTEGRITY_FAILURE"
  | "READ_ONLY_RECOVERY"
  | "STORAGE_UNAVAILABLE"
  | "TRANSACTION_FAILED";

export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message = code,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

export interface Party {
  readonly schemaVersion: 1;
  readonly id: PartyId;
  readonly displayName: string;
  readonly searchName: string;
  readonly phone?: string;
  readonly note?: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly ledgerRevision: number;
  readonly metadataRevision: number;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
}

export interface JournalLine {
  readonly id: string;
  readonly entryId: EntryId;
  readonly lineNo: 1 | 2;
  readonly accountId: string;
  readonly accountKind: "PARTY_POSITION" | "POSITION_OFFSET";
  readonly side: "DEBIT" | "CREDIT";
  readonly amountMinor: number;
  readonly currency: "EGP";
}

export interface JournalEntry {
  readonly schemaVersion: 1;
  readonly id: EntryId;
  readonly sequence: number;
  readonly commandId: CommandId;
  readonly partyId: PartyId;
  readonly operation: FinancialOperation;
  readonly occurredAtUtc: string;
  readonly recordedAtUtc: string;
  readonly note?: string;
  readonly reversalReason?: string;
  readonly reversesEntryId?: EntryId;
  readonly correctionGroupId?: CommandId;
  readonly postingVersion: 1;
  readonly lines: readonly [JournalLine, JournalLine];
}

export interface Confirmation {
  readonly previewFingerprint: string;
  readonly expectedPartyRevision: number;
}
export interface PostCommand {
  commandId: CommandId;
  partyId: PartyId;
  operation: PostOperation;
  amountMinor: MoneyMinor;
  occurredAtUtc: string;
  note?: string;
  confirmation?: Confirmation;
}
export interface OpeningCommand {
  commandId: CommandId;
  partyId: PartyId;
  targetPositionMinor: MoneyMinor;
  occurredAtUtc: string;
  note?: string;
}
export interface ReverseCommand {
  commandId: CommandId;
  originalEntryId: EntryId;
  reason?: string;
  confirmation?: Confirmation;
}
export interface CorrectionCommand {
  commandId: CommandId;
  originalEntryId: EntryId;
  replacement: {
    partyId: PartyId;
    operation: ReplacementOperation;
    amountMinor: MoneyMinor;
    occurredAtUtc: string;
    note?: string;
  };
  reason?: string;
  confirmations?: readonly (Confirmation & { partyId: PartyId })[];
}
export interface PreviewResult {
  readonly schemaVersion: 1;
  readonly partyId: PartyId;
  readonly currentPositionMinor: number;
  readonly deltaMinor: number;
  readonly nextPositionMinor: number;
  readonly partyRevision: number;
  readonly needsConfirmation: boolean;
  readonly warning?: "SIGN_FLIP" | "ZERO_SETTLEMENT" | "UNEXPECTED_SETTLEMENT";
  readonly previewFingerprint: string;
}
export interface PostResult {
  readonly schemaVersion: 1;
  readonly entryIds: readonly EntryId[];
  readonly partyId: PartyId;
  readonly resultingPositionMinor: number;
  readonly lastSequence: number;
}
export interface HistoryPage {
  readonly schemaVersion: 1;
  readonly items: readonly (JournalEntry & {
    readonly visualStatus: "ACTIVE" | "REVERSED" | "CORRECTED";
  })[];
  readonly nextCursor?: string;
}
export interface PartyQuery {
  search?: string;
  cursor?: string;
  limit: number;
  includeArchived?: boolean;
}
export interface PartyPage {
  readonly schemaVersion: 1;
  readonly items: readonly Party[];
  readonly nextCursor?: string;
}
export interface LedgerIntegrityReport {
  readonly schemaVersion: 1;
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly partiesChecked: number;
  readonly issues: readonly string[];
}
