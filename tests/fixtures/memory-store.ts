import { CoreError } from "../../src/types.js";
import { validateEntry } from "../../src/domain.js";
import type {
  CommandReceipt,
  LedgerStore,
  LedgerReader,
  LedgerTransaction,
} from "../../src/ports.js";
import type { JournalEntry, Party } from "../../src/types.js";

interface State {
  parties: Party[];
  entries: JournalEntry[];
  receipts: CommandReceipt[];
  readOnly: boolean;
}

export class MemoryStore implements LedgerStore {
  private state: State = {
    parties: [],
    entries: [],
    receipts: [],
    readOnly: false,
  };
  private queue: Promise<unknown> = Promise.resolve();
  failAt: "append" | "receipt" | "commit" | undefined;
  failOnAppendNumber: number | undefined;
  loseResponse = false;

  private transaction(state: State): LedgerTransaction {
    let appendCount = 0;
    return {
      getReceipt: (id) => state.receipts.find((r) => r.commandId === id),
      putReceipt: (r) => {
        if (this.failAt === "receipt") throw new Error("injected");
        if (state.receipts.some((old) => old.commandId === r.commandId))
          throw new CoreError("IDEMPOTENCY_CONFLICT");
        state.receipts.push(structuredClone(r));
      },
      getParty: (id) => {
        const p = state.parties.find((item) => item.id === id);
        return p ? structuredClone(p) : undefined;
      },
      listParties: () => structuredClone(state.parties),
      insertParty: (p) => {
        if (state.parties.some((old) => old.id === p.id))
          throw new CoreError("INVALID_PARTY");
        state.parties.push(structuredClone(p));
      },
      updateParty: (p) => {
        const i = state.parties.findIndex((old) => old.id === p.id);
        if (i < 0) throw new CoreError("INVALID_PARTY");
        state.parties[i] = structuredClone(p);
      },
      deleteParty: (id) => {
        if (state.entries.some((e) => e.partyId === id))
          throw new CoreError("REVERSAL_NOT_ALLOWED");
        state.parties = state.parties.filter((p) => p.id !== id);
      },
      listEntries: () => structuredClone(state.entries),
      appendEntry: (e) => {
        appendCount += 1;
        if (this.failAt === "append" || appendCount === this.failOnAppendNumber)
          throw new Error("injected");
        const p = state.parties.find((item) => item.id === e.partyId);
        if (
          !p ||
          e.sequence !== state.entries.length + 1 ||
          state.entries.some(
            (old) =>
              old.id === e.id ||
              old.lines.some((line) =>
                e.lines.some((next) => next.id === line.id),
              ) ||
              (e.reversesEntryId && old.reversesEntryId === e.reversesEntryId),
          )
        )
          throw new CoreError("LEDGER_INTEGRITY_FAILURE");
        validateEntry(e, p);
        state.entries.push(structuredClone(e));
      },
      isReadOnly: () => state.readOnly,
    };
  }
  async read<T>(work: (tx: LedgerReader) => T): Promise<T> {
    return work(this.transaction(structuredClone(this.state)));
  }
  async write<T>(work: (tx: LedgerTransaction) => T): Promise<T> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const draft = structuredClone(this.state);
      const result = work(this.transaction(draft));
      if (this.failAt === "commit") throw new Error("injected");
      this.state = draft;
      if (this.loseResponse) {
        this.loseResponse = false;
        throw new Error("response lost");
      }
      return result;
    } finally {
      release();
    }
  }
  async enterReadOnlyRecovery(): Promise<void> {
    this.state.readOnly = true;
  }
  snapshot(): State {
    return structuredClone(this.state);
  }
  corruptEntry(change: (entry: JournalEntry) => JournalEntry): void {
    this.state.entries[0] = change(this.state.entries[0]!);
  }
}

export function fixtures() {
  let next = 1;
  const ids = {
    newId: () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`,
  };
  const clock = { nowUtc: () => "2026-01-01T00:00:00.000Z" };
  return { ids, clock };
}
