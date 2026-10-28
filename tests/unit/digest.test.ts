import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DigestInputError,
  MAX_DIGEST_BYTES,
  sha256,
} from "../../src/digest.js";

const oracle = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("bounded SHA-256", () => {
  it("matches published SHA-256 vectors", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const nist = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(sha256(nist)).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });
  it("matches Node at padding and UTF-8 boundaries", () => {
    for (const length of [55, 56, 63, 64, 65, 1000, MAX_DIGEST_BYTES]) {
      const value = "a".repeat(length);
      expect(sha256(value)).toBe(oracle(value));
    }
    for (const value of [
      "أحمد",
      "😀".repeat(MAX_DIGEST_BYTES / 4),
      "€".repeat(10_922),
    ])
      expect(sha256(value)).toBe(oracle(value));
  });
  it("matches Node for seeded random accepted inputs", () => {
    let state = 0x12345678;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const alphabet = ["a", "Z", "0", "أ", "€", "😀", "\\", "\n"];
    for (let sample = 0; sample < 100; sample++) {
      const length = next() % 500;
      let value = "";
      for (let i = 0; i < length; i++)
        value += alphabet[next() % alphabet.length]!;
      expect(sha256(value)).toBe(oracle(value));
    }
  });
  it("rejects oversized and malformed inputs before unbounded work", () => {
    expect(() => sha256("a".repeat(MAX_DIGEST_BYTES + 1))).toThrow(
      DigestInputError,
    );
    expect(() => sha256("€".repeat(10_923))).toThrow(DigestInputError);
    expect(() => sha256("\ud800")).toThrow(DigestInputError);
    expect(() => sha256("\udc00")).toThrow(DigestInputError);
    expect(() => sha256(42 as never)).toThrow(DigestInputError);
  });
});
