import { describe, expect, it } from "vitest";
import { checkedAdd, parseEgp, positiveAmount } from "../../src/money.js";
import { normalizeName, validateUtc } from "../../src/domain.js";

describe("money and validation", () => {
  it("MONEY-001 parses digit scripts exactly", () => {
    for (const value of ["١٬٢٣٤٫٥٠", "1234.50", "۱۲۳۴٫۵۰"])
      expect(parseEgp(value)).toBe(123450);
  });
  it("MONEY-002 rejects invalid and ambiguous inputs", () => {
    for (const value of [
      "0",
      "-1",
      "1.005",
      "NaN",
      "1,23",
      "1٬234,567",
      "01",
      "1.",
    ])
      expect(() => parseEgp(value)).toThrow();
    for (const value of [0, -1, NaN, Infinity, 1.5])
      expect(() => positiveAmount(value)).toThrow();
  });
  it("detects arithmetic overflow", () =>
    expect(() => checkedAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow());
  it("normalizes search without altering display input", () =>
    expect(normalizeName("  أحمَد   ")).toBe("احمد"));
  it("rejects noncanonical dates", () =>
    expect(() => validateUtc("2026-02-30T00:00:00Z")).toThrow());
});
