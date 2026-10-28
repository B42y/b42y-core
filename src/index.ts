export { createCoreService } from "./core.js";
export type { CoreService } from "./core.js";
export { CoreError } from "./types.js";
export {
  parseEgp,
  positiveAmount,
  signedAmount,
  checkedAdd,
  MAX_INPUT_MINOR,
} from "./money.js";
export { normalizeName, validateEntry } from "./domain.js";
export type {
  LedgerStore,
  LedgerReader,
  LedgerTransaction,
  Clock,
  IdGenerator,
  CommandReceipt,
} from "./ports.js";
export type {
  Party,
  JournalEntry,
  JournalLine,
  CoreErrorCode,
  PostCommand,
  OpeningCommand,
  ReverseCommand,
  CorrectionCommand,
  PostResult,
  PreviewResult,
  PartyQuery,
  PartyPage,
  HistoryPage,
  LedgerIntegrityReport,
  Confirmation,
  FinancialOperation,
  PostOperation,
} from "./types.js";
