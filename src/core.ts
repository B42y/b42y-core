import {
  checked,
  checkedAdd,
  checkedNegate,
  positiveAmount,
  signedAmount,
} from "./money.js";
import {
  displayName,
  effect,
  makeEntry,
  normalizeName,
  position,
  preview,
  validateEntry,
  validateUtc,
  validateUuid,
} from "./domain.js";
import { CoreError } from "./types.js";
import type {
  Clock,
  IdGenerator,
  LedgerStore,
  LedgerReader,
  LedgerTransaction,
} from "./ports.js";
import type {
  Confirmation,
  CorrectionCommand,
  HistoryPage,
  JournalEntry,
  LedgerIntegrityReport,
  OpeningCommand,
  Party,
  PartyPage,
  PartyQuery,
  PostCommand,
  PostOperation,
  PostResult,
  PreviewResult,
  ReverseCommand,
} from "./types.js";

type PartyCreate = {
  commandId: string;
  displayName: string;
  phone?: string;
  note?: string;
};
type PartyEdit = {
  commandId: string;
  partyId: string;
  displayName?: string;
  phone?: string | null;
  note?: string | null;
};
type PartyAction = { commandId: string; partyId: string };
type DeleteAction = PartyAction & { confirmationToken: string };

export interface CoreService {
  createParty(command: PartyCreate): Promise<Party>;
  editParty(command: PartyEdit): Promise<Party>;
  archiveParty(command: PartyAction): Promise<void>;
  reactivateParty(command: PartyAction): Promise<void>;
  previewDeleteUnpostedParty(partyId: string): Promise<string>;
  deleteUnpostedParty(command: DeleteAction): Promise<void>;
  previewPost(command: PostCommand): Promise<PreviewResult>;
  post(command: PostCommand): Promise<PostResult>;
  setOpeningPosition(command: OpeningCommand): Promise<PostResult>;
  previewReverse(command: ReverseCommand): Promise<PreviewResult>;
  reverse(command: ReverseCommand): Promise<PostResult>;
  previewCorrection(
    command: CorrectionCommand,
  ): Promise<readonly PreviewResult[]>;
  correct(command: CorrectionCommand): Promise<PostResult>;
  getPartyPosition(partyId: string): Promise<number>;
  getTotals(): Promise<{ receivableMinor: number; payableMinor: number }>;
  getPartyHistory(
    partyId: string,
    paging: { cursor?: string; limit: number },
  ): Promise<HistoryPage>;
  listParties(query: PartyQuery): Promise<PartyPage>;
  verifyLedger(): Promise<LedgerIntegrityReport>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  const out = JSON.stringify(value);
  if (out === undefined) throw new CoreError("INVALID_AMOUNT");
  return out;
}

function meaning(command: object): string {
  const {
    confirmation: _confirmation,
    confirmations: _confirmations,
    ...payload
  } = command as Record<string, unknown>;
  void _confirmation;
  void _confirmations;
  return canonical(payload);
}

function canonicalHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function historyCursor(
  cursor: string,
  partyId: string,
): { highWater: number; lastSequence: number } {
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 4 ||
      parsed[0] !== 1 ||
      parsed[1] !== partyId ||
      !Number.isSafeInteger(parsed[2]) ||
      !Number.isSafeInteger(parsed[3])
    )
      throw new Error("bad cursor");
    return {
      highWater: parsed[2] as number,
      lastSequence: parsed[3] as number,
    };
  } catch {
    throw new CoreError("INVALID_AMOUNT");
  }
}

function party(tx: LedgerReader, id: string, active = false): Party {
  const found = tx.getParty(validateUuid(id));
  if (!found) throw new CoreError("INVALID_PARTY");
  if (active && found.status !== "ACTIVE")
    throw new CoreError("PARTY_ARCHIVED");
  return found;
}

function original(tx: LedgerReader, id: string): JournalEntry {
  const found = tx.listEntries().find((entry) => entry.id === validateUuid(id));
  if (!found) throw new CoreError("ENTRY_NOT_FOUND");
  if (found.operation === "REVERSAL")
    throw new CoreError("REVERSAL_NOT_ALLOWED");
  if (tx.listEntries().some((entry) => entry.reversesEntryId === found.id))
    throw new CoreError("ALREADY_REVERSED");
  return found;
}

function requireConfirmation(
  plan: PreviewResult,
  confirmation?: Confirmation,
): void {
  if (!confirmation) {
    if (plan.needsConfirmation) throw new CoreError("CONFIRMATION_REQUIRED");
    return;
  }
  if (
    confirmation.expectedPartyRevision !== plan.partyRevision ||
    confirmation.previewFingerprint !== plan.previewFingerprint
  )
    throw new CoreError("PREVIEW_STALE");
}

