import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "./db.ts";
import * as repo from "./repo.ts";
import type { InvoiceInput } from "./repo.ts";

const TODAY = "2026-10-12";

function input(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    clientId: null,
    billToName: "PT Example",
    billToCompany: "Example Group",
    billToAddress: "Jl. Example 1",
    issueDate: TODAY,
    dueDate: "2026-10-26",
    currency: "IDR",
    taxRateBp: 0,
    notes: "",
    items: [{ description: "Logo design", qty: 2, unitPrice: 1_500_000, notes: "" }],
    ...overrides,
  };
}

beforeEach(() => {
  getDb().exec("DELETE FROM invoices; DELETE FROM clients;");
});

test("settings start with the documented defaults", () => {
  const s = repo.getSettings();
  assert.equal(s.businessName, "Naspad Studio");
  assert.equal(s.defaultCurrency, "IDR");
  assert.equal(s.defaultTaxRateBp, 1100);
  assert.equal(s.taxLabel, "PPN");
  assert.equal(s.invoicePrefix, "INV");
  assert.equal(s.defaultDueDays, 14);
});

test("settings can be updated and read back", () => {
  const s = repo.getSettings();
  repo.updateSettings({ ...s, paymentDetails: "Bank Example 123" });
  assert.equal(repo.getSettings().paymentDetails, "Bank Example 123");
  repo.updateSettings(s);
});

test("a new invoice is an unnumbered draft with computed totals and ordered items", () => {
  const id = repo.saveInvoice(
    null,
    input({
      taxRateBp: 1100,
      items: [
        { description: "First", qty: 1, unitPrice: 1_000_000, notes: "a" },
        { description: "Second", qty: 2, unitPrice: 500_000, notes: "" },
      ],
    }),
  );
  const inv = repo.getInvoice(id);
  assert.ok(inv);
  assert.equal(inv.status, "draft");
  assert.equal(inv.number, null);
  assert.equal(inv.subtotal, 2_000_000);
  assert.equal(inv.taxAmount, 220_000);
  assert.equal(inv.total, 2_220_000);
  assert.deepEqual(inv.items.map((it) => it.description), ["First", "Second"]);
  assert.equal(inv.items[0].notes, "a");
});

test("saving again replaces the items and recomputes the totals", () => {
  const id = repo.saveInvoice(null, input());
  repo.saveInvoice(id, input({ items: [{ description: "Only", qty: 1, unitPrice: 100, notes: "" }] }));
  const inv = repo.getInvoice(id);
  assert.ok(inv);
  assert.equal(inv.items.length, 1);
  assert.equal(inv.total, 100);
});

test("saving an invoice that does not exist throws NotFoundError", () => {
  assert.throws(() => repo.saveInvoice(424242, input()), repo.NotFoundError);
});

test("a total too large to store throws RangeError and writes nothing", () => {
  assert.throws(
    () => repo.saveInvoice(null, input({ items: [{ description: "Huge", qty: 100_000, unitPrice: 1_000_000_000_000, notes: "" }] })),
    RangeError,
  );
  assert.equal(repo.listInvoices({}, TODAY).length, 0);
});

test("saves when the linked client has been deleted", () => {
  const clientId = repo.createClient({ name: "Gone", company: "", address: "", email: "", phone: "" });
  repo.deleteClient(clientId);
  const id = repo.saveInvoice(null, input({ clientId }));
  const inv = repo.getInvoice(id);
  assert.ok(inv);
  assert.equal(inv.clientId, null);
  assert.equal(inv.billToName, "PT Example");
});

test("deleting a client keeps its invoices and their bill-to details", () => {
  const clientId = repo.createClient({ name: "PT Example", company: "", address: "", email: "", phone: "" });
  const id = repo.saveInvoice(null, input({ clientId }));
  assert.equal(repo.deleteClient(clientId), true);
  const inv = repo.getInvoice(id);
  assert.ok(inv);
  assert.equal(inv.clientId, null);
  assert.equal(inv.billToName, "PT Example");
});

test("the first invoice sent in a year is numbered 001 and the next 002", () => {
  const a = repo.saveInvoice(null, input());
  const b = repo.saveInvoice(null, input());
  assert.equal(repo.suggestNumber(a), "INV-2026-001");
  assert.deepEqual(repo.markSent(a, "INV-2026-001"), { ok: true });
  assert.equal(repo.suggestNumber(b), "INV-2026-002");
});

