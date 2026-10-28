import { CoreError } from "../../src/types.js";
import { checkedAdd } from "../../src/money.js";
import { validateEntry } from "../../src/domain.js";
import type {
  CommandReceipt,
  LedgerReader,
  LedgerStore,
  LedgerTransaction,
} from "../../src/ports.js";
import type { JournalEntry, Party } from "../../src/types.js";

const copy = <T>(value: T): T => structuredClone(value);
function order(a: JournalEntry, b: JournalEntry): number {
  return a.occurredAtUtc < b.occurredAtUtc
    ? -1
    : a.occurredAtUtc > b.occurredAtUtc
      ? 1
      : a.sequence - b.sequence;
}
export class MemoryStore implements LedgerStore {
  private parties = new Map<string, Party>();
  private entries = new Map<string, JournalEntry>();
  private sequenceIndex = new Map<number, string>();
  private receipts = new Map<string, CommandReceipt>();
  private reversals = new Map<string, string>();
  private historyIds = new Map<string, string[]>();
  private positions = new Map<
    string,
    { amountMinor: number; revision: number }
  >();
  private sequence = 0;
  private readOnly = false;
  private queue: Promise<void> = Promise.resolve();
  failAt: "append" | "receipt" | "commit" | undefined;
  failOnAppendNumber: number | undefined;
  loseResponse = false;
  failRecovery = false;
  scans = 0;

