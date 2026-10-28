import { displayName, validateUtc, validateUuid } from "./domain.js";
import { positiveAmount, signedAmount } from "./money.js";
import { CoreError } from "./types.js";

export type CommandKind =
  | "createParty" | "editParty" | "archiveParty" | "reactivateParty" | "deleteUnpostedParty"
  | "post" | "setOpeningPosition" | "reverse" | "correct";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CoreError("INVALID_COMMAND");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new CoreError("INVALID_COMMAND");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new CoreError("INVALID_COMMAND");
}

function uuid(value: unknown, error: "INVALID_PARTY" | "INVALID_COMMAND"): string {
  try { return validateUuid(value); } catch { throw new CoreError(error); }
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit) throw new CoreError("INVALID_COMMAND");
  return value;
}

function optionalText(value: unknown, limit: number): string | undefined {
  return value === undefined ? undefined : text(value, limit);
}

function confirmation(value: unknown): { previewFingerprint: string; expectedPartyRevision: number } {
  const input = record(value);
  keys(input, ["previewFingerprint", "expectedPartyRevision"]);
  const fingerprint = text(input.previewFingerprint, 128);
  if (!/^v2:[0-9a-f]{64}$/u.test(fingerprint) || !Number.isSafeInteger(input.expectedPartyRevision) || (input.expectedPartyRevision as number) < 0) throw new CoreError("INVALID_COMMAND");
  return { previewFingerprint: fingerprint, expectedPartyRevision: input.expectedPartyRevision as number };
}

function optionalConfirmation(value: unknown): object {
  return value === undefined ? {} : { confirmation: confirmation(value) };
}

function operation(value: unknown, opening = false): string {
  const allowed = opening
    ? ["ADD_RECEIVABLE", "ADD_PAYABLE", "RECEIVE", "PAY", "OPENING_RECEIVABLE", "OPENING_PAYABLE"]
    : ["ADD_RECEIVABLE", "ADD_PAYABLE", "RECEIVE", "PAY"];
  if (!allowed.includes(value as string)) throw new CoreError("INVALID_COMMAND");
  return value as string;
}

export function validatedCommand(kind: CommandKind, value: unknown): Record<string, unknown> {
  const input = record(value);
  const commandId = uuid(input.commandId, "INVALID_COMMAND");
  const base = { commandId };
  switch (kind) {
    case "createParty": {
      keys(input, ["commandId", "displayName", "phone", "note"]);
      const name = displayName(input.displayName);
      if (name.length > 200) throw new CoreError("INVALID_NAME");
      const phone = optionalText(input.phone, 64);
      const note = optionalText(input.note, 2048);
      return { ...base, displayName: name, ...(phone === undefined ? {} : { phone }), ...(note === undefined ? {} : { note }) };
    }
    case "editParty": {
      keys(input, ["commandId", "partyId", "displayName", "phone", "note"]);
      const name = input.displayName === undefined ? undefined : displayName(input.displayName);
      if (name && name.length > 200) throw new CoreError("INVALID_NAME");
      const phone = input.phone === null ? null : optionalText(input.phone, 64);
      const note = input.note === null ? null : optionalText(input.note, 2048);
      return { ...base, partyId: uuid(input.partyId, "INVALID_PARTY"), ...(name === undefined ? {} : { displayName: name }), ...(phone === undefined ? {} : { phone }), ...(note === undefined ? {} : { note }) };
    }
    case "archiveParty":
    case "reactivateParty": {
      keys(input, ["commandId", "partyId"]);
      return { ...base, partyId: uuid(input.partyId, "INVALID_PARTY") };
    }
    case "deleteUnpostedParty": {
      keys(input, ["commandId", "partyId", "confirmationToken"]);
      return { ...base, partyId: uuid(input.partyId, "INVALID_PARTY"), confirmationToken: text(input.confirmationToken, 512) };
    }
    case "post": {
      keys(input, ["commandId", "partyId", "operation", "amountMinor", "occurredAtUtc", "note", "confirmation"]);
      const note = optionalText(input.note, 2048);
      return { ...base, partyId: uuid(input.partyId, "INVALID_PARTY"), operation: operation(input.operation), amountMinor: positiveAmount(input.amountMinor), occurredAtUtc: validateUtc(input.occurredAtUtc), ...(note === undefined ? {} : { note }), ...optionalConfirmation(input.confirmation) };
    }
    case "setOpeningPosition": {
      keys(input, ["commandId", "partyId", "targetPositionMinor", "occurredAtUtc", "note"]);
      const note = optionalText(input.note, 2048);
      return { ...base, partyId: uuid(input.partyId, "INVALID_PARTY"), targetPositionMinor: signedAmount(input.targetPositionMinor), occurredAtUtc: validateUtc(input.occurredAtUtc), ...(note === undefined ? {} : { note }) };
    }
    case "reverse": {
      keys(input, ["commandId", "originalEntryId", "reason", "confirmation"]);
      const reason = optionalText(input.reason, 2048);
      return { ...base, originalEntryId: uuid(input.originalEntryId, "INVALID_COMMAND"), ...(reason === undefined ? {} : { reason }), ...optionalConfirmation(input.confirmation) };
    }
    case "correct": {
      keys(input, ["commandId", "originalEntryId", "replacement", "reason", "confirmations"]);
      const replacement = record(input.replacement);
      keys(replacement, ["partyId", "operation", "amountMinor", "occurredAtUtc", "note"]);
      const note = optionalText(replacement.note, 2048);
      const reason = optionalText(input.reason, 2048);
      let confirmations: readonly object[] | undefined;
      if (input.confirmations !== undefined) {
        if (!Array.isArray(input.confirmations) || input.confirmations.length > 2) throw new CoreError("INVALID_COMMAND");
        confirmations = input.confirmations.map((item: unknown) => {
          const row = record(item);
          keys(row, ["partyId", "expectedPartyRevision", "previewFingerprint"]);
          return { partyId: uuid(row.partyId, "INVALID_PARTY"), ...confirmation({ expectedPartyRevision: row.expectedPartyRevision, previewFingerprint: row.previewFingerprint }) };
        });
      }
      return { ...base, originalEntryId: uuid(input.originalEntryId, "INVALID_COMMAND"), replacement: { partyId: uuid(replacement.partyId, "INVALID_PARTY"), operation: operation(replacement.operation, true), amountMinor: positiveAmount(replacement.amountMinor), occurredAtUtc: validateUtc(replacement.occurredAtUtc), ...(note === undefined ? {} : { note }) }, ...(reason === undefined ? {} : { reason }), ...(confirmations === undefined ? {} : { confirmations }) };
    }
  }
}
