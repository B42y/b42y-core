import { checkedAdd } from "./money.js";
import { validateEntry, validateUtc } from "./domain.js";
import { sha256 } from "./digest.js";
import { checkedReceiptResult } from "./receipt.js";
import type { CommandKind } from "./validation.js";
import type { LedgerReader } from "./ports.js";
import type { LedgerIntegrityReport } from "./types.js";

/** Full audit is explicit and linear in entries plus parties, with bounded per-entry work. */
export function auditLedger(tx: LedgerReader): LedgerIntegrityReport {
  const issues: string[] = [];
  const positions = new Map<
    string,
    { amountMinor: number; revision: number }
  >();
  let pendingCorrection: { id: string; reversalSequence: number } | undefined;
  let last = 0;
  let entriesChecked = 0;
  for (const entry of tx.auditEntries()) {
    entriesChecked += 1;
    try {
      if (
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence <= last ||
        entry.schemaVersion !== 1 ||
        entry.postingVersion !== 1
      )
        throw new Error("sequence/version");
      last = entry.sequence;
      if (
        pendingCorrection &&
        (entry.correctionGroupId !== pendingCorrection.id ||
          entry.operation === "REVERSAL" ||
          entry.sequence !== pendingCorrection.reversalSequence + 1)
      )
        throw new Error("correction pair");
      const party = tx.getParty(entry.partyId);
      if (!party) throw new Error("missing party");
      validateEntry(entry, party);
      validateUtc(entry.occurredAtUtc);
      validateUtc(entry.recordedAtUtc);
      const receipt = tx.getReceipt(entry.commandId);
      const result = receipt?.result;
      const expectedKind = entry.correctionGroupId
        ? "correct"
        : entry.operation === "REVERSAL"
          ? "reverse"
          : entry.operation.startsWith("OPENING_")
            ? "setOpeningPosition"
            : "post";
      if (
        !receipt ||
        receipt.schemaVersion !== 1 ||
        receipt.commandId !== entry.commandId ||
        receipt.kind !== expectedKind ||
        receipt.canonicalPayloadHash !==
          `v2:${sha256(receipt.canonicalPayload)}` ||
        !result ||
        typeof result !== "object" ||
        !("entryIds" in result) ||
        !Array.isArray(result.entryIds) ||
        !result.entryIds.includes(entry.id)
      )
        throw new Error("receipt");
      const payload: unknown = JSON.parse(receipt.canonicalPayload);
      if (
        !Array.isArray(payload) ||
        payload.length !== 3 ||
        payload[0] !== 1 ||
        payload[1] !== expectedKind ||
        typeof payload[2] !== "string"
      )
        throw new Error("receipt payload");
      const command: unknown = JSON.parse(payload[2]);
      if (
        !command ||
        typeof command !== "object" ||
        (command as { commandId?: unknown }).commandId !== entry.commandId
      )
        throw new Error("receipt command");
      checkedReceiptResult(expectedKind, result);
      if (result.entryIds.length !== (expectedKind === "correct" ? 2 : 1))
        throw new Error("receipt entries");
      const line = entry.lines.find(
        (item) => item.accountKind === "PARTY_POSITION",
      )!;
      if (entry.operation === "REVERSAL") {
        const target = entry.reversesEntryId
          ? tx.getEntry(entry.reversesEntryId)
          : undefined;
        if (
          !target ||
          target.operation === "REVERSAL" ||
          tx.getReversal(target.id)?.id !== entry.id ||
          target.partyId !== entry.partyId ||
          target.lines[0].amountMinor !== line.amountMinor ||
          target.lines[0].side === line.side ||
          target.sequence >= entry.sequence
        )
          throw new Error("reversal");
      } else if (entry.reversesEntryId)
        throw new Error("unexpected reversal reference");
      const current = positions.get(entry.partyId) ?? {
        amountMinor: 0,
        revision: 0,
      };
      positions.set(entry.partyId, {
        amountMinor: checkedAdd(
          current.amountMinor,
          line.side === "DEBIT" ? line.amountMinor : -line.amountMinor,
        ),
        revision: current.revision + 1,
      });
      if (entry.correctionGroupId) {
        if (entry.commandId !== entry.correctionGroupId)
          throw new Error("correction command");
        if (entry.operation === "REVERSAL" && !pendingCorrection)
          pendingCorrection = {
            id: entry.correctionGroupId,
            reversalSequence: entry.sequence,
          };
        else if (pendingCorrection?.id === entry.correctionGroupId)
          pendingCorrection = undefined;
        else throw new Error("correction pair");
      } else if (pendingCorrection) throw new Error("correction pair");
    } catch {
      issues.push(`entry:${entry.id}`);
    }
  }
  if (pendingCorrection) issues.push(`correction:${pendingCorrection.id}`);
  const kinds: readonly string[] = [
    "createParty",
    "editParty",
    "archiveParty",
    "reactivateParty",
    "deleteUnpostedParty",
    "post",
    "setOpeningPosition",
    "reverse",
    "correct",
  ];
  for (const receipt of tx.auditReceipts()) {
    try {
      if (
        receipt.schemaVersion !== 1 ||
        !kinds.includes(receipt.kind) ||
        receipt.canonicalPayloadHash !==
          `v2:${sha256(receipt.canonicalPayload)}`
      )
        throw new Error("receipt header");
      const payload: unknown = JSON.parse(receipt.canonicalPayload);
      if (
        !Array.isArray(payload) ||
        payload.length !== 3 ||
        payload[0] !== 1 ||
        payload[1] !== receipt.kind ||
        typeof payload[2] !== "string"
      )
        throw new Error("receipt payload");
      const command: unknown = JSON.parse(payload[2]);
      if (
        !command ||
        typeof command !== "object" ||
        (command as { commandId?: unknown }).commandId !== receipt.commandId
      )
        throw new Error("receipt command");
      checkedReceiptResult(receipt.kind as CommandKind, receipt.result);
      if (
        receipt.kind === "post" ||
        receipt.kind === "reverse" ||
        receipt.kind === "correct" ||
        receipt.kind === "setOpeningPosition"
      ) {
        const result = receipt.result as {
          entryIds: string[];
          lastSequence: number;
        };
        if (
          result.entryIds.length !==
            (receipt.kind === "correct"
              ? 2
              : receipt.kind === "setOpeningPosition"
                ? result.entryIds.length
                : 1) ||
          (receipt.kind === "setOpeningPosition" && result.entryIds.length > 1)
        )
          throw new Error("receipt count");
        for (const id of result.entryIds) {
          const entry = tx.getEntry(id);
          if (
            !entry ||
            entry.commandId !== receipt.commandId ||
            entry.sequence > result.lastSequence
          )
            throw new Error("receipt entry");
        }
      }
    } catch {
      issues.push(`receipt:${receipt.commandId}`);
    }
  }
  const parties = tx.listParties();
  for (const party of parties) {
    const derived = positions.get(party.id) ?? { amountMinor: 0, revision: 0 };
    const projected = tx.getPosition(party.id);
    if (
      party.ledgerRevision !== derived.revision ||
      projected.revision !== derived.revision ||
      projected.amountMinor !== derived.amountMinor
    )
      issues.push(`party:${party.id}`);
  }
  if (tx.lastSequence() < last) issues.push("sequence:high-water");
  return {
    schemaVersion: 1,
    valid: issues.length === 0,
    entriesChecked,
    partiesChecked: parties.length,
    issues,
  };
}
