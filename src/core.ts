import { checkedAdd, positiveAmount, signedAmount } from "./money.js";
import {
  displayName,
  effect,
  makeEntry,
  normalizeName,
  preview,
  validateEntry,
  validateUtc,
  validateUuid,
} from "./domain.js";
import { CoreError } from "./types.js";
import { auditLedger } from "./audit.js";
import { createQueries } from "./queries.js";
import { validatedCommand } from "./validation.js";
import { sha256 } from "./digest.js";
import { checkedReceiptResult } from "./receipt.js";
import type { CommandKind } from "./validation.js";
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
  return "v2:" + sha256(value);
}

function party(tx: LedgerReader, id: string, active = false): Party {
  const found = tx.getParty(validateUuid(id));
  if (!found) throw new CoreError("INVALID_PARTY");
  if (active && found.status !== "ACTIVE")
    throw new CoreError("PARTY_ARCHIVED");
  return found;
}

function original(tx: LedgerReader, id: string): JournalEntry {
  const found = tx.getEntry(validateUuid(id));
  if (!found) throw new CoreError("ENTRY_NOT_FOUND");
  if (found.operation === "REVERSAL")
    throw new CoreError("REVERSAL_NOT_ALLOWED");
  if (tx.getReversal(found.id)) throw new CoreError("ALREADY_REVERSED");
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

export function createCoreService(deps: {
  store: LedgerStore;
  clock: Clock;
  ids: IdGenerator;
}): CoreService {
  const { store, clock, ids } = deps;
  const ready = (async () => {
    let reason: string | undefined;
    try {
      const report = await store.read(auditLedger);
      if (!report.valid) reason = report.issues.join(",");
    } catch {
      reason = "initial audit failed";
    }
    if (reason === undefined) return;
    try {
      await store.enterReadOnlyRecovery(reason);
    } catch {
      throw new CoreError("STORAGE_UNAVAILABLE");
    }
    throw new CoreError("READ_ONLY_RECOVERY");
  })();
  void ready.catch(() => {});
  const now = (): string => validateUtc(clock.nowUtc());
  const newId = (): string => validateUuid(ids.newId());
  async function run<C extends { commandId: string }, T>(
    kind: CommandKind,
    command: C,
    work: (tx: LedgerTransaction, validated: C) => T,
  ): Promise<T> {
    const validated = validatedCommand(kind, command);
    const commandId = validated.commandId as string;
    const payload = canonical([1, kind, meaning(validated)]);
    try {
      await ready;
      return await store.write((tx) => {
        const prior = tx.getReceipt(commandId);
        if (prior) {
          if (
            prior.schemaVersion !== 1 ||
            prior.kind !== kind ||
            prior.canonicalPayloadHash !== canonicalHash(prior.canonicalPayload)
          )
            throw new CoreError("LEDGER_INTEGRITY_FAILURE");
          if (prior.canonicalPayload !== payload)
            throw new CoreError("IDEMPOTENCY_CONFLICT");
          return checkedReceiptResult(kind, prior.result) as T;
        }
        assertHealth(tx);
        const result = work(tx, validated as C);
        tx.putReceipt({
          schemaVersion: 1,
          commandId,
          kind,
          canonicalPayload: payload,
          canonicalPayloadHash: canonicalHash(payload),
          result,
        });
        return result;
      });
    } catch (error) {
      if (error instanceof CoreError) {
        if (error.code === "LEDGER_INTEGRITY_FAILURE") {
          try {
            await store.enterReadOnlyRecovery(error.message);
          } catch {
            throw new CoreError("STORAGE_UNAVAILABLE");
          }
        }
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
      sequence: tx.allocateSequence(),
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
    const before = tx.getPosition(p.id);
    if (before.revision !== p.ledgerRevision)
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    tx.updatePosition(
      p.id,
      checkedAdd(before.amountMinor, input.deltaMinor),
      checkedAdd(p.ledgerRevision, 1),
    );
    return entry;
  }
  function postPreview(tx: LedgerReader, input: PostCommand): PreviewResult {
    const command = validatedCommand("post", input) as unknown as PostCommand;
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
      tx.getPosition(p.id).amountMinor,
      effect(op, amount),
      meaning(command),
      op,
    );
  }
  function reversePreview(
    tx: LedgerReader,
    input: ReverseCommand,
  ): PreviewResult {
    const command = validatedCommand("reverse", input) as unknown as ReverseCommand;
    const entry = original(tx, command.originalEntryId);
    const p = party(tx, entry.partyId, true);
    const line = entry.lines.find(
      (item) => item.accountKind === "PARTY_POSITION",
    );
    if (!line) throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    const delta = line.side === "DEBIT" ? -line.amountMinor : line.amountMinor;
    return preview(
      p,
      tx.getPosition(p.id).amountMinor,
      delta,
      meaning(command),
    );
  }
  function correctionPreviews(
    tx: LedgerReader,
    input: CorrectionCommand,
  ): readonly PreviewResult[] {
    const command = validatedCommand("correct", input) as unknown as CorrectionCommand;
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
    const oldBefore = tx.getPosition(oldParty.id).amountMinor;
    const key = meaning(command);
    if (oldParty.id === newParty.id)
      return [
        preview(
          oldParty,
          oldBefore,
          checkedAdd(undo, add),
          key,
          replacement.operation as PostOperation,
          checkedAdd(oldBefore, undo),
        ),
      ];
    return [
      preview(oldParty, oldBefore, undo, key),
      preview(
        newParty,
        tx.getPosition(newParty.id).amountMinor,
        add,
        key,
        replacement.operation as PostOperation,
      ),
    ];
  }
  return {
    createParty: (command) =>
      run("createParty", command, (tx, command) => {
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
      run("editParty", command, (tx, command) => {
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
      run("archiveParty", command, (tx, command) => {
        const p = party(tx, command.partyId);
        tx.updateParty({
          ...p,
          status: "ARCHIVED",
          metadataRevision: checkedAdd(p.metadataRevision, 1),
          updatedAtUtc: now(),
        });
      }),
    reactivateParty: (command) =>
      run("reactivateParty", command, (tx, command) => {
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
        if (tx.hasPartyHistory(p.id))
          throw new CoreError("REVERSAL_NOT_ALLOWED");
        return canonical([1, p.id, p.metadataRevision, p.ledgerRevision]);
      }),
    deleteUnpostedParty: (command) =>
      run("deleteUnpostedParty", command, (tx, command) => {
        const p = party(tx, command.partyId);
        if (tx.hasPartyHistory(p.id))
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
      run("post", command, (tx, command) => {
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
      run("setOpeningPosition", command, (tx, command) => {
        const p = party(tx, command.partyId, true);
        validateUtc(command.occurredAtUtc);
        const target = signedAmount(command.targetPositionMinor);
        if (tx.hasPartyHistory(p.id))
          throw new CoreError("OPENING_NOT_ALLOWED");
        if (target === 0)
          return {
            schemaVersion: 1,
            entryIds: [],
            partyId: p.id,
            resultingPositionMinor: 0,
            lastSequence: tx.lastSequence(),
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
      run("reverse", command, (tx, command) => {
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
      run("correct", command, (tx, command) => {
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
          resultingPositionMinor: tx.getPosition(replacement.partyId)
            .amountMinor,
          lastSequence: replacement.sequence,
        };
      }),
    ...createQueries(store),
  };
}
