export type Currency = "IDR" | "USD";
export const CURRENCIES: readonly Currency[] = ["IDR", "USD"];

const DECIMALS: Record<Currency, number> = { IDR: 0, USD: 2 };

/**
 * The largest total one invoice may have, in the smallest unit (Rp 10 trillion, or $100 billion).
 * Far above any real invoice, and low enough that sums of many invoices stay exact.
 */
export const MAX_TOTAL = 10_000_000_000_000;

export type Line = { qty: number; unitPrice: number };
/** A percentage in basis points, or a fixed amount in the smallest unit. */
export type Discount = { type: "percent" | "amount"; value: number };
export type Totals = { subtotal: number; discountAmount: number; taxAmount: number; total: number };

const NO_DISCOUNT: Discount = { type: "percent", value: 0 };

export function lineTotal(line: Line): number {
  return line.qty * line.unitPrice;
}

/**
 * Totals in the smallest unit. The discount comes off before tax, since PPN is charged on the
 * discounted price. A percentage discount and the tax are rounded half up.
 * Throws RangeError when the subtotal or total is above MAX_TOTAL, or the discount is above the subtotal.
 */
export function invoiceTotals(lines: readonly Line[], taxRateBp: number, discount: Discount = NO_DISCOUNT): Totals {
  let subtotal = 0n;
  for (const line of lines) subtotal += BigInt(line.qty) * BigInt(line.unitPrice);
  const discountAmount =
    discount.type === "percent" ? (subtotal * BigInt(discount.value) + 5000n) / 10000n : BigInt(discount.value);
  if (discountAmount > subtotal) throw new RangeError("Discount is larger than the subtotal");
  const taxAmount = ((subtotal - discountAmount) * BigInt(taxRateBp) + 5000n) / 10000n;
  const total = subtotal - discountAmount + taxAmount;
  if (subtotal > BigInt(MAX_TOTAL) || total > BigInt(MAX_TOTAL)) throw new RangeError("Amount is too large");
  return {
    subtotal: Number(subtotal),
    discountAmount: Number(discountAmount),
    taxAmount: Number(taxAmount),
    total: Number(total),
  };
}

export function formatMoney(minor: number, currency: Currency): string {
  if (currency === "IDR") return `Rp ${new Intl.NumberFormat("id-ID").format(minor)}`;
  // Whole dollars and cents are split as integers; dividing by 100 would round large amounts.
  const cents = BigInt(minor);
  return `$${new Intl.NumberFormat("en-US").format(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
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
