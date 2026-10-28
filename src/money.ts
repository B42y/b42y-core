import { CoreError } from "./types.js";

export const MAX_INPUT_MINOR = 9_000_000_000_000_000;

export function checked(value: unknown, allowNegative = true): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (!allowNegative && value <= 0)
  ) {
    throw new CoreError("INVALID_AMOUNT");
  }
  return value;
}

export function positiveAmount(value: unknown): number {
  const n = checked(value, false);
  if (n > MAX_INPUT_MINOR) throw new CoreError("AMOUNT_OVERFLOW");
  return n;
}

export function signedAmount(value: unknown): number {
  const n = checked(value);
  if (Math.abs(n) > MAX_INPUT_MINOR) throw new CoreError("AMOUNT_OVERFLOW");
  return n;
}

export function checkedAdd(a: number, b: number): number {
  const result = BigInt(checked(a)) + BigInt(checked(b));
  if (
    result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new CoreError("AMOUNT_OVERFLOW");
  return Number(result);
}

export function checkedNegate(value: number): number {
  return checkedAdd(0, -checked(value));
}

export function parseEgp(input: string): number {
  if (typeof input !== "string") throw new CoreError("INVALID_AMOUNT");
  const normal = input.trim().replace(/[٠-٩۰-۹]/gu, (c) => {
    const code = c.codePointAt(0);
    if (code === undefined) throw new CoreError("INVALID_AMOUNT");
    return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
  });
  const decimal = normal.replace(/٫/gu, ".");
  const match =
    /^(?:(?:[1-9]\d{0,2}(?:[,٬]\d{3})+)|(?:0|[1-9]\d*))(?:\.(\d{1,2}))?$/u.exec(
      decimal,
    );
  if (!match || (decimal.includes(",") && decimal.includes("٬")))
    throw new CoreError("INVALID_AMOUNT");
  const [integer, fraction = ""] = decimal.split(".");
  if (integer === undefined) throw new CoreError("INVALID_AMOUNT");
  const minor =
    BigInt(integer.replace(/[,٬]/gu, "")) * 100n +
    BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n) throw new CoreError("INVALID_AMOUNT");
  if (minor > BigInt(MAX_INPUT_MINOR)) throw new CoreError("AMOUNT_OVERFLOW");
  return Number(minor);
}