test("the suggested number uses the year of the issue date", () => {
  const a = repo.saveInvoice(null, input());
  repo.markSent(a, "INV-2026-001");
  const b = repo.saveInvoice(null, input({ issueDate: "2027-01-02", dueDate: "2027-01-16" }));
  assert.equal(repo.suggestNumber(b), "INV-2027-001");
});

test("a custom number continues the series", () => {
  const a = repo.saveInvoice(null, input());
  repo.markSent(a, "INV-2026-014");
  const b = repo.saveInvoice(null, input());
  assert.equal(repo.suggestNumber(b), "INV-2026-015");
});

test("refuses a number that is already used", () => {
  const a = repo.saveInvoice(null, input());
  const b = repo.saveInvoice(null, input());
  repo.markSent(a, "INV-2026-001");
  const result = repo.markSent(b, "INV-2026-001");
  assert.equal(result.ok, false);
  const inv = repo.getInvoice(b);
  assert.ok(inv);
  assert.equal(inv.status, "draft");
  assert.equal(inv.number, null);
});

test("only a draft can be marked sent", () => {
  const a = repo.saveInvoice(null, input());
  repo.markSent(a, "INV-2026-001");
  assert.equal(repo.markSent(a, "INV-2026-002").ok, false);
});

test("a number, once assigned, survives revert and re-send", () => {
  const a = repo.saveInvoice(null, input());
  repo.markSent(a, "INV-2026-001");
  assert.deepEqual(repo.undoStatus(a), { ok: true });
  let inv = repo.getInvoice(a);
  assert.ok(inv);
  assert.equal(inv.status, "draft");
  assert.equal(inv.number, "INV-2026-001");
  assert.deepEqual(repo.markSent(a, "INV-2026-777"), { ok: true });
  inv = repo.getInvoice(a);
  assert.ok(inv);
  assert.equal(inv.number, "INV-2026-001");
});

test("only a sent invoice can be marked paid, and undo clears the paid date", () => {
  const a = repo.saveInvoice(null, input());
  assert.equal(repo.markPaid(a, TODAY).ok, false);
  repo.markSent(a, "INV-2026-001");
  assert.deepEqual(repo.markPaid(a, TODAY), { ok: true });
  let inv = repo.getInvoice(a);
  assert.ok(inv);
  assert.equal(inv.status, "paid");
  assert.equal(inv.paidAt, TODAY);
  assert.deepEqual(repo.undoStatus(a), { ok: true });
  inv = repo.getInvoice(a);
  assert.ok(inv);
  assert.equal(inv.status, "sent");
  assert.equal(inv.paidAt, null);
});

test("a draft cannot be undone further", () => {
  const a = repo.saveInvoice(null, input());
  assert.equal(repo.undoStatus(a).ok, false);
});

test("only a draft that was never numbered can be deleted", () => {
  const plain = repo.saveInvoice(null, input());
  const numbered = repo.saveInvoice(null, input());
  repo.markSent(numbered, "INV-2026-001");
  assert.equal(repo.deleteInvoice(numbered), false); // sent
  repo.undoStatus(numbered);
  assert.equal(repo.deleteInvoice(numbered), false); // draft, but numbered
  assert.equal(repo.deleteInvoice(plain), true);
  assert.equal(repo.getInvoice(plain), null);
  assert.ok(repo.getInvoice(numbered));
});

test("duplicate makes an unnumbered draft dated today with the same content", () => {
  const a = repo.saveInvoice(null, input({ issueDate: "2026-09-01", dueDate: "2026-09-15", taxRateBp: 1100, currency: "USD" }));
  repo.markSent(a, "INV-2026-001");
  const b = repo.duplicateInvoice(a, TODAY);
  assert.ok(b);
  const copy = repo.getInvoice(b);
  assert.ok(copy);
  assert.equal(copy.status, "draft");
  assert.equal(copy.number, null);
  assert.equal(copy.issueDate, TODAY);
  assert.equal(copy.dueDate, "2026-10-26");
  assert.equal(copy.currency, "USD");
  assert.equal(copy.taxRateBp, 1100);
  assert.equal(copy.items[0].description, "Logo design");
  assert.equal(repo.duplicateInvoice(424242, TODAY), null);
});

