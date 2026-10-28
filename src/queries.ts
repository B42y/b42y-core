import { auditLedger } from "./audit.js";
import { normalizeName, validateUuid } from "./domain.js";
import { checked, checkedAdd, checkedNegate } from "./money.js";
import { CoreError } from "./types.js";
import type { LedgerStore, LedgerReader } from "./ports.js";
import type { CoreService } from "./core.js";
import type { Party } from "./types.js";

function party(tx: LedgerReader, id: string): Party {
  const found = tx.getParty(validateUuid(id));
  if (!found) throw new CoreError("INVALID_PARTY");
  return found;
}

function cursor(
  value: string,
  partyId: string,
): { highWater: number; lastSequence: number } {
  try {
    const row: unknown = JSON.parse(value);
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      row[0] !== 1 ||
      row[1] !== partyId ||
      !Number.isSafeInteger(row[2]) ||
      !Number.isSafeInteger(row[3])
    )
      throw new Error("cursor");
    return { highWater: row[2] as number, lastSequence: row[3] as number };
  } catch {
    throw new CoreError("INVALID_AMOUNT");
  }
}

type Queries = Pick<
  CoreService,
  | "getPartyPosition"
  | "getTotals"
  | "getPartyHistory"
  | "listParties"
  | "verifyLedger"
>;
export function createQueries(store: LedgerStore): Queries {
  return {
    getPartyPosition: (id) =>
      store.read((tx) => {
        const p = party(tx, id);
        return tx.getPosition(p.id).amountMinor;
      }),
    getTotals: () =>
      store.read((tx) => {
        let receivableMinor = 0;
        let payableMinor = 0;
        for (const p of tx.listParties()) {
          const amount = tx.getPosition(p.id).amountMinor;
          if (amount > 0) receivableMinor = checkedAdd(receivableMinor, amount);
          else payableMinor = checkedAdd(payableMinor, checkedNegate(amount));
        }
        return { receivableMinor, payableMinor };
      }),
    getPartyHistory: (id, paging) =>
      store.read((tx) => {
        const p = party(tx, id);
        const limit = checked(paging.limit);
        if (limit < 1 || limit > 100) throw new CoreError("INVALID_AMOUNT");
        const parsed = paging.cursor ? cursor(paging.cursor, p.id) : undefined;
        const highWater = parsed?.highWater ?? tx.lastSequence();
        if (highWater < 0 || highWater > tx.lastSequence())
          throw new CoreError("INVALID_AMOUNT");
        const rows = tx.history(
          p.id,
          highWater,
          parsed?.lastSequence,
          limit + 1,
        );
        const items = rows.slice(0, limit).map((entry) => {
          const reversal = tx.getReversal(entry.id);
          const visualStatus = reversal
            ? reversal.correctionGroupId
              ? "CORRECTED"
              : "REVERSED"
            : "ACTIVE";
          return { ...entry, visualStatus } as const;
        });
        const last = items.at(-1);
        return {
          schemaVersion: 1,
          items,
          ...(last && rows.length > limit
            ? {
                nextCursor: JSON.stringify([1, p.id, highWater, last.sequence]),
              }
            : {}),
        };
      }),
    listParties: (query) =>
      store.read((tx) => {
        const limit = checked(query.limit);
        if (limit < 1 || limit > 100) throw new CoreError("INVALID_AMOUNT");
        const search = query.search ? normalizeName(query.search) : "";
        const sorted = tx
          .listParties()
          .filter(
            (p) =>
              (query.includeArchived || p.status === "ACTIVE") &&
              p.searchName.includes(search),
          )
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const start = query.cursor
          ? sorted.findIndex((p) => p.id === query.cursor) + 1
          : 0;
        if (query.cursor && start === 0) throw new CoreError("INVALID_AMOUNT");
        const items = sorted.slice(start, start + limit);
        const last = items.at(-1);
        return {
          schemaVersion: 1,
          items,
          ...(last && start + limit < sorted.length
            ? { nextCursor: last.id }
            : {}),
        };
      }),
    verifyLedger: async () => {
      const report = await store.read(auditLedger);
      if (!report.valid) {
        try {
          await store.enterReadOnlyRecovery(report.issues.join(","));
        } catch {
          throw new CoreError("STORAGE_UNAVAILABLE");
        }
      }
      return report;
    },
  };
}
