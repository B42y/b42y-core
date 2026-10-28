import { CoreError } from "./types.js";
import { validateEntry } from "./domain.js";
import type { LedgerReader } from "./ports.js";
import type { CommandKind } from "./validation.js";
import type { Party, PostResult } from "./types.js";

export function checkedReceiptResult(
  kind: CommandKind,
  result: unknown,
  reader?: LedgerReader,
  commandId?: string,
): unknown {
  if (
    kind === "archiveParty" ||
    kind === "reactivateParty" ||
    kind === "deleteUnpostedParty"
  ) {
    if (result !== undefined) throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    return result;
  }
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new CoreError("LEDGER_INTEGRITY_FAILURE");
  const data = result as Record<string, unknown>;
  if (kind === "createParty" || kind === "editParty") {
    if (
      data.schemaVersion !== 1 ||
      typeof data.id !== "string" ||
      typeof data.displayName !== "string" ||
      !Number.isSafeInteger(data.ledgerRevision)
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    return result as Party;
  }
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.entryIds) ||
    data.entryIds.some((id: unknown) => typeof id !== "string") ||
    typeof data.partyId !== "string" ||
    !Number.isSafeInteger(data.resultingPositionMinor) ||
    !Number.isSafeInteger(data.lastSequence)
  )
    throw new CoreError("LEDGER_INTEGRITY_FAILURE");
  if (reader && commandId) {
    const result = data as unknown as PostResult;
    const ids = result.entryIds;
    if (
      ids.length !==
        (kind === "correct"
          ? 2
          : kind === "setOpeningPosition"
            ? ids.length
            : 1) ||
      (kind === "setOpeningPosition" && ids.length > 1) ||
      result.lastSequence < 0 ||
      result.lastSequence > reader.lastSequence()
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    const entries = ids.map((id) => reader.getEntry(id));
    if (
      entries.some(
        (entry, index) =>
          !entry ||
          entry.commandId !== commandId ||
          (index > 0 && entry.sequence <= entries[index - 1]!.sequence),
      )
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    for (const entry of entries) {
      const party = entry && reader.getParty(entry.partyId);
      if (
        !entry ||
        !party ||
        entry.schemaVersion !== 1 ||
        entry.postingVersion !== 1
      )
        throw new CoreError("LEDGER_INTEGRITY_FAILURE");
      try {
        validateEntry(entry, party);
      } catch {
        throw new CoreError("LEDGER_INTEGRITY_FAILURE");
      }
    }
    const first = entries[0];
    const last = entries.at(-1);
    if (
      last &&
      (last.sequence !== result.lastSequence || last.partyId !== result.partyId)
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    if (
      kind === "post" &&
      (first?.operation === "REVERSAL" ||
        first?.operation.startsWith("OPENING_") ||
        first?.correctionGroupId)
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    if (
      kind === "reverse" &&
      (first?.operation !== "REVERSAL" ||
        first.correctionGroupId ||
        !first.reversesEntryId ||
        reader.getReversal(first.reversesEntryId)?.id !== first.id)
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    if (
      kind === "correct" &&
      (first?.operation !== "REVERSAL" ||
        first.correctionGroupId !== commandId ||
        !first.reversesEntryId ||
        reader.getReversal(first.reversesEntryId)?.id !== first.id ||
        last?.operation === "REVERSAL" ||
        last?.correctionGroupId !== commandId ||
        last.sequence !== first.sequence + 1)
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    if (
      kind === "setOpeningPosition" &&
      first &&
      !first.operation.startsWith("OPENING_")
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    if (
      kind === "setOpeningPosition" &&
      !first &&
      result.resultingPositionMinor !== 0
    )
      throw new CoreError("LEDGER_INTEGRITY_FAILURE");
  }
  return result as PostResult;
}
