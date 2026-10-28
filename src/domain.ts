import { checkedAdd, checkedNegate, positiveAmount } from "./money.js";
import { CoreError } from "./types.js";
import { sha256 } from "./digest.js";
import type {
  FinancialOperation,
  JournalEntry,
  JournalLine,
  Party,
  PostOperation,
  PreviewResult,
} from "./types.js";

export function validateUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new CoreError("INVALID_PARTY");
  return value.toLowerCase();
}

export function validateUtc(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !==
      (value.includes(".") ? value : value.replace("Z", ".000Z"))
  )
    throw new CoreError("INVALID_DATE");
  return new Date(value).toISOString();
}

export function normalizeName(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new CoreError("INVALID_NAME");
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/[\u064b-\u065f\u0670]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function displayName(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new CoreError("INVALID_NAME");
  return value.trim().replace(/\s+/gu, " ");
}

export function effect(operation: FinancialOperation, amount: number): number {
  positiveAmount(amount);
  if (
    operation === "ADD_RECEIVABLE" ||
    operation === "PAY" ||
    operation === "OPENING_RECEIVABLE"
  )
    return amount;
  if (
    operation === "ADD_PAYABLE" ||
    operation === "RECEIVE" ||
    operation === "OPENING_PAYABLE"
  )
    return -amount;
  throw new CoreError("INVALID_AMOUNT");
}

export function position(
  entries: readonly JournalEntry[],
  partyId: string,
): number {
  let sum = 0;
  for (const entry of entries) {
    if (entry.partyId !== partyId) continue;
    const line = entry.lines.find(
      (item) => item.accountKind === "PARTY_POSITION",
    );
    if (!line) throw new CoreError("LEDGER_INTEGRITY_FAILURE");
    sum = checkedAdd(
      sum,
      line.side === "DEBIT"
        ? line.amountMinor
        : checkedNegate(line.amountMinor),
    );
  }
  return sum;
}

export function preview(
  party: Party,
  before: number,
  delta: number,
  meaning: string,
  operation?: PostOperation,
  settlementBefore = before,
): PreviewResult {
  const after = checkedAdd(before, delta);
  let warning: PreviewResult["warning"];
  if ((before > 0 && after < 0) || (before < 0 && after > 0))
    warning = "SIGN_FLIP";
  else if (
    (operation === "RECEIVE" && settlementBefore === 0) ||
    (operation === "PAY" && settlementBefore === 0)
  )
    warning = "ZERO_SETTLEMENT";
  else if (
    (operation === "RECEIVE" && settlementBefore < 0) ||
    (operation === "PAY" && settlementBefore > 0)
  )
    warning = "UNEXPECTED_SETTLEMENT";
  const previewFingerprint =
    "v2:" +
    sha256(
      JSON.stringify([
        1,
        meaning,
        party.id,
        before,
        delta,
        after,
        party.ledgerRevision,
        warning ?? null,
      ]),
    );
  return {
    schemaVersion: 1,
    partyId: party.id,
    currentPositionMinor: before,
    deltaMinor: delta,
    nextPositionMinor: after,
    partyRevision: party.ledgerRevision,
    needsConfirmation: warning !== undefined,
    ...(warning ? { warning } : {}),
    previewFingerprint,
  };
}

export function validateEntry(entry: JournalEntry, party: Party): void {
  const [a, b] = entry.lines;
  validateUuid(entry.id);
  validateUuid(entry.commandId);
  if (
    !a ||
    !b ||
    entry.lines.length !== 2 ||
    a.entryId !== entry.id ||
    b.entryId !== entry.id ||
    a.lineNo !== 1 ||
    b.lineNo !== 2 ||
    a.id === b.id ||
    a.accountKind === b.accountKind ||
    a.side === b.side ||
    a.amountMinor !== b.amountMinor ||
    a.currency !== "EGP" ||
    b.currency !== "EGP" ||
    a.accountId === b.accountId ||
    entry.partyId !== party.id
  )
    throw new CoreError("LEDGER_INTEGRITY_FAILURE");
  positiveAmount(a.amountMinor);
  validateUuid(a.id);
  validateUuid(b.id);
  const owner = entry.lines.find(
    (line) => line.accountKind === "PARTY_POSITION",
  );
  const offset = entry.lines.find(
    (line) => line.accountKind === "POSITION_OFFSET",
  );
  if (
    owner?.accountId !== `party:${party.id}` ||
    offset?.accountId !== "position:offset"
  )
    throw new CoreError("LEDGER_INTEGRITY_FAILURE");
  if (
    entry.operation !== "REVERSAL" &&
    owner.side !==
      (effect(entry.operation, a.amountMinor) > 0 ? "DEBIT" : "CREDIT")
  )
    throw new CoreError("LEDGER_INTEGRITY_FAILURE");
}

export function makeEntry(
  input: Omit<JournalEntry, "schemaVersion" | "postingVersion" | "lines"> & {
    amountMinor: number;
    deltaMinor: number;
    lineIds: readonly [string, string];
  },
): JournalEntry {
  const side = input.deltaMinor > 0 ? "DEBIT" : "CREDIT";
  const lines: [JournalLine, JournalLine] = [
    {
      id: input.lineIds[0],
      entryId: input.id,
      lineNo: 1,
      accountId: `party:${input.partyId}`,
      accountKind: "PARTY_POSITION",
      side,
      amountMinor: input.amountMinor,
      currency: "EGP",
    },
    {
      id: input.lineIds[1],
      entryId: input.id,
      lineNo: 2,
      accountId: "position:offset",
      accountKind: "POSITION_OFFSET",
      side: side === "DEBIT" ? "CREDIT" : "DEBIT",
      amountMinor: input.amountMinor,
      currency: "EGP",
    },
  ];
  const {
    amountMinor: _amount,
    deltaMinor: _delta,
    lineIds: _ids,
    ...rest
  } = input;
  void _amount;
  void _delta;
  void _ids;
  return { ...rest, schemaVersion: 1, postingVersion: 1, lines };
}
