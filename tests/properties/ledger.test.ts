import { expect, it } from "vitest";
import fc from "fast-check";
import { createCoreService } from "../../src/core.js";
import { fixtures, MemoryStore } from "../fixtures/memory-store.js";

const occurredAtUtc = "2026-01-01T00:00:00.000Z";

it("LEDGER-018 randomized event sequences match independent bigint oracle", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          amount: fc.integer({ min: 1, max: 100000 }),
          kind: fc.constantFrom(
            "ADD_RECEIVABLE",
            "ADD_PAYABLE",
            "RECEIVE",
            "PAY",
          ),
        }),
        { minLength: 1, maxLength: 80 },
      ),
      async (events) => {
        const store = new MemoryStore();
        const fixture = fixtures();
        const core = createCoreService({ store, ...fixture });
        const p = await core.createParty({
          commandId: fixture.ids.newId(),
          displayName: "A",
        });
        let oracle = 0n;
        for (const event of events) {
          const command = {
            commandId: fixture.ids.newId(),
            partyId: p.id,
            operation: event.kind,
            amountMinor: event.amount,
            occurredAtUtc,
          };
          const plan = await core.previewPost(command);
          await core.post({
            ...command,
            confirmation: {
              previewFingerprint: plan.previewFingerprint,
              expectedPartyRevision: plan.partyRevision,
            },
          });
          oracle +=
            BigInt(event.amount) *
            (event.kind === "ADD_RECEIVABLE" || event.kind === "PAY"
              ? 1n
              : -1n);
          expect(BigInt(await core.getPartyPosition(p.id))).toBe(oracle);
        }
        expect((await core.verifyLedger()).valid).toBe(true);
      },
    ),
    { numRuns: 30 },
  );
});

it("random reversals, corrections and retries preserve the independent oracle", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          kind: fc.constantFrom("post", "reverse", "correct", "retry"),
          amount: fc.integer({ min: 1, max: 10000 }),
          direction: fc.boolean(),
        }),
        { minLength: 1, maxLength: 50 },
      ),
      async (actions) => {
        const store = new MemoryStore();
        const fixture = fixtures();
        const core = createCoreService({ store, ...fixture });
        const p = await core.createParty({
          commandId: fixture.ids.newId(),
          displayName: "A",
        });
        const active: { id: string; delta: bigint }[] = [];
        let oracle = 0n;
        let lastPost:
          | {
              commandId: string;
              partyId: string;
              operation: "ADD_RECEIVABLE" | "ADD_PAYABLE";
              amountMinor: number;
              occurredAtUtc: string;
            }
          | undefined;
        for (const action of actions) {
          if (action.kind === "retry" && lastPost) {
            await core.post(lastPost);
          } else if (action.kind === "reverse" && active.length) {
            const old = active.pop()!;
            const command = {
              commandId: fixture.ids.newId(),
              originalEntryId: old.id,
            };
            const plan = await core.previewReverse(command);
            await core.reverse({
              ...command,
              confirmation: {
                previewFingerprint: plan.previewFingerprint,
                expectedPartyRevision: plan.partyRevision,
              },
            });
            oracle -= old.delta;
          } else if (action.kind === "correct" && active.length) {
            const old = active.pop()!;
            const operation = action.direction
              ? ("ADD_RECEIVABLE" as const)
              : ("ADD_PAYABLE" as const);
            const command = {
              commandId: fixture.ids.newId(),
              originalEntryId: old.id,
              replacement: {
                partyId: p.id,
                operation,
                amountMinor: action.amount,
                occurredAtUtc,
              },
            };
            const plans = await core.previewCorrection(command);
            const result = await core.correct({
              ...command,
              confirmations: plans.map((plan) => ({
                partyId: plan.partyId,
                previewFingerprint: plan.previewFingerprint,
                expectedPartyRevision: plan.partyRevision,
              })),
            });
            const delta = BigInt(action.amount) * (action.direction ? 1n : -1n);
            oracle += delta - old.delta;
            active.push({ id: result.entryIds[1]!, delta });
          } else {
            const operation = action.direction
              ? ("ADD_RECEIVABLE" as const)
              : ("ADD_PAYABLE" as const);
            const command = {
              commandId: fixture.ids.newId(),
              partyId: p.id,
              operation,
              amountMinor: action.amount,
              occurredAtUtc,
            };
            const plan = await core.previewPost(command);
            const result = await core.post({
              ...command,
              confirmation: {
                previewFingerprint: plan.previewFingerprint,
                expectedPartyRevision: plan.partyRevision,
              },
            });
            const delta = BigInt(action.amount) * (action.direction ? 1n : -1n);
            oracle += delta;
            active.push({ id: result.entryIds[0]!, delta });
            lastPost = command;
          }
          expect(BigInt(await core.getPartyPosition(p.id))).toBe(oracle);
        }
        expect((await core.verifyLedger()).valid).toBe(true);
      },
    ),
    { numRuns: 20 },
  );
});
