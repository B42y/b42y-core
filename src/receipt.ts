import { CoreError } from "./types.js";
import type { CommandKind } from "./validation.js";
import type { Party, PostResult } from "./types.js";

export function checkedReceiptResult(
  kind: CommandKind,
  result: unknown,
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
  return result as PostResult;
}
