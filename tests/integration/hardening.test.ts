import { describe, expect, it } from "vitest";
import { createCoreService } from "../../src/core.js";
import { fixtures, MemoryStore } from "../fixtures/memory-store.js";

const date = "2026-01-01T00:00:00.000Z";
function setup() {
  const store = new MemoryStore();
  const fixture = fixtures();
  return { store, fixture, core: createCoreService({ store, ...fixture }) };
}

describe("hardening regressions", () => {
  it("rejects unknown command fields and malformed confirmations before writing", async () => {
    const { core, store, fixture } = setup();
    await expect(
      core.createParty({
        commandId: fixture.ids.newId(),
        displayName: "A",
        hidden: true,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    const p = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "A",
    });
    await expect(
      core.post({
        commandId: fixture.ids.newId(),
        partyId: p.id,
        operation: "RECEIVE",
        amountMinor: 1,
        occurredAtUtc: date,
        confirmation: { previewFingerprint: "x", expectedPartyRevision: 0 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    expect(store.snapshot().entries).toHaveLength(0);
  });
  it("requires confirmation for a correction replacing zero with RECEIVE", async () => {
    const { core, store, fixture } = setup();
    const a = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "A",
    });
    const b = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "B",
    });
    const original = await core.post({
      commandId: fixture.ids.newId(),
      partyId: a.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 100,
      occurredAtUtc: date,
    });
    const correction = {
      commandId: fixture.ids.newId(),
      originalEntryId: original.entryIds[0]!,
      replacement: {
        partyId: b.id,
        operation: "RECEIVE" as const,
        amountMinor: 50,
        occurredAtUtc: date,
      },
    };
    const plans = await core.previewCorrection(correction);
    expect(plans.find((plan) => plan.partyId === b.id)?.warning).toBe(
      "ZERO_SETTLEMENT",
    );
    await expect(core.correct(correction)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    expect(store.snapshot().entries).toHaveLength(1);
  });
  it("normal writes use no audit scan and tolerate sequence gaps", async () => {
    const { core, store, fixture } = setup();
    const p = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "A",
    });
    expect(store.scans).toBe(1);
    store.createSequenceGap();
    await core.post({
      commandId: fixture.ids.newId(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 100,
      occurredAtUtc: date,
    });
    expect(store.scans).toBe(1);
    expect((await core.verifyLedger()).valid).toBe(true);
  });
  it("fails closed for corrupted receipts and recovery persistence failure", async () => {
    const { core, store, fixture } = setup();
    const p = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "A",
    });
    const command = {
      commandId: fixture.ids.newId(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE" as const,
      amountMinor: 100,
      occurredAtUtc: date,
    };
    await core.post(command);
    store.corruptReceipt(command.commandId, (receipt) => ({
      ...receipt,
      kind: "reverse",
    }));
    await expect(core.post(command)).rejects.toMatchObject({
      code: "LEDGER_INTEGRITY_FAILURE",
    });
    expect(store.snapshot().readOnly).toBe(true);
    const second = setup();
    const p2 = await second.core.createParty({
      commandId: second.fixture.ids.newId(),
      displayName: "B",
    });
    const post = {
      commandId: second.fixture.ids.newId(),
      partyId: p2.id,
      operation: "ADD_RECEIVABLE" as const,
      amountMinor: 100,
      occurredAtUtc: date,
    };
    await second.core.post(post);
    second.store.corruptReceipt(post.commandId, (receipt) => ({
      ...receipt,
      canonicalPayloadHash: "bad",
    }));
    second.store.failRecovery = true;
    await expect(second.core.post(post)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it.each(["append", "receipt", "commit"] as const)(
    "rolls back every correction record on %s failure",
    async (stage) => {
      const { core, store, fixture } = setup();
      const a = await core.createParty({
        commandId: fixture.ids.newId(),
        displayName: "A",
      });
      const b = await core.createParty({
        commandId: fixture.ids.newId(),
        displayName: "B",
      });
      const first = await core.post({
        commandId: fixture.ids.newId(),
        partyId: a.id,
        operation: "ADD_RECEIVABLE",
        amountMinor: 100,
        occurredAtUtc: date,
      });
      const before = store.snapshot();
      store.failAt = stage;
      await expect(
        core.correct({
          commandId: fixture.ids.newId(),
          originalEntryId: first.entryIds[0]!,
          replacement: {
            partyId: b.id,
            operation: "ADD_RECEIVABLE",
            amountMinor: 50,
            occurredAtUtc: date,
          },
        }),
      ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
      expect(store.snapshot()).toEqual(before);
      store.failAt = undefined;
      expect((await core.verifyLedger()).valid).toBe(true);
    },
  );
  it("detects a corrupted receipt during explicit full audit", async () => {
    const { core, store, fixture } = setup();
    const p = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "A",
    });
    const commandId = fixture.ids.newId();
    await core.setOpeningPosition({
      commandId,
      partyId: p.id,
      targetPositionMinor: 0,
      occurredAtUtc: date,
    });
    store.corruptReceipt(commandId, (receipt) => ({
      ...receipt,
      kind: "post",
    }));
    const report = await core.verifyLedger();
    expect(report.valid).toBe(false);
    expect(report.issues).toContain(`receipt:${commandId}`);
    expect(store.snapshot().readOnly).toBe(true);
  });
  it("keeps a history cursor on its original sequence snapshot", async () => {
    const { core, fixture } = setup();
    const p = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "A",
    });
    for (let i = 0; i < 3; i++)
      await core.post({
        commandId: fixture.ids.newId(),
        partyId: p.id,
        operation: "ADD_RECEIVABLE",
        amountMinor: i + 1,
        occurredAtUtc: date,
      });
    const first = await core.getPartyHistory(p.id, { limit: 1 });
    await core.post({
      commandId: fixture.ids.newId(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 4,
      occurredAtUtc: date,
    });
    const remaining = await core.getPartyHistory(p.id, {
      cursor: first.nextCursor!,
      limit: 10,
    });
    expect(
      [...first.items, ...remaining.items].map((entry) => entry.sequence),
    ).toEqual([3, 2, 1]);
    expect(
      (await core.getPartyHistory(p.id, { limit: 10 })).items,
    ).toHaveLength(4);
  });
  it("orders backdated entries by occurrence then sequence", async () => {
    const { core, fixture } = setup();
    const p = await core.createParty({
      commandId: fixture.ids.newId(),
      displayName: "A",
    });
    const dates = [
      "2026-01-03T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    ];
    for (const occurredAtUtc of dates)
      await core.post({
        commandId: fixture.ids.newId(),
        partyId: p.id,
        operation: "ADD_RECEIVABLE",
        amountMinor: 1,
        occurredAtUtc,
      });
    const first = await core.getPartyHistory(p.id, { limit: 2 });
    const second = await core.getPartyHistory(p.id, {
      cursor: first.nextCursor!,
      limit: 2,
    });
    expect(
      [...first.items, ...second.items].map((entry) => entry.sequence),
    ).toEqual([3, 1, 4, 2]);
  });
});
