import { expect, it } from "vitest";
import {
  insertPartyId,
  partyIds,
  removePartyId,
} from "../fixtures/party-index.js";
import type { PartyNode } from "../fixtures/party-index.js";

it("orders, filters, pages, and removes IDs without changing prior roots", () => {
  let root: PartyNode | undefined;
  const ids = Array.from({ length: 1000 }, (_, i) =>
    String((i * 719) % 1000).padStart(4, "0"),
  );
  for (const id of ids) root = insertPartyId(root, id);
  const sorted = [...ids].sort();
  expect(partyIds(root, undefined, 1000, () => true)).toEqual(sorted);
  expect(partyIds(root, "0049", 10, () => true)).toEqual(sorted.slice(50, 60));
  expect(partyIds(root, undefined, 10, (id) => Number(id) % 2 === 0)).toEqual(
    sorted.filter((id) => Number(id) % 2 === 0).slice(0, 10),
  );
  const prior = root;
  root = removePartyId(root, "0049");
  expect(partyIds(prior, "0048", 2, () => true)).toEqual(["0049", "0050"]);
  expect(partyIds(root, "0048", 2, () => true)).toEqual(["0050", "0051"]);
});
