# ADR 0005: Runtime validation, digests, and indexed storage

Accepted for the unpublished 0.x API.

All public commands are checked at runtime before a receipt payload is formed. Unknown fields, malformed UUIDs and dates, unsafe amounts, unsupported operations, and malformed confirmations are rejected. Equivalent UUID case, UTC timestamp precision, and display-name whitespace are normalized. `INVALID_COMMAND` identifies structural input errors; domain-specific error codes remain for validly shaped commands that violate business rules. Confirmation fields are excluded from the idempotency meaning, while the complete canonical command payload is stored and compared on retry.

Receipt checksums and preview fingerprints use a `v2:` SHA-256 digest. The implementation is local, synchronous, and platform-neutral because registry access blocked adding the proposed runtime dependency. It is checked against Node's SHA-256 implementation in tests. The digest is an index and opaque state acknowledgment, never proof of receipt equality or user authorization.

The storage port exposes indexed receipt, entry, reversal, position, history, sequence, and paginated party-search operations. Writers serialize and atomically update entries, lineage, receipts, revisions, and position projections. `auditEntries` and `auditReceipts` are lazy, audit-only traversals. The journal lines remain authoritative. Initialization and explicit verification audit all records; ordinary commands validate affected records and projection revisions. An audit or integrity failure must persist read-only recovery before further financial writes.

The in-memory adapter verifies command behavior and rollback. The SQLCipher adapter must supply durable snapshots, indexes, uniqueness and foreign keys, immutable rows, recovery persistence, SQLite integrity checks, and measured query plans. Those adapter guarantees are pending.
