# ADR 0002: Integer money and immutable position journal

Accepted. Public money uses runtime-validated safe integer piasters. Parsing uses exact `bigint` intermediate arithmetic, and all balances use checked addition. Each event creates one two-line EGP position entry, except a zero opening. Account ownership and reversible lineage are validated before commit. Position is derived from immutable lines, never from a mutable balance field.