  private reader(): LedgerReader {
    return {
      getReceipt: (id) => {
        const value = this.receipts.get(id);
        return value && copy(value);
      },
      getParty: (id) => {
        const value = this.parties.get(id);
        return value && copy(value);
      },
      listParties: () => [...this.parties.values()].map(copy),
      searchParties: (search, includeArchived, cursor, limit) => {
        const ids = [...this.parties.keys()].sort();
        if (cursor && !this.parties.has(cursor))
          throw new CoreError("INVALID_AMOUNT");
        const rows: Party[] = [];
        for (const id of ids) {
          if (cursor && id <= cursor) continue;
          const party = this.parties.get(id)!;
          if (
            (includeArchived || party.status === "ACTIVE") &&
            party.searchName.includes(search)
          )
            rows.push(copy(party));
          if (rows.length === limit) break;
        }
        return rows;
      },
      getEntry: (id) => {
        const value = this.entries.get(id);
        return value && copy(value);
      },
      getReversal: (id) => {
        const reversal = this.reversals.get(id);
        const value =
          reversal === undefined ? undefined : this.entries.get(reversal);
        return value === undefined ? undefined : copy(value);
      },
      hasPartyHistory: (id) => (this.historyIds.get(id)?.length ?? 0) > 0,
      getPosition: (id) =>
        copy(this.positions.get(id) ?? { amountMinor: 0, revision: 0 }),
      lastSequence: () => this.sequence,
      history: (id, highWater, afterSequence, limit) => {
        const ids = this.historyIds.get(id) ?? [];
        let start = ids.length - 1;
        if (afterSequence !== undefined) {
          const cursorId = this.sequenceIndex.get(afterSequence);
          const cursor = cursorId ? this.entries.get(cursorId) : undefined;
          if (!cursor || cursor.partyId !== id || cursor.sequence > highWater)
            throw new CoreError("INVALID_AMOUNT");
          let lo = 0,
            hi = ids.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (order(this.entries.get(ids[mid]!)!, cursor) < 0) lo = mid + 1;
            else hi = mid;
          }
          if (ids[lo] !== cursorId) throw new CoreError("INVALID_AMOUNT");
          start = lo - 1;
        }
        const rows: JournalEntry[] = [];
        for (let i = start; i >= 0 && rows.length < limit; i--) {
          const entry = this.entries.get(ids[i]!)!;
          if (entry.sequence <= highWater) rows.push(copy(entry));
        }
        return rows;
      },
      auditEntries: () => {
        this.scans += 1;
        const sequenceIndex = this.sequenceIndex;
        const entries = this.entries;
        const highWater = this.sequence;
        return (function* () {
          for (let sequence = 1; sequence <= highWater; sequence++) {
            const id = sequenceIndex.get(sequence);
            if (id) yield copy(entries.get(id)!);
          }
        })();
      },
      auditReceipts: () => {
        const receipts = this.receipts;
        return (function* () {
          for (const receipt of receipts.values()) yield copy(receipt);
        })();
      },
      isReadOnly: () => this.readOnly,
    };
  }

  async read<T>(work: (tx: LedgerReader) => T): Promise<T> {
    return work(this.reader());
  }
  async write<T>(work: (tx: LedgerTransaction) => T): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const undo: (() => void)[] = [];
    let appendCount = 0;
    const put = <K, V>(map: Map<K, V>, key: K, value: V) => {
      const had = map.has(key);
      const prior = map.get(key);
      undo.push(() => {
        if (had) map.set(key, prior!);
        else map.delete(key);
      });
      map.set(key, copy(value));
    };
    const tx: LedgerTransaction = {
      ...this.reader(),
      putReceipt: (receipt) => {
        if (this.failAt === "receipt") throw new Error("injected");
        if (this.receipts.has(receipt.commandId))
          throw new CoreError("IDEMPOTENCY_CONFLICT");
        put(this.receipts, receipt.commandId, receipt);
      },
      insertParty: (party) => {
        if (this.parties.has(party.id)) throw new CoreError("INVALID_PARTY");
        put(this.parties, party.id, party);
        put(this.positions, party.id, { amountMinor: 0, revision: 0 });
      },
      updateParty: (party) => {
        if (!this.parties.has(party.id)) throw new CoreError("INVALID_PARTY");
        put(this.parties, party.id, party);
      },
      deleteParty: (id) => {
        if (this.historyIds.get(id)?.length)
          throw new CoreError("REVERSAL_NOT_ALLOWED");
        const prior = this.parties.get(id);
        const position = this.positions.get(id);
        undo.push(() => {
          if (prior) this.parties.set(id, prior);
          if (position) this.positions.set(id, position);
        });
        this.parties.delete(id);
        this.positions.delete(id);
      },
      allocateSequence: () => {
        const prior = this.sequence;
        this.sequence += 1;
        undo.push(() => {
          this.sequence = prior;
        });
        return this.sequence;
      },
      appendEntry: (entry) => {
        appendCount += 1;
        if (this.failAt === "append" || appendCount === this.failOnAppendNumber)
          throw new Error("injected");
        const party = this.parties.get(entry.partyId);
        if (
          !party ||
          this.entries.has(entry.id) ||
          (entry.reversesEntryId &&
            this.reversals.has(entry.reversesEntryId)) ||
          entry.sequence !== this.sequence
        )
          throw new CoreError("LEDGER_INTEGRITY_FAILURE");
        validateEntry(entry, party);
        put(this.entries, entry.id, entry);
        put(this.sequenceIndex, entry.sequence, entry.id);
        const ids = this.historyIds.get(entry.partyId) ?? [];
        if (!this.historyIds.has(entry.partyId))
          put(this.historyIds, entry.partyId, []);
        let index = ids.length;
        if (index > 0 && order(this.entries.get(ids[index - 1]!)!, entry) > 0) {
          let lo = 0,
            hi = index;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (order(this.entries.get(ids[mid]!)!, entry) < 0) lo = mid + 1;
            else hi = mid;
          }
          index = lo;
        }
        ids.splice(index, 0, entry.id);
        undo.push(() => {
          ids.splice(index, 1);
        });
        this.historyIds.set(entry.partyId, ids);
        if (entry.reversesEntryId)
          put(this.reversals, entry.reversesEntryId, entry.id);
      },
      updatePosition: (id, amountMinor, revision) => {
        const prior = this.positions.get(id);
        if (
          !prior ||
          revision !== prior.revision + 1 ||
          !Number.isSafeInteger(amountMinor)
        )
          throw new CoreError("LEDGER_INTEGRITY_FAILURE");
        const last = this.sequenceIndex.get(this.sequence);
        const entry = last === undefined ? undefined : this.entries.get(last);
        const line = entry?.lines.find(
          (item) => item.accountKind === "PARTY_POSITION",
        );
        if (
          !line ||
          entry?.partyId !== id ||
          checkedAdd(
            prior.amountMinor,
            line.side === "DEBIT" ? line.amountMinor : -line.amountMinor,
          ) !== amountMinor
        )
          throw new CoreError("LEDGER_INTEGRITY_FAILURE");
        put(this.positions, id, { amountMinor, revision });
      },
    };
    try {
      const result = work(tx);
      if (this.failAt === "commit") throw new Error("injected");
      if (this.loseResponse) {
        this.loseResponse = false;
        throw new Error("response lost after commit");
      }
      return result;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          error.message === "response lost after commit"
        )
      )
        for (let i = undo.length - 1; i >= 0; i--) undo[i]!();
      throw error;
    } finally {
      release();
    }
  }
  async enterReadOnlyRecovery(): Promise<void> {
    if (this.failRecovery) throw new Error("recovery write failed");
    this.readOnly = true;
  }
  snapshot() {
    return {
      parties: [...this.parties.values()].map(copy),
      entries: [...this.entries.values()].map(copy),
      receipts: [...this.receipts.values()].map(copy),
      readOnly: this.readOnly,
    };
  }
  corruptEntry(change: (entry: JournalEntry) => JournalEntry): void {
    const first = this.entries.keys().next().value as string;
    this.entries.set(first, change(this.entries.get(first)!));
  }
  corruptReceipt(
    id: string,
    change: (receipt: CommandReceipt) => CommandReceipt,
  ): void {
    this.receipts.set(id, change(this.receipts.get(id)!));
  }
  createSequenceGap(): void {
    this.sequence += 1;
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
