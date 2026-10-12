import { test } from "node:test";
import assert from "node:assert/strict";
import { amountToInput, formatMoney, invoiceTotals, lineTotal, parseAmount, parsePercent, percentToInput } from "./money.ts";

test("line total is quantity times unit price", () => {
  assert.equal(lineTotal({ qty: 3, unitPrice: 250_000 }), 750_000);
});

test("totals without tax", () => {
  assert.deepEqual(invoiceTotals([{ qty: 2, unitPrice: 1_500_000 }, { qty: 1, unitPrice: 500_000 }], 0), {
    subtotal: 3_500_000,
    taxAmount: 0,
    total: 3_500_000,
  });
});

test("11% tax on one million rupiah", () => {
  assert.deepEqual(invoiceTotals([{ qty: 1, unitPrice: 1_000_000 }], 1100), {
    subtotal: 1_000_000,
    taxAmount: 110_000,
    total: 1_110_000,
  });
});

test("tax rounds half up to the smallest unit", () => {
  assert.equal(invoiceTotals([{ qty: 1, unitPrice: 5 }], 1000).taxAmount, 1); // 0.5 -> 1
  assert.equal(invoiceTotals([{ qty: 1, unitPrice: 4 }], 1000).taxAmount, 0); // 0.4 -> 0
  assert.equal(invoiceTotals([{ qty: 1, unitPrice: 999 }], 1250).taxAmount, 125); // 124.875 -> 125
});

test("no lines gives zero totals", () => {
  assert.deepEqual(invoiceTotals([], 1100), { subtotal: 0, taxAmount: 0, total: 0 });
});

test("a total too large to store exactly throws RangeError", () => {
  assert.throws(() => invoiceTotals([{ qty: 100_000, unitPrice: 1_000_000_000_000 }], 0), RangeError);
});

test("formats rupiah without decimals and dollars with two", () => {
  assert.equal(formatMoney(1_500_000, "IDR"), "Rp 1.500.000");
  assert.equal(formatMoney(0, "IDR"), "Rp 0");
  assert.equal(formatMoney(150_050, "USD"), "$1,500.50");
  assert.equal(formatMoney(5, "USD"), "$0.05");
});

test("parses plain rupiah amounts", () => {
  assert.equal(parseAmount("1500000", "IDR"), 1_500_000);
  assert.equal(parseAmount(" 1500 ", "IDR"), 1500);
  assert.equal(parseAmount("1500.00", "IDR"), 1500);
  assert.equal(parseAmount("0", "IDR"), 0);
});

test("rejects rupiah with a fraction", () => {
  assert.equal(parseAmount("1500.50", "IDR"), null);
});

test("parses dollars into cents without float error", () => {
  assert.equal(parseAmount("19.99", "USD"), 1999);
  assert.equal(parseAmount("19.9", "USD"), 1990);
  assert.equal(parseAmount("19", "USD"), 1900);
  assert.equal(parseAmount("0.07", "USD"), 7);
});

test("rejects anything that is not a plain decimal", () => {
  for (const bad of ["", "abc", "-5", "1.500.000", "1,5", "1e3", "19.999", " ", "12345678901234"]) {
    assert.equal(parseAmount(bad, "IDR"), null, `IDR ${JSON.stringify(bad)}`);
    assert.equal(parseAmount(bad, "USD"), null, `USD ${JSON.stringify(bad)}`);
  }
});

test("amountToInput is the inverse of parseAmount", () => {
  assert.equal(amountToInput(1_500_000, "IDR"), "1500000");
  assert.equal(amountToInput(150_050, "USD"), "1500.50");
  assert.equal(amountToInput(7, "USD"), "0.07");
  assert.equal(parseAmount(amountToInput(1999, "USD"), "USD"), 1999);
});

test("percentages convert to and from basis points", () => {
  assert.equal(parsePercent("11"), 1100);
  assert.equal(parsePercent("11.5"), 1150);
  assert.equal(parsePercent("0"), 0);
  assert.equal(parsePercent("100"), 10000);
  assert.equal(parsePercent("100.01"), null);
  assert.equal(parsePercent("abc"), null);
  assert.equal(parsePercent("-1"), null);
  assert.equal(percentToInput(1100), "11");
  assert.equal(percentToInput(1150), "11.5");
  assert.equal(percentToInput(0), "0");
});

test("a total above ten trillion smallest units is refused", () => {
  assert.equal(invoiceTotals([{ qty: 1, unitPrice: 10_000_000_000_000 }], 0).total, 10_000_000_000_000);
  assert.throws(() => invoiceTotals([{ qty: 1, unitPrice: 10_000_000_000_001 }], 0), RangeError);
  assert.throws(() => invoiceTotals([{ qty: 1, unitPrice: 9_500_000_000_000 }], 1100), RangeError); // tax pushes it over
});

test("large dollar amounts keep their exact cents", () => {
  assert.equal(formatMoney(8_999_999_999_999_991, "USD"), "$89,999,999,999,999.91");
  assert.equal(formatMoney(10_000_000_000_000, "USD"), "$100,000,000,000.00");
});
