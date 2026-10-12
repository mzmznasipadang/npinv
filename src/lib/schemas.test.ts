import { test } from "node:test";
import assert from "node:assert/strict";
import { blankInvoiceValues, invoiceToValues, settingsToValues } from "./invoice-form.ts";
import { parseClientForm, parseInvoiceForm, parseInvoiceNumber, parseSettingsForm } from "./schemas.ts";
import type { InvoiceFormValues } from "./schemas.ts";
import type { Invoice, Settings } from "./repo.ts";

const SETTINGS: Settings = {
  businessName: "Naspad Studio",
  businessAddress: "",
  businessEmail: "",
  businessPhone: "",
  paymentDetails: "",
  defaultCurrency: "IDR",
  defaultTaxRateBp: 1100,
  taxLabel: "PPN",
  invoicePrefix: "INV",
  defaultDueDays: 14,
  defaultNotes: "Thank you.",
};

function values(overrides: Partial<InvoiceFormValues> = {}): InvoiceFormValues {
  return {
    clientId: "",
    billToName: "PT Example",
    billToCompany: "",
    billToAddress: "",
    issueDate: "2026-10-12",
    dueDate: "2026-10-26",
    currency: "IDR",
    taxEnabled: false,
    taxRate: "11",
    notes: "",
    items: [{ description: "Logo design", qty: "2", unitPrice: "1500000", notes: "" }],
    ...overrides,
  };
}

function errorsOf(v: unknown): Record<string, string> {
  const parsed = parseInvoiceForm(v);
  assert.equal(parsed.ok, false);
  return parsed.ok ? {} : parsed.errors;
}

test("a valid form becomes repository input in the smallest unit", () => {
  const parsed = parseInvoiceForm(values({ clientId: "7", taxEnabled: true, taxRate: "11.5", billToName: "  PT Example  " }));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data, {
    clientId: 7,
    billToName: "PT Example",
    billToCompany: "",
    billToAddress: "",
    issueDate: "2026-10-12",
    dueDate: "2026-10-26",
    currency: "IDR",
    taxRateBp: 1150,
    notes: "",
    items: [{ description: "Logo design", qty: 2, unitPrice: 1_500_000, notes: "" }],
  });
});

test("dollars are stored as cents", () => {
  const parsed = parseInvoiceForm(values({ currency: "USD", items: [{ description: "x", qty: "1", unitPrice: "19.99", notes: "" }] }));
  assert.ok(parsed.ok);
  assert.equal(parsed.data.items[0].unitPrice, 1999);
});

test("tax switched off stores zero whatever the rate field holds", () => {
  const parsed = parseInvoiceForm(values({ taxEnabled: false, taxRate: "not a number" }));
  assert.ok(parsed.ok);
  assert.equal(parsed.data.taxRateBp, 0);
});

test("errors are keyed by field", () => {
  const errors = errorsOf(
    values({
      billToName: "   ",
      taxEnabled: true,
      taxRate: "150",
      items: [{ description: "", qty: "0", unitPrice: "1.500.000", notes: "" }],
    }),
  );
  assert.ok(errors.billToName);
  assert.ok(errors.taxRate);
  assert.ok(errors["items.0.description"]);
  assert.ok(errors["items.0.qty"]);
  assert.ok(errors["items.0.unitPrice"]);
});

test("amounts in a local format are refused, not misread", () => {
  for (const unitPrice of ["1.500.000", "1,5", "-5", "", "abc", "1500.50"]) {
    const errors = errorsOf(values({ items: [{ description: "x", qty: "1", unitPrice, notes: "" }] }));
    assert.ok(errors["items.0.unitPrice"], `IDR ${JSON.stringify(unitPrice)}`);
  }
});

test("quantity must be a whole number of at least one", () => {
  for (const qty of ["0", "1.5", "-1", "", "abc"]) {
    const errors = errorsOf(values({ items: [{ description: "x", qty, unitPrice: "100", notes: "" }] }));
    assert.ok(errors["items.0.qty"], JSON.stringify(qty));
  }
});

test("the due date cannot be before the issue date, and dates must be real", () => {
  assert.ok(errorsOf(values({ dueDate: "2026-10-11" })).dueDate);
  assert.ok(errorsOf(values({ issueDate: "2026-02-30" })).issueDate);
  assert.ok(parseInvoiceForm(values({ dueDate: "2026-10-12" })).ok);
});

