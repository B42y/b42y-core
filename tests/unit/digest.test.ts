import { expect, it } from "vitest";
import { sha256 } from "../../src/digest.js";

it("matches published SHA-256 vectors and UTF-8 Node oracle", async () => {
  const { createHash } = await import("node:crypto");
  for (const input of ["", "abc", "أحمد", "a".repeat(1000)]) {
    expect(sha256(input)).toBe(
      createHash("sha256").update(input, "utf8").digest("hex"),
    );
  }
  expect(sha256("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