function assertHealth(tx: LedgerReader): void {
  if (tx.isReadOnly()) throw new CoreError("READ_ONLY_RECOVERY");
}

function integrity(tx: LedgerReader): LedgerIntegrityReport {
  const issues: string[] = [];
  const entries = [...tx.listEntries()].sort((a, b) => a.sequence - b.sequence);
  const parties = tx.listParties();
  const ids = new Set<string>();
  const reversed = new Set<string>();
  let sequence = 0;
  for (const entry of entries) {
    try {
      if (entry.sequence !== ++sequence || ids.has(entry.id))
        throw new CoreError("LEDGER_INTEGRITY_FAILURE");
      const p = party(tx, entry.partyId);
      validateEntry(entry, p);
      validateUtc(entry.occurredAtUtc);
      validateUtc(entry.recordedAtUtc);
      const receipt = tx.getReceipt(entry.commandId);
      const receiptResult = receipt?.result;
      if (
        receipt?.schemaVersion !== 1 ||
        !receipt.canonicalPayload ||
        receipt.canonicalPayloadHash !==
          canonicalHash(receipt.canonicalPayload) ||
        !receiptResult ||
        typeof receiptResult !== "object" ||
        !("entryIds" in receiptResult) ||
        !Array.isArray(receiptResult.entryIds) ||
        !receiptResult.entryIds.includes(entry.id)
      )
        throw new CoreError("LEDGER_INTEGRITY_FAILURE");
      if (entry.operation === "REVERSAL") {
        const prior = entries.find(
          (item) =>
            item.id === entry.reversesEntryId && item.sequence < entry.sequence,
        );
        if (
          !prior ||
          prior.operation === "REVERSAL" ||
          reversed.has(prior.id) ||
          prior.partyId !== entry.partyId ||
          prior.lines.some(
            (line, i) =>
              line.amountMinor !== entry.lines[i]?.amountMinor ||
              line.accountId !== entry.lines[i]?.accountId ||
              line.side === entry.lines[i]?.side,
          )
        )
          throw new CoreError("LEDGER_INTEGRITY_FAILURE");
        reversed.add(prior.id);
      }
      ids.add(entry.id);
    } catch {
      issues.push(`entry:${entry.id}`);
    }
  }
  for (const p of parties) {
    try {
      position(entries, p.id);
      if (
        p.ledgerRevision !==
        entries.filter((entry) => entry.partyId === p.id).length
      )
        throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    } catch {
      issues.push(`party:${p.id}`);
    }
  }
  const groups = new Set(
    entries.flatMap((entry) =>
      entry.correctionGroupId ? [entry.correctionGroupId] : [],
    ),
  );
  for (const group of groups) {
    const children = entries.filter(
      (entry) => entry.correctionGroupId === group,
    );
    const first = children[0];
    const second = children[1];
    if (
      children.length !== 2 ||
      !first ||
      !second ||
      first.operation !== "REVERSAL" ||
      second.operation === "REVERSAL" ||
      second.sequence !== first.sequence + 1 ||
      children.some((entry) => entry.commandId !== group)
    )
      issues.push(`correction:${group}`);
  }
  return {
    schemaVersion: 1,
    valid: issues.length === 0,
    entriesChecked: entries.length,
    partiesChecked: parties.length,
    issues,
  };
}

