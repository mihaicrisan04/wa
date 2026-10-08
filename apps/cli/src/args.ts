import { UsageError } from "./command";

export function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new UsageError(`${flag} must be a positive number`);
  }
  return number;
}

export function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((item) => item === value);
}

/** A flag that takes one of a fixed set of values. */
export function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T | undefined {
  if (value === undefined || isOneOf(value, allowed)) return value;
  throw new UsageError(`${flag} must be one of ${allowed.join(", ")}`);
}
