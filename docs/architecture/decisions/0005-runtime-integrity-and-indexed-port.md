# ADR 0005: Runtime validation, digests, and indexed storage

Accepted for the unpublished 0.x API.

All public commands are checked at runtime before a receipt payload is formed. Unknown fields, malformed UUIDs and dates, unsafe amounts, unsupported operations, and malformed confirmations are rejected. Equivalent UUID case, UTC timestamp precision, and display-name whitespace are normalized. `INVALID_COMMAND` identifies structural input errors; domain-specific error codes remain for validly shaped commands that violate business rules. Confirmation fields are excluded from the idempotency meaning, while the complete canonical command payload is stored and compared on retry.

Receipt checksums and preview fingerprints use a `v2:` SHA-256 digest. The implementation is local, synchronous, and platform-neutral because registry access blocked adding the proposed runtime dependency. It is checked against Node's SHA-256 implementation in tests. The digest is an index and opaque state acknowledgment, never proof of receipt equality or user authorization.

Digest input is capped at 32 KiB of UTF-8 before the full byte array is allocated. Oversized new commands return `INVALID_COMMAND`; an oversized persisted receipt is an integrity failure that enters recovery. The cap keeps synchronous CPU and memory work bounded. Tests cover published vectors, padding boundaries, UTF-8, seeded random inputs, malformed Unicode, and the byte limit.

The storage port exposes indexed receipt, entry, reversal, position, history, sequence, and paginated party-search operations. Writers serialize and atomically update entries, lineage, receipts, revisions, and position projections. `auditEntries` and `auditReceipts` are lazy, audit-only traversals. The journal lines remain authoritative. Initialization and explicit verification audit all records; ordinary commands validate affected records and projection revisions. An audit or integrity failure must persist read-only recovery before further financial writes.

The in-memory adapter verifies command behavior and rollback. The SQLCipher adapter must supply durable snapshots, indexes, uniqueness and foreign keys, immutable rows, recovery persistence, SQLite integrity checks, and measured query plans. Those adapter guarantees are pending.

The in-memory test adapter uses persistent ordered indexes for party IDs and per-party history. Backdated posting no longer shifts a full history array, and first-page party search no longer sorts all IDs. Index updates remain expected logarithmic work; full audit remains linear in stored records, and substring search can scan many parties. Receipt hashing and parsing occur once per receipt during full audit, while the journal pass checks its linkage.

The command facade validates and canonicalizes command meaning once before entering the writer. It still recomputes the position-dependent preview and confirmation against transaction state. This removes repeated bounded input work without weakening preview freshness.

The position projection is the only financial cache in the core. No separate in-process balance cache or aggregate totals projection is added. A 10,000-party host benchmark showed that materializing all party records for totals was slow, so `getTotals()` now aggregates existing position rows through the storage port. The native adapter should measure this query before tuning SQLite's page cache or introducing another transactional projection. The adapter starts with WAL and `synchronous=FULL` to meet the power-loss durability requirement; device tests must verify the actual setting and behavior.
