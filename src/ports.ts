import type { CommandId, JournalEntry, Party } from "./types.js";

export interface CommandReceipt {
  readonly schemaVersion: 1;
  readonly commandId: CommandId;
  readonly kind: string;
  readonly canonicalPayload: string;
  /** Deterministic index checksum; full payload equality is authoritative. */
  readonly canonicalPayloadHash: string;
  readonly result: unknown;
}

/** The adapter must serialize writers, roll back the whole callback on failure, and persist read-only recovery. */
export interface LedgerReader {
  getReceipt(commandId: CommandId): CommandReceipt | undefined;
  getParty(partyId: string): Party | undefined;
  listParties(): readonly Party[];
  /** Ordered by party ID; return at most limit matches after cursor. Back with an adapter index. */
  searchParties(
    searchName: string,
    includeArchived: boolean,
    cursor: string | undefined,
    limit: number,
  ): readonly Party[];
  getEntry(entryId: string): JournalEntry | undefined;
  getReversal(entryId: string): JournalEntry | undefined;
  hasPartyHistory(partyId: string): boolean;
  getPosition(partyId: string): { amountMinor: number; revision: number };
  /** Aggregate the current position projection without materializing party records. */
  getTotals(): { receivableMinor: number; payableMinor: number };
  lastSequence(): number;
  history(
    partyId: string,
    highWater: number,
    afterSequence: number | undefined,
    limit: number,
  ): readonly JournalEntry[];
  /** Ordered by sequence, lazy and bounded by adapter page size. Audit-only. */
  auditEntries(): Iterable<JournalEntry>;
  /** Lazy traversal of all receipts, including commands with no journal entry. Audit-only. */
  auditReceipts(): Iterable<CommandReceipt>;
  isReadOnly(): boolean;
}

export interface LedgerTransaction extends LedgerReader {
  putReceipt(receipt: CommandReceipt): void;
  insertParty(party: Party): void;
  updateParty(party: Party): void;
  deleteParty(partyId: string): void;
  allocateSequence(): number;
  appendEntry(entry: JournalEntry): void;
  updatePosition(partyId: string, amountMinor: number, revision: number): void;
}

export interface LedgerStore {
  read<T>(work: (tx: LedgerReader) => T): Promise<T>;
  write<T>(work: (tx: LedgerTransaction) => T): Promise<T>;
  /** Durable independent transaction. Must survive a failed verification write. */
  enterReadOnlyRecovery(reason: string): Promise<void>;
}

export interface Clock {
  nowUtc(): string;
}
export interface IdGenerator {
  newId(): string;
}