export function createCoreService(deps: {
  store: LedgerStore;
  clock: Clock;
  ids: IdGenerator;
}): CoreService {
  const { store, clock, ids } = deps;
  const now = (): string => validateUtc(clock.nowUtc());
  const newId = (): string => validateUuid(ids.newId());
  async function run<T>(
    kind: string,
    command: { commandId: string },
    work: (tx: LedgerTransaction) => T,
  ): Promise<T> {
    const commandId = validateUuid(command.commandId);
    const payload = canonical([1, kind, meaning(command)]);
    try {
      return await store.write((tx) => {
        const prior = tx.getReceipt(commandId);
        if (prior) {
          if (
            prior.canonicalPayloadHash !== canonicalHash(prior.canonicalPayload)
          )
            throw new CoreError("LEDGER_INTEGRITY_FAILURE");
          if (prior.canonicalPayload !== payload)
            throw new CoreError("IDEMPOTENCY_CONFLICT");
          return prior.result as T;
        }
        assertHealth(tx);
        if (!integrity(tx).valid)
          throw new CoreError("LEDGER_INTEGRITY_FAILURE");
        const result = work(tx);
        tx.putReceipt({
          schemaVersion: 1,
          commandId,
          canonicalPayload: payload,
          canonicalPayloadHash: canonicalHash(payload),
          result,
        });
        return result;
      });
    } catch (error) {
      if (error instanceof CoreError) {
        if (error.code === "LEDGER_INTEGRITY_FAILURE")
          await store.enterReadOnlyRecovery(error.message);
        throw error;
      }
      throw new CoreError("TRANSACTION_FAILED");
    }
  }
  function append(
    tx: LedgerTransaction,
    input: Omit<
      JournalEntry,
      | "schemaVersion"
      | "postingVersion"
      | "lines"
      | "id"
      | "sequence"
      | "recordedAtUtc"
    > & { amountMinor: number; deltaMinor: number },
  ): JournalEntry {
    const p = party(tx, input.partyId, true);
    const id = newId();
    const entry = makeEntry({
      ...input,
      commandId: validateUuid(input.commandId),
      occurredAtUtc: validateUtc(input.occurredAtUtc),
      id,
      sequence: tx.listEntries().length + 1,
      recordedAtUtc: now(),
      lineIds: [newId(), newId()],
    });
    validateEntry(entry, p);
    tx.appendEntry(entry);
    tx.updateParty({
      ...p,
      ledgerRevision: checkedAdd(p.ledgerRevision, 1),
      updatedAtUtc: entry.recordedAtUtc,
    });
    return entry;
  }
  function postPreview(tx: LedgerReader, command: PostCommand): PreviewResult {
    const p = party(tx, command.partyId, true);
    validateUtc(command.occurredAtUtc);
    const amount = positiveAmount(command.amountMinor);
    const op = command.operation;
    if (
      !(
        ["ADD_RECEIVABLE", "ADD_PAYABLE", "RECEIVE", "PAY"] as string[]
      ).includes(op)
    )
      throw new CoreError("INVALID_AMOUNT");
    return preview(
      p,
      position(tx.listEntries(), p.id),
      effect(op, amount),
      meaning(command),
      op,
    );
  }
  function reversePreview(
    tx: LedgerReader,
    command: ReverseCommand,
  ): PreviewResult {
    const entry = original(tx, command.originalEntryId);
    const p = party(tx, entry.partyId, true);
    const line = entry.lines.find(
      (item) => item.accountKind === "PARTY_POSITION",
    );
    if (!line) throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    const delta = line.side === "DEBIT" ? -line.amountMinor : line.amountMinor;
    return preview(
      p,
      position(tx.listEntries(), p.id),
      delta,
      meaning(command),
    );
  }
  function correctionPreviews(
    tx: LedgerReader,
    command: CorrectionCommand,
  ): readonly PreviewResult[] {
    const old = original(tx, command.originalEntryId);
    const oldParty = party(tx, old.partyId, true);
    const newParty = party(tx, command.replacement.partyId, true);
    const replacement = command.replacement;
    validateUtc(replacement.occurredAtUtc);
    const amount = positiveAmount(replacement.amountMinor);
    const isOpening =
      old.operation === "OPENING_RECEIVABLE" ||
      old.operation === "OPENING_PAYABLE";
    const replacementOpening =
      replacement.operation === "OPENING_RECEIVABLE" ||
      replacement.operation === "OPENING_PAYABLE";
    if (
      isOpening !== replacementOpening ||
      (isOpening && oldParty.id !== newParty.id)
    )
      throw new CoreError("OPENING_NOT_ALLOWED");
    const oldLine = old.lines.find(
      (item) => item.accountKind === "PARTY_POSITION",
    );
    if (!oldLine) throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    const undo =
      oldLine.side === "DEBIT" ? -oldLine.amountMinor : oldLine.amountMinor;
    const add = effect(replacement.operation, amount);
    const oldBefore = position(tx.listEntries(), oldParty.id);
    const key = meaning(command);
    if (oldParty.id === newParty.id)
      return [preview(oldParty, oldBefore, checkedAdd(undo, add), key)];
    return [
      preview(oldParty, oldBefore, undo, key),
      preview(newParty, position(tx.listEntries(), newParty.id), add, key),
    ];
  }
  return {
    createParty: (command) =>
      run("createParty", command, (tx) => {
        const name = displayName(command.displayName);
        const time = now();
        const p: Party = {
          schemaVersion: 1,
          id: newId(),
          displayName: name,
          searchName: normalizeName(name),
          ...(command.phone !== undefined ? { phone: command.phone } : {}),
          ...(command.note !== undefined ? { note: command.note } : {}),
          status: "ACTIVE",
          ledgerRevision: 0,
          metadataRevision: 0,
          createdAtUtc: time,
          updatedAtUtc: time,
        };
        tx.insertParty(p);
        return p;
      }),
    editParty: (command) =>
      run("editParty", command, (tx) => {
        const p = party(tx, command.partyId);
        const name =
          command.displayName === undefined
            ? p.displayName
            : displayName(command.displayName);
        const { phone: _oldPhone, note: _oldNote, ...base } = p;
        void _oldPhone;
        void _oldNote;
        const phone = command.phone === undefined ? p.phone : command.phone;
        const note = command.note === undefined ? p.note : command.note;
        const next: Party = {
          ...base,
          displayName: name,
          searchName: normalizeName(name),
          ...(phone == null ? {} : { phone }),
          ...(note == null ? {} : { note }),
          metadataRevision: checkedAdd(p.metadataRevision, 1),
          updatedAtUtc: now(),
        };
        tx.updateParty(next);
        return next;
      }),
    archiveParty: (command) =>
      run("archiveParty", command, (tx) => {
        const p = party(tx, command.partyId);
        tx.updateParty({
          ...p,
          status: "ARCHIVED",
          metadataRevision: checkedAdd(p.metadataRevision, 1),
          updatedAtUtc: now(),
        });
      }),
    reactivateParty: (command) =>
      run("reactivateParty", command, (tx) => {
        const p = party(tx, command.partyId);
        tx.updateParty({
          ...p,
          status: "ACTIVE",
          metadataRevision: checkedAdd(p.metadataRevision, 1),
          updatedAtUtc: now(),
        });
      }),
    previewDeleteUnpostedParty: (id) =>
      store.read((tx) => {
        const p = party(tx, id);
        if (tx.listEntries().some((e) => e.partyId === p.id))
          throw new CoreError("REVERSAL_NOT_ALLOWED");
        return canonical([1, p.id, p.metadataRevision, p.ledgerRevision]);
      }),
    deleteUnpostedParty: (command) =>
      run("deleteUnpostedParty", command, (tx) => {
        const p = party(tx, command.partyId);
        if (tx.listEntries().some((e) => e.partyId === p.id))
          throw new CoreError("REVERSAL_NOT_ALLOWED");
        if (
          command.confirmationToken !==
          canonical([1, p.id, p.metadataRevision, p.ledgerRevision])
        )
          throw new CoreError("PREVIEW_STALE");
        tx.deleteParty(p.id);
      }),
    previewPost: (command) =>
      store.read((tx) => {
        assertHealth(tx);
        return postPreview(tx, command);
      }),
    post: (command) =>
      run("post", command, (tx) => {
        const plan = postPreview(tx, command);
        requireConfirmation(plan, command.confirmation);
        const entry = append(tx, {
          commandId: command.commandId,
          partyId: plan.partyId,
          operation: command.operation,
          amountMinor: command.amountMinor,
          deltaMinor: plan.deltaMinor,
          occurredAtUtc: command.occurredAtUtc,
          ...(command.note !== undefined ? { note: command.note } : {}),
        });
        return {
          schemaVersion: 1,
          entryIds: [entry.id],
          partyId: plan.partyId,
          resultingPositionMinor: plan.nextPositionMinor,
          lastSequence: entry.sequence,
        };
      }),
    setOpeningPosition: (command) =>
      run("setOpeningPosition", command, (tx) => {
        const p = party(tx, command.partyId, true);
        validateUtc(command.occurredAtUtc);
        const target = signedAmount(command.targetPositionMinor);
        if (tx.listEntries().some((e) => e.partyId === p.id))
          throw new CoreError("OPENING_NOT_ALLOWED");
        if (target === 0)
          return {
            schemaVersion: 1,
            entryIds: [],
            partyId: p.id,
            resultingPositionMinor: 0,
            lastSequence: tx.listEntries().length,
          };
        const entry = append(tx, {
          commandId: command.commandId,
          partyId: p.id,
          operation: target > 0 ? "OPENING_RECEIVABLE" : "OPENING_PAYABLE",
          amountMinor: Math.abs(target),
          deltaMinor: target,
          occurredAtUtc: command.occurredAtUtc,
          ...(command.note !== undefined ? { note: command.note } : {}),
        });
        return {
          schemaVersion: 1,
          entryIds: [entry.id],
          partyId: p.id,
          resultingPositionMinor: target,
          lastSequence: entry.sequence,
        };
      }),
    previewReverse: (command) =>
      store.read((tx) => {
        assertHealth(tx);
        return reversePreview(tx, command);
      }),
    reverse: (command) =>
      run("reverse", command, (tx) => {
        const plan = reversePreview(tx, command);
        requireConfirmation(plan, command.confirmation);
        const old = original(tx, command.originalEntryId);
        const entry = append(tx, {
          commandId: command.commandId,
          partyId: old.partyId,
          operation: "REVERSAL",
          amountMinor: old.lines[0].amountMinor,
          deltaMinor: plan.deltaMinor,
          occurredAtUtc: now(),
          reversesEntryId: old.id,
          ...(command.reason !== undefined
            ? { reversalReason: command.reason }
            : {}),
        });
        return {
          schemaVersion: 1,
          entryIds: [entry.id],
          partyId: old.partyId,
          resultingPositionMinor: plan.nextPositionMinor,
          lastSequence: entry.sequence,
        };
      }),
    previewCorrection: (command) =>
      store.read((tx) => {
        assertHealth(tx);
        return correctionPreviews(tx, command);
      }),
    correct: (command) =>
      run("correct", command, (tx) => {
        const plans = correctionPreviews(tx, command);
        for (const plan of plans)
          requireConfirmation(
            plan,
            command.confirmations?.find((c) => c.partyId === plan.partyId),
          );
        const old = original(tx, command.originalEntryId);
        const oldLine = old.lines.find(
          (l) => l.accountKind === "PARTY_POSITION",
        );
        if (!oldLine) throw new CoreError("LEDGER_INTEGRITY_FAILURE");
        const undo =
          oldLine.side === "DEBIT" ? -oldLine.amountMinor : oldLine.amountMinor;
        const reversal = append(tx, {
          commandId: command.commandId,
          partyId: old.partyId,
          operation: "REVERSAL",
          amountMinor: oldLine.amountMinor,
          deltaMinor: undo,
          occurredAtUtc: now(),
          reversesEntryId: old.id,
          correctionGroupId: command.commandId,
          ...(command.reason !== undefined
            ? { reversalReason: command.reason }
            : {}),
        });
        const replacement = append(tx, {
          commandId: command.commandId,
          partyId: command.replacement.partyId,
          operation: command.replacement.operation,
          amountMinor: command.replacement.amountMinor,
          deltaMinor: effect(
            command.replacement.operation,
            command.replacement.amountMinor,
          ),
          occurredAtUtc: command.replacement.occurredAtUtc,
          correctionGroupId: command.commandId,
          ...(command.replacement.note !== undefined
            ? { note: command.replacement.note }
            : {}),
        });
        return {
          schemaVersion: 1,
          entryIds: [reversal.id, replacement.id],
          partyId: replacement.partyId,
          resultingPositionMinor: position(
            tx.listEntries(),
            replacement.partyId,
          ),
          lastSequence: replacement.sequence,
        };
      }),
    getPartyPosition: (id) =>
      store.read((tx) => {
        const p = party(tx, id);
        return position(tx.listEntries(), p.id);
      }),
    getTotals: () =>
      store.read((tx) => {
        let receivableMinor = 0;
        let payableMinor = 0;
        for (const p of tx.listParties()) {
          const amount = position(tx.listEntries(), p.id);
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
        const cursor = paging.cursor
          ? historyCursor(paging.cursor, p.id)
          : undefined;
        const highWater = cursor?.highWater ?? tx.listEntries().length;
        if (highWater < 0 || highWater > tx.listEntries().length)
          throw new CoreError("INVALID_AMOUNT");
        const all = tx
          .listEntries()
          .filter((entry) => entry.sequence <= highWater);
        const sorted = all
          .filter((e) => e.partyId === p.id)
          .sort(
            (a, b) =>
              (b.occurredAtUtc < a.occurredAtUtc
                ? -1
                : b.occurredAtUtc > a.occurredAtUtc
                  ? 1
                  : 0) || b.sequence - a.sequence,
          );
        const start = cursor
          ? sorted.findIndex((e) => e.sequence === cursor.lastSequence) + 1
          : 0;
        if (cursor && start === 0) throw new CoreError("INVALID_AMOUNT");
        const items = sorted.slice(start, start + limit).map((e) => ({
          ...e,
          visualStatus: all.some((x) => x.reversesEntryId === e.id)
            ? ((all.some(
                (x) => x.reversesEntryId === e.id && x.correctionGroupId,
              )
                ? "CORRECTED"
                : "REVERSED") as "CORRECTED" | "REVERSED")
            : ("ACTIVE" as const),
        }));
        const last = items.at(-1);
        return {
          schemaVersion: 1,
          items,
          ...(last && start + limit < sorted.length
            ? { nextCursor: canonical([1, p.id, highWater, last.sequence]) }
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
      const report = await store.read(integrity);
      if (!report.valid)
        await store.enterReadOnlyRecovery(report.issues.join(","));
      return report;
    },
  };
}
