import { describe, expect, it } from "vitest";
import { createCoreService } from "../../src/core.js";
import { fixtures, MemoryStore } from "../fixtures/memory-store.js";

const date = "2026-01-01T00:00:00.000Z";
function setup() {
  const store = new MemoryStore();
  const fixture = fixtures();
  const core = createCoreService({ store, ...fixture });
  const command = () => fixture.ids.newId();
  return { store, core, command };
}

describe("contract examples", () => {
  it("LEDGER-001..005 directions, balance and confirmation", async () => {
    const { core, store, command } = setup();
    const ahmed = await core.createParty({
      commandId: command(),
      displayName: "Ahmed",
    });
    const mohamed = await core.createParty({
      commandId: command(),
      displayName: "Mohamed",
    });
    await core.post({
      commandId: command(),
      partyId: ahmed.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 100000,
      occurredAtUtc: date,
    });
    expect(await core.getPartyPosition(ahmed.id)).toBe(100000);
    await core.post({
      commandId: command(),
      partyId: ahmed.id,
      operation: "RECEIVE",
      amountMinor: 40000,
      occurredAtUtc: date,
    });
    expect(await core.getPartyPosition(ahmed.id)).toBe(60000);
    await core.post({
      commandId: command(),
      partyId: mohamed.id,
      operation: "ADD_PAYABLE",
      amountMinor: 30000,
      occurredAtUtc: date,
    });
    await core.post({
      commandId: command(),
      partyId: mohamed.id,
      operation: "PAY",
      amountMinor: 10000,
      occurredAtUtc: date,
    });
    expect(await core.getPartyPosition(mohamed.id)).toBe(-20000);
    const post = {
      commandId: command(),
      partyId: ahmed.id,
      operation: "RECEIVE" as const,
      amountMinor: 80000,
      occurredAtUtc: date,
    };
    const plan = await core.previewPost(post);
    expect(plan.warning).toBe("SIGN_FLIP");
    await expect(core.post(post)).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    await core.post({
      ...post,
      confirmation: {
        previewFingerprint: plan.previewFingerprint,
        expectedPartyRevision: plan.partyRevision,
      },
    });
    expect(await core.getPartyPosition(ahmed.id)).toBe(-20000);
    expect(
      store
        .snapshot()
        .entries.every(
          (e) =>
            e.lines.length === 2 &&
            e.lines[0].amountMinor === e.lines[1].amountMinor,
        ),
    ).toBe(true);
  });
  it("LEDGER-006,007,022,023 idempotency and lost response", async () => {
    const { core, store, command } = setup();
    const p = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    const post = {
      commandId: command(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE" as const,
      amountMinor: 100,
      occurredAtUtc: date,
    };
    const [a, b] = await Promise.all([core.post(post), core.post(post)]);
    expect(a).toEqual(b);
    await expect(
      core.post({ ...post, amountMinor: 200 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    store.loseResponse = true;
    const lost = { ...post, commandId: command() };
    await expect(core.post(lost)).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
    });
    await core.post(lost);
    expect(store.snapshot().entries).toHaveLength(2);
  });
  it("LEDGER-009..013,024 correction and rollback", async () => {
    const { core, store, command } = setup();
    const a = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    const b = await core.createParty({
      commandId: command(),
      displayName: "B",
    });
    const first = await core.post({
      commandId: command(),
      partyId: a.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 500000,
      occurredAtUtc: date,
    });
    const correction = {
      commandId: command(),
      originalEntryId: first.entryIds[0]!,
      replacement: {
        partyId: b.id,
        operation: "ADD_RECEIVABLE" as const,
        amountMinor: 50000,
        occurredAtUtc: date,
      },
    };
    store.failOnAppendNumber = 2;
    await expect(core.correct(correction)).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
    });
    expect(store.snapshot().entries).toHaveLength(1);
    store.failOnAppendNumber = undefined;
    const corrected = await core.correct(correction);
    expect(await core.getPartyPosition(a.id)).toBe(0);
    expect(await core.getPartyPosition(b.id)).toBe(50000);
    expect(store.snapshot().entries).toHaveLength(3);
    await expect(
      core.reverse({
        commandId: command(),
        originalEntryId: first.entryIds[0]!,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_REVERSED" });
    await core.correct({
      commandId: command(),
      originalEntryId: corrected.entryIds[1]!,
      replacement: {
        partyId: b.id,
        operation: "ADD_RECEIVABLE",
        amountMinor: 10000,
        occurredAtUtc: date,
      },
    });
    expect(await core.getPartyPosition(b.id)).toBe(10000);
  });
  it("LEDGER-014..017 opening, archive, duplicate identities and delete", async () => {
    const { core, command } = setup();
    const a = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    const b = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    expect(a.id).not.toBe(b.id);
    await core.setOpeningPosition({
      commandId: command(),
      partyId: a.id,
      targetPositionMinor: 0,
      occurredAtUtc: date,
    });
    await core.setOpeningPosition({
      commandId: command(),
      partyId: a.id,
      targetPositionMinor: -500,
      occurredAtUtc: date,
    });
    await expect(
      core.setOpeningPosition({
        commandId: command(),
        partyId: a.id,
        targetPositionMinor: 100,
        occurredAtUtc: date,
      }),
    ).rejects.toMatchObject({ code: "OPENING_NOT_ALLOWED" });
    await core.archiveParty({ commandId: command(), partyId: a.id });
    expect(await core.getTotals()).toEqual({
      receivableMinor: 0,
      payableMinor: 500,
    });
    await expect(
      core.post({
        commandId: command(),
        partyId: a.id,
        operation: "PAY",
        amountMinor: 1,
        occurredAtUtc: date,
      }),
    ).rejects.toMatchObject({ code: "PARTY_ARCHIVED" });
    const token = await core.previewDeleteUnpostedParty(b.id);
    await core.deleteUnpostedParty({
      commandId: command(),
      partyId: b.id,
      confirmationToken: token,
    });
  });
  it("LEDGER-021 stale preview and integrity recovery", async () => {
    const { core, store, command } = setup();
    const p = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    const post = {
      commandId: command(),
      partyId: p.id,
      operation: "RECEIVE" as const,
      amountMinor: 100,
      occurredAtUtc: date,
    };
    const preview = await core.previewPost(post);
    await core.post({
      commandId: command(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 50,
      occurredAtUtc: date,
    });
    await expect(
      core.post({
        ...post,
        confirmation: {
          previewFingerprint: preview.previewFingerprint,
          expectedPartyRevision: preview.partyRevision,
        },
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_STALE" });
    store.corruptEntry((e) => ({
      ...e,
      lines: [{ ...e.lines[0], amountMinor: 2 }, e.lines[1]],
    }));
    expect((await core.verifyLedger()).valid).toBe(false);
    await expect(
      core.post({
        commandId: command(),
        partyId: p.id,
        operation: "ADD_RECEIVABLE",
        amountMinor: 1,
        occurredAtUtc: date,
      }),
    ).rejects.toMatchObject({ code: "READ_ONLY_RECOVERY" });
  });
  it("LEDGER-027,028 opening correction and standalone reversal", async () => {
    const { core, store, command } = setup();
    const p = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    const opening = await core.setOpeningPosition({
      commandId: command(),
      partyId: p.id,
      targetPositionMinor: 500,
      occurredAtUtc: date,
    });
    const correction = {
      commandId: command(),
      originalEntryId: opening.entryIds[0]!,
      replacement: {
        partyId: p.id,
        operation: "OPENING_PAYABLE" as const,
        amountMinor: 200,
        occurredAtUtc: date,
      },
    };
    const plan = (await core.previewCorrection(correction))[0]!;
    await core.correct({
      ...correction,
      confirmations: [
        {
          partyId: p.id,
          previewFingerprint: plan.previewFingerprint,
          expectedPartyRevision: plan.partyRevision,
        },
      ],
    });
    expect(await core.getPartyPosition(p.id)).toBe(-200);
    const latest = store.snapshot().entries.at(-1)!;
    const reversal = { commandId: command(), originalEntryId: latest.id };
    const reversePlan = await core.previewReverse(reversal);
    await core.reverse({
      ...reversal,
      confirmation: {
        previewFingerprint: reversePlan.previewFingerprint,
        expectedPartyRevision: reversePlan.partyRevision,
      },
    });
    expect(await core.getPartyPosition(p.id)).toBe(0);
    expect(store.snapshot().entries).toHaveLength(4);
  });
  it("LEDGER-025 rejects balance overflow without committing", async () => {
    const { core, store, command } = setup();
    const p = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    await core.post({
      commandId: command(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 9_000_000_000_000_000,
      occurredAtUtc: date,
    });
    await expect(
      core.post({
        commandId: command(),
        partyId: p.id,
        operation: "ADD_RECEIVABLE",
        amountMinor: 1_000_000_000_000_000,
        occurredAtUtc: date,
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_OVERFLOW" });
    expect(store.snapshot().entries).toHaveLength(1);
  });
  it("history retains lineage and uses occurredAt then sequence", async () => {
    const { core, command } = setup();
    const p = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    const a = await core.post({
      commandId: command(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 100,
      occurredAtUtc: date,
    });
    const b = await core.post({
      commandId: command(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 50,
      occurredAtUtc: date,
    });
    const page = await core.getPartyHistory(p.id, { limit: 1 });
    expect(page.items[0]?.id).toBe(b.entryIds[0]);
    await core.post({
      commandId: command(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 1,
      occurredAtUtc: date,
    });
    expect(
      (await core.getPartyHistory(p.id, { cursor: page.nextCursor!, limit: 1 }))
        .items[0]?.id,
    ).toBe(a.entryIds[0]);
  });
  it("LEDGER-008,019 rejects historical mutation and invalid journal lines", async () => {
    const { core, store, command } = setup();
    const p = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    await core.post({
      commandId: command(),
      partyId: p.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 100,
      occurredAtUtc: date,
    });
    await store.write((tx) => {
      const copy = tx.getEntry(store.snapshot().entries[0]!.id)!;
      (copy.lines[0] as { amountMinor: number }).amountMinor = 999;
    });
    expect(await core.getPartyPosition(p.id)).toBe(100);
    const invalid = {
      ...store.snapshot().entries[0]!,
      id: command(),
      sequence: 2,
      lines: [
        {
          ...store.snapshot().entries[0]!.lines[0],
          entryId: command(),
          amountMinor: 99,
        },
        store.snapshot().entries[0]!.lines[1],
      ] as const,
    };
    await expect(
      store.write((tx) => tx.appendEntry(invalid)),
    ).rejects.toMatchObject({ code: "LEDGER_INTEGRITY_FAILURE" });
    expect(store.snapshot().entries).toHaveLength(1);
  });
  it("LEDGER-029 rejects a stale cross-party correction preview", async () => {
    const { core, store, command } = setup();
    const a = await core.createParty({
      commandId: command(),
      displayName: "A",
    });
    const b = await core.createParty({
      commandId: command(),
      displayName: "B",
    });
    const first = await core.post({
      commandId: command(),
      partyId: a.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 100,
      occurredAtUtc: date,
    });
    const correction = {
      commandId: command(),
      originalEntryId: first.entryIds[0]!,
      replacement: {
        partyId: b.id,
        operation: "ADD_PAYABLE" as const,
        amountMinor: 300,
        occurredAtUtc: date,
      },
    };
    const previews = await core.previewCorrection(correction);
    await core.post({
      commandId: command(),
      partyId: b.id,
      operation: "ADD_RECEIVABLE",
      amountMinor: 10,
      occurredAtUtc: date,
    });
    await expect(
      core.correct({
        ...correction,
        confirmations: previews.map((plan) => ({
          partyId: plan.partyId,
          previewFingerprint: plan.previewFingerprint,
          expectedPartyRevision: plan.partyRevision,
        })),
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_STALE" });
    expect(store.snapshot().entries).toHaveLength(2);
  });
});
