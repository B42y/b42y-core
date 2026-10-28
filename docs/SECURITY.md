# Security boundary

The core validates financial invariants and audit lineage but does not encrypt storage or authenticate users. The mobile adapter must use SQLCipher, reject plaintext fallback and unsupported schema, enforce constraints and immutable triggers, and persist read-only recovery after integrity failure. A preview fingerprint binds state only; it is not an authorization token. See [integration](INTEGRATION.md).
