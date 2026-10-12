export type Currency = "IDR" | "USD";
export const CURRENCIES: readonly Currency[] = ["IDR", "USD"];

const DECIMALS: Record<Currency, number> = { IDR: 0, USD: 2 };

export type Line = { qty: number; unitPrice: number };
export type Totals = { subtotal: number; taxAmount: number; total: number };

export function lineTotal(line: Line): number {
  return line.qty * line.unitPrice;
}

/**
 * Totals in the smallest unit. Tax is rounded half up.
 * Throws RangeError when the total is too large to store exactly.
 */
export function invoiceTotals(lines: readonly Line[], taxRateBp: number): Totals {
  let subtotal = 0n;
  for (const line of lines) subtotal += BigInt(line.qty) * BigInt(line.unitPrice);
  const taxAmount = (subtotal * BigInt(taxRateBp) + 5000n) / 10000n;
  const total = subtotal + taxAmount;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Amount is too large");
  return { subtotal: Number(subtotal), taxAmount: Number(taxAmount), total: Number(total) };
}

export function formatMoney(minor: number, currency: Currency): string {
  if (currency === "IDR") return `Rp ${new Intl.NumberFormat("id-ID").format(minor)}`;
  const dollars = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${dollars.format(minor / 100)}`;
}

/** Parses a plain decimal such as "1500000" or "19.99" into the smallest unit. Null when invalid. */
export function parseAmount(input: string, currency: Currency): number | null {
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = match[2] ?? "";
  if (DECIMALS[currency] === 0) return /^0*$/.test(fraction) ? whole : null;
  return whole * 100 + Number(fraction.padEnd(2, "0"));
}

/** The inverse of parseAmount, for filling number inputs. */
export function amountToInput(minor: number, currency: Currency): string {
  if (DECIMALS[currency] === 0) return String(minor);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

/** "11" or "11.5" to basis points. Null when invalid or above 100%. */
export function parsePercent(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp <= 10000 ? bp : null;
}

export function percentToInput(bp: number): string {
  return String(bp / 100);
}
