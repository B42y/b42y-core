import { expect, it } from "vitest";
import { allIds, insert, page } from "../fixtures/history-index.js";
import type { HistoryKey, HistoryNode } from "../fixtures/history-index.js";

it("matches independently sorted, snapshotted backdated history", () => {
  let root: HistoryNode | undefined;
  const keys: HistoryKey[] = [];
  let state = 0x12345678;
  for (let sequence = 1; sequence <= 2000; sequence++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const day = ((state >>> 0) % 31) + 1;
    const key = {
      id: String(sequence),
      sequence,
      occurredAtUtc: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    };
    keys.push(key);
    root = insert(root, key);
  }
  const sorted = [...keys].sort(
    (a, b) =>
      b.occurredAtUtc.localeCompare(a.occurredAtUtc) || b.sequence - a.sequence,
  );
  expect(allIds(root)).toEqual([...sorted].reverse().map((key) => key.id));
  const highWater = 1500;
  const expected = sorted.filter((key) => key.sequence <= highWater);
  const actual: string[] = [];
  let cursor: HistoryKey | undefined;
  while (true) {
    const ids = page(root, highWater, cursor, 37);
    if (ids.length === 0) break;
    actual.push(...ids);
    cursor = keys[Number(ids.at(-1)) - 1];
  }
  expect(actual).toEqual(expected.map((key) => key.id));
  const prior = root;
  root = insert(root, {
    id: "2001",
    sequence: 2001,
    occurredAtUtc: "2026-01-01T00:00:00.000Z",
  });
  expect(page(prior, 2001, undefined, 2001)).not.toContain("2001");
  expect(page(root, 2001, undefined, 2001)).toContain("2001");
});
