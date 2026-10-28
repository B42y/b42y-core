# Ba2y Core

`@b42y/core` is a pure TypeScript EGP position ledger for Ba2y (باقي). It records parties, debts, repayments, opening positions, reversals and corrections through an injected durable store. It does not include UI, payment processing, cloud sync, or a database driver.

The [Core Contract](CORE_CONTRACT.md) defines the financial behavior. The library is under active pre-1.0 development; the mobile SQLCipher adapter and its native tests are pending.

```ts
import { createCoreService } from "@b42y/core";

const core = createCoreService({ store, clock, ids });
const party = await core.createParty({
  commandId: ids.newId(),
  displayName: "Ahmed",
});
await core.post({
  commandId: ids.newId(),
  partyId: party.id,
  operation: "ADD_RECEIVABLE",
  amountMinor: 100_000,
  occurredAtUtc: clock.nowUtc(),
});
console.log(await core.getPartyPosition(party.id)); // 100000 piasters
```

`store` must implement the [transaction port](docs/INTEGRATION.md); the in-memory adapter is tests-only. Install with `npm install @b42y/core@next` after its first verified publication.

Development: `npm ci`, `npm run check`, `npm pack --dry-run`. See [API](docs/API.md), [mobile integration](docs/INTEGRATION.md), [traceability](docs/CONTRACT_TRACEABILITY.md), and [release process](docs/RELEASE.md).