test("the list separates sent from overdue by due date", () => {
  const late = repo.saveInvoice(null, input({ issueDate: "2026-09-01", dueDate: "2026-10-11" }));
  const dueToday = repo.saveInvoice(null, input({ dueDate: TODAY }));
  repo.saveInvoice(null, input());
  repo.markSent(late, "INV-2026-001");
  repo.markSent(dueToday, "INV-2026-002");
  assert.deepEqual(repo.listInvoices({ status: "overdue" }, TODAY).map((r) => r.id), [late]);
  assert.deepEqual(repo.listInvoices({ status: "sent" }, TODAY).map((r) => r.id), [dueToday]);
  assert.equal(repo.listInvoices({ status: "draft" }, TODAY).length, 1);
  assert.equal(repo.listInvoices({ status: "all" }, TODAY).length, 3);
  assert.equal(repo.listInvoices({ status: "overdue" }, TODAY)[0].display, "overdue");
});

test("search matches number, name or company, and treats % literally", () => {
  const a = repo.saveInvoice(null, input({ billToName: "Budi Santoso", billToCompany: "Kopi 100%" }));
  repo.saveInvoice(null, input({ billToName: "Sari", billToCompany: "Teh" }));
  repo.markSent(a, "INV-2026-001");
  assert.equal(repo.listInvoices({ q: "budi" }, TODAY).length, 1);
  assert.equal(repo.listInvoices({ q: "2026-001" }, TODAY).length, 1);
  assert.equal(repo.listInvoices({ q: "100%" }, TODAY).length, 1);
  assert.equal(repo.listInvoices({ q: "%" }, TODAY).length, 1);
  assert.equal(repo.listInvoices({ q: "zzz" }, TODAY).length, 0);
});

test("the dashboard totals each currency separately", () => {
  const idrLate = repo.saveInvoice(null, input({ issueDate: "2026-09-01", dueDate: "2026-10-01" })); // 3,000,000
  const idrOpen = repo.saveInvoice(null, input({ items: [{ description: "x", qty: 1, unitPrice: 500_000, notes: "" }] }));
  const idrPaid = repo.saveInvoice(null, input({ items: [{ description: "x", qty: 1, unitPrice: 200_000, notes: "" }] }));
  const idrPaidLastMonth = repo.saveInvoice(null, input({ items: [{ description: "x", qty: 1, unitPrice: 999, notes: "" }] }));
  const usdOpen = repo.saveInvoice(null, input({ currency: "USD", items: [{ description: "x", qty: 1, unitPrice: 15_000, notes: "" }] }));
  repo.saveInvoice(null, input()); // a draft counts nowhere
  repo.markSent(idrLate, "INV-2026-001");
  repo.markSent(idrOpen, "INV-2026-002");
  repo.markSent(idrPaid, "INV-2026-003");
  repo.markSent(idrPaidLastMonth, "INV-2026-004");
  repo.markSent(usdOpen, "INV-2026-005");
  repo.markPaid(idrPaid, "2026-10-05");
  repo.markPaid(idrPaidLastMonth, "2026-09-30");

  const { summaries, latest } = repo.dashboard(TODAY);
  assert.deepEqual(summaries, [
    { currency: "IDR", outstanding: 3_500_000, overdue: 3_000_000, paidThisMonth: 200_000 },
    { currency: "USD", outstanding: 15_000, overdue: 0, paidThisMonth: 0 },
  ]);
  assert.equal(latest.length, 6);
});

test("a currency with no invoices has no summary", () => {
  repo.saveInvoice(null, input());
  assert.deepEqual(repo.dashboard(TODAY).summaries.map((s) => s.currency), ["IDR"]);
});

test("clients are listed by name and can be edited", () => {
  const b = repo.createClient({ name: "Budi", company: "", address: "", email: "", phone: "" });
  repo.createClient({ name: "Andi", company: "", address: "", email: "", phone: "" });
  assert.deepEqual(repo.listClients().map((c) => c.name), ["Andi", "Budi"]);
  assert.equal(repo.updateClient(b, { name: "Budi S", company: "Kopi", address: "", email: "", phone: "" }), true);
  assert.equal(repo.listClients()[1].company, "Kopi");
  assert.equal(repo.updateClient(424242, { name: "x", company: "", address: "", email: "", phone: "" }), false);
});