test("an invoice needs between 1 and 200 items", () => {
  assert.ok(errorsOf(values({ items: [] })).items);
  const item = { description: "x", qty: "1", unitPrice: "1", notes: "" };
  assert.ok(errorsOf(values({ items: Array.from({ length: 201 }, () => item) })).items);
  assert.ok(parseInvoiceForm(values({ items: Array.from({ length: 200 }, () => item) })).ok);
});

test("an unknown currency or a malformed payload is refused without throwing", () => {
  assert.ok(errorsOf(values({ currency: "EUR" })).currency);
  assert.equal(parseInvoiceForm(null).ok, false);
  assert.equal(parseInvoiceForm({ items: "nope" }).ok, false);
});

test("blank values come from settings", () => {
  const blank = blankInvoiceValues(SETTINGS, "2026-10-12");
  assert.equal(blank.issueDate, "2026-10-12");
  assert.equal(blank.dueDate, "2026-10-26");
  assert.equal(blank.currency, "IDR");
  assert.equal(blank.taxEnabled, false);
  assert.equal(blank.taxRate, "11");
  assert.equal(blank.notes, "Thank you.");
  assert.equal(blank.items.length, 1);
});

test("a stored invoice survives the trip through the form unchanged", () => {
  const invoice: Invoice = {
    id: 1,
    number: "INV-2026-001",
    status: "sent",
    paidAt: null,
    subtotal: 2998,
    taxAmount: 330,
    total: 3328,
    clientId: 3,
    billToName: "Jane",
    billToCompany: "Acme",
    billToAddress: "1 Road",
    issueDate: "2026-10-12",
    dueDate: "2026-10-26",
    currency: "USD",
    taxRateBp: 1100,
    notes: "Net 14",
    items: [{ description: "Hours", qty: 2, unitPrice: 1499, notes: "Oct" }],
  };
  const parsed = parseInvoiceForm(invoiceToValues(invoice, SETTINGS));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data, {
    clientId: 3,
    billToName: "Jane",
    billToCompany: "Acme",
    billToAddress: "1 Road",
    issueDate: "2026-10-12",
    dueDate: "2026-10-26",
    currency: "USD",
    taxRateBp: 1100,
    notes: "Net 14",
    items: [{ description: "Hours", qty: 2, unitPrice: 1499, notes: "Oct" }],
  });
});

test("client form requires a name and a plausible email", () => {
  const good = parseClientForm({ name: " Budi ", company: "", address: "", email: "", phone: "" });
  assert.ok(good.ok);
  assert.equal(good.data.name, "Budi");
  const bad = parseClientForm({ name: "", company: "", address: "", email: "not-an-email", phone: "" });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.errors.name);
    assert.ok(bad.errors.email);
  }
});

test("settings form round-trips and validates the prefix", () => {
  const parsed = parseSettingsForm(settingsToValues(SETTINGS));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data, SETTINGS);
  const lower = parseSettingsForm({ ...settingsToValues(SETTINGS), invoicePrefix: "nps" });
  assert.ok(lower.ok);
  assert.equal(lower.data.invoicePrefix, "NPS");
  const bad = parseSettingsForm({ ...settingsToValues(SETTINGS), invoicePrefix: "IN%V", defaultDueDays: "400", defaultTaxRate: "x" });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.errors.invoicePrefix);
    assert.ok(bad.errors.defaultDueDays);
    assert.ok(bad.errors.defaultTaxRate);
  }
});

test("an invoice number is short and made of safe characters", () => {
  const good = parseInvoiceNumber(" INV-2026-001 ");
  assert.ok(good.ok);
  assert.equal(good.data, "INV-2026-001");
  const lower = parseInvoiceNumber("inv-2026-005");
  assert.ok(lower.ok);
  assert.equal(lower.data, "INV-2026-005"); // upper case, so letter case cannot make a duplicate
  assert.equal(parseInvoiceNumber("").ok, false);
  assert.equal(parseInvoiceNumber("has space").ok, false);
  assert.equal(parseInvoiceNumber("x".repeat(31)).ok, false);
  assert.equal(parseInvoiceNumber(42).ok, false);
});
