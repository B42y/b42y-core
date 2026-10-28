import type { CommandId, JournalEntry, Party } from "./types.js";

export interface CommandReceipt {
  readonly schemaVersion: 1;
  readonly commandId: CommandId;
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
  listEntries(): readonly JournalEntry[];
  isReadOnly(): boolean;
}

export interface LedgerTransaction extends LedgerReader {
  putReceipt(receipt: CommandReceipt): void;
  insertParty(party: Party): void;
  updateParty(party: Party): void;
  deleteParty(partyId: string): void;
  appendEntry(entry: JournalEntry): void;
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
