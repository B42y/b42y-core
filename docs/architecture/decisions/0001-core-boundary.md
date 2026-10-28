# ADR 0001: Pure core and durable adapter boundary

Accepted. `@b42y/core` is a separate, framework-free TypeScript library. The mobile app owns SQLCipher and key storage. The core requires a serialized durable transaction port and a persistent read-only recovery state. The test fake cannot serve as production storage. This preserves the contract while allowing Node tests and mobile consumption.
