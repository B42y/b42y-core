import { beforeAll, bench, expect } from "vitest";
import { createCoreService } from "../../src/core.js";
import { MemoryStore, fixtures } from "../fixtures/memory-store.js";

const store = new MemoryStore();
const fixture = fixtures();
const core = createCoreService({ store, ...fixture });
let skewed = "";
let other = "";

beforeAll(async () => {
  const first = await core.createParty({
    commandId: fixture.ids.newId(),
    displayName: "Skewed",
  });
  const second = await core.createParty({
    commandId: fixture.ids.newId(),
    displayName: "Other",
  });
  skewed = first.id;
  other = second.id;
  for (let i = 0; i < 100_000; i++) {
    await core.post({
      commandId: fixture.ids.newId(),
      partyId: i % 20 ? skewed : other,
      operation: "ADD_RECEIVABLE",
      amountMinor: 1,
      occurredAtUtc: fixture.clock.nowUtc(),
    });
  }
  expect(store.snapshot().entries).toHaveLength(100_000);
  expect(store.scans).toBe(1);
}, 180_000);

bench("indexed position and totals at 100k entries", async () => {
  const before = store.scans;
  expect(await core.getPartyPosition(skewed)).toBe(95_000);
  expect(await core.getTotals()).toEqual({
    receivableMinor: 100_000,
    payableMinor: 0,
  });
  expect(store.scans).toBe(before);
});

bench("indexed posting at 100k entries", async () => {
  const before = store.scans;
  await core.post({
    commandId: fixture.ids.newId(),
    partyId: other,
    operation: "ADD_RECEIVABLE",
    amountMinor: 1,
    occurredAtUtc: fixture.clock.nowUtc(),
  });
  expect(store.scans).toBe(before);
});
