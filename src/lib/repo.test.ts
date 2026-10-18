import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "./db.ts";
import * as repo from "./repo.ts";
import type { InvoiceInput, PaymentInput } from "./repo.ts";

const TODAY = "2026-10-12";

function input(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    clientId: null,
    projectId: null,
    billToName: "PT Example",
    billToCompany: "Example Group",
    billToAddress: "Jl. Example 1",
    issueDate: TODAY,
    dueDate: "2026-10-26",
    currency: "IDR",
    taxRateBp: 0,
    discountType: "percent",
    discountValue: 0,
    downPaymentType: "percent",
    downPaymentValue: 0,
    notes: "",
    items: [{ description: "Logo design", qty: 2, unitPrice: 1_500_000, notes: "" }],
    ...overrides,
  };
}

function sentInvoice(number = "INV-2026-001", overrides: Partial<InvoiceInput> = {}): number {
  const id = repo.saveInvoice(null, input(overrides));
  assert.deepEqual(repo.markSent(id, number), { ok: true });
  return id;
}

function pay(amount: number, paidOn = TODAY): PaymentInput {
  return { paidOn, amount, note: "", writeOff: false };
}

function invoice(id: number): repo.Invoice {
  const found = repo.getInvoice(id);
  assert.ok(found);
  return found;
}

beforeEach(() => {
  getDb().exec("DELETE FROM invoices; DELETE FROM projects; DELETE FROM clients;");
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

test("a discount is saved with its computed amount and comes off before tax", () => {
  const id = repo.saveInvoice(null, input({ taxRateBp: 1100, discountType: "percent", discountValue: 1000 }));
  const inv = repo.getInvoice(id);
  assert.ok(inv);
  assert.equal(inv.subtotal, 3_000_000);
  assert.equal(inv.discountType, "percent");
  assert.equal(inv.discountValue, 1000);
  assert.equal(inv.discountAmount, 300_000);
  assert.equal(inv.taxAmount, 297_000);
  assert.equal(inv.total, 2_997_000);
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
  assert.deepEqual(repo.revertToDraft(a), { ok: true });
  let inv = repo.getInvoice(a);
  assert.ok(inv);
  assert.equal(inv.status, "draft");
  assert.equal(inv.number, "INV-2026-001");
  assert.deepEqual(repo.markSent(a, "INV-2026-777"), { ok: true });
  inv = repo.getInvoice(a);
  assert.ok(inv);
  assert.equal(inv.number, "INV-2026-001");
});

test("payments bring the balance down, and the last one marks the invoice paid on its date", () => {
  const id = sentInvoice();
  assert.deepEqual(repo.recordPayment(id, "IDR", { ...pay(1_500_000, "2026-10-01"), note: "DP 50%" }), { ok: true });
  let inv = invoice(id);
  assert.equal(inv.status, "sent");
  assert.equal(inv.paid, 1_500_000);
  assert.equal(inv.balance, 1_500_000);
  assert.equal(inv.payments[0].note, "DP 50%");
  const [row] = repo.listInvoices({}, TODAY);
  assert.equal(row.display, "partial");
  assert.equal(row.balance, 1_500_000);
  assert.equal(row.paid, 1_500_000);

  assert.deepEqual(repo.recordPayment(id, "IDR", pay(1_500_000, "2026-10-10")), { ok: true });
  inv = invoice(id);
  assert.equal(inv.status, "paid");
  assert.equal(inv.paidAt, "2026-10-10");
  assert.equal(inv.balance, 0);
});

test("a single full payment closes the invoice", () => {
  const id = sentInvoice();
  assert.deepEqual(repo.recordPayment(id, "IDR", pay(3_000_000)), { ok: true });
  assert.equal(invoice(id).status, "paid");
  assert.equal(invoice(id).paidAt, TODAY);
});

test("a payment above the balance, on a draft or paid invoice, or in another currency is refused", () => {
  const id = repo.saveInvoice(null, input());
  assert.equal(repo.recordPayment(id, "IDR", pay(100)).ok, false); // still a draft
  repo.markSent(id, "INV-2026-001");
  assert.equal(repo.recordPayment(id, "IDR", pay(3_000_001)).ok, false);
  assert.equal(repo.recordPayment(id, "USD", pay(100)).ok, false);
  assert.equal(repo.recordPayment(424242, "IDR", pay(100)).ok, false);
  // A second tab still shows the full balance after the first tab paid it.
  assert.deepEqual(repo.recordPayment(id, "IDR", pay(3_000_000)), { ok: true });
  assert.equal(repo.recordPayment(id, "IDR", pay(3_000_000)).ok, false);
  assert.equal(invoice(id).payments.length, 1);
});

test("a payment against a balance or currency that changed since it was shown is refused", () => {
  const id = sentInvoice();
  repo.recordPayment(id, "IDR", pay(2_000_000));
  const shown = invoice(id).balance; // a first tab shows 1,000,000 owed
  repo.removePayment(id, invoice(id).payments[0].id); // a second tab removes the payment: 3,000,000 owed
  assert.equal(repo.recordPayment(id, "IDR", { ...pay(990_000), writeOff: true }, shown).ok, false);
  assert.equal(repo.recordPayment(id, "USD", pay(100), invoice(id).balance).ok, false);
  assert.equal(invoice(id).payments.length, 0);
  assert.deepEqual(repo.recordPayment(id, "IDR", pay(100), invoice(id).balance), { ok: true });
});

test("a short payment can write off the rest, which closes the invoice", () => {
  const id = sentInvoice();
  assert.deepEqual(repo.recordPayment(id, "IDR", { ...pay(2_999_000), writeOff: true }), { ok: true });
  const inv = invoice(id);
  assert.equal(inv.status, "paid");
  assert.equal(inv.paid, 2_999_000);
  assert.equal(inv.balance, 0);
  assert.deepEqual(
    inv.payments.map((payment) => [payment.kind, payment.amount]),
    [["payment", 2_999_000], ["write_off", 1_000]],
  );
});

test("a write-off needs something left to write off, and only one is allowed", () => {
  const id = sentInvoice();
  assert.equal(repo.recordPayment(id, "IDR", { ...pay(3_000_000), writeOff: true }).ok, false);
  assert.equal(invoice(id).payments.length, 0);
  repo.recordPayment(id, "IDR", { ...pay(2_000_000), writeOff: true });
  const payment = invoice(id).payments.find((entry) => entry.kind === "payment");
  assert.ok(payment);
  repo.removePayment(id, payment.id); // reopens, with the write-off still there
  assert.equal(invoice(id).status, "sent");
  assert.equal(invoice(id).balance, 2_000_000);
  assert.equal(repo.recordPayment(id, "IDR", { ...pay(1_000_000), writeOff: true }).ok, false);
  assert.deepEqual(repo.recordPayment(id, "IDR", pay(2_000_000)), { ok: true });
  assert.equal(invoice(id).status, "paid");
});

test("removing a payment reopens a paid invoice, and only its own invoice's payments can be removed", () => {
  const a = sentInvoice();
  const b = sentInvoice("INV-2026-002");
  repo.recordPayment(a, "IDR", pay(3_000_000));
  const paymentId = invoice(a).payments[0].id;
  assert.equal(repo.removePayment(b, paymentId), false);
  assert.equal(repo.removePayment(a, paymentId), true);
  const inv = invoice(a);
  assert.equal(inv.status, "sent");
  assert.equal(inv.paidAt, null);
  assert.equal(inv.balance, 3_000_000);
  assert.equal(repo.removePayment(a, paymentId), false);
});

test("an edit cannot take the total below what is settled, or change the currency once paid", () => {
  const id = sentInvoice();
  repo.recordPayment(id, "IDR", pay(1_000_000));
  const below = input({ items: [{ description: "x", qty: 1, unitPrice: 999_999, notes: "" }] });
  assert.throws(
    () => repo.saveInvoice(id, below),
    (error) => error instanceof repo.PaymentConflictError && error.field === "items",
  );
  assert.throws(
    () => repo.saveInvoice(id, input({ currency: "USD" })),
    (error) => error instanceof repo.PaymentConflictError && error.field === "currency",
  );
  assert.equal(invoice(id).total, 3_000_000); // nothing was written

  repo.saveInvoice(id, input({ items: [{ description: "x", qty: 1, unitPrice: 1_000_000, notes: "" }] }));
  assert.equal(invoice(id).status, "paid"); // the total now equals what was paid
  repo.saveInvoice(id, input()); // back to 3,000,000
  const inv = invoice(id);
  assert.equal(inv.status, "sent");
  assert.equal(inv.paidAt, null);
  assert.equal(inv.balance, 2_000_000);
});

test("only a sent invoice with no payments can go back to draft", () => {
  const draft = repo.saveInvoice(null, input());
  assert.equal(repo.revertToDraft(draft).ok, false);
  const id = sentInvoice();
  repo.recordPayment(id, "IDR", pay(100));
  assert.equal(repo.revertToDraft(id).ok, false);
  repo.recordPayment(id, "IDR", pay(2_999_900));
  assert.equal(repo.revertToDraft(id).ok, false); // paid
  for (const payment of invoice(id).payments) repo.removePayment(id, payment.id);
  assert.deepEqual(repo.revertToDraft(id), { ok: true });
  assert.equal(invoice(id).status, "draft");
});

test("a zero-total invoice cannot take payments, and an old paid one stays paid when saved", () => {
  const free = input({ discountType: "percent", discountValue: 10000 });
  const id = sentInvoice("INV-2026-001", free);
  assert.equal(repo.recordPayment(id, "IDR", pay(1)).ok, false);
  assert.equal(invoice(id).status, "sent");
  const old = sentInvoice("INV-2026-002", free);
  getDb().exec(`UPDATE invoices SET status = 'paid', paid_at = '2026-10-01' WHERE id = ${old}`); // as migrated
  repo.saveInvoice(old, free);
  assert.equal(invoice(old).status, "paid");
});

test("the down payment request is stored with the invoice", () => {
  const id = repo.saveInvoice(null, input({ downPaymentType: "amount", downPaymentValue: 1_000_000 }));
  const inv = invoice(id);
  assert.equal(inv.downPaymentType, "amount");
  assert.equal(inv.downPaymentValue, 1_000_000);
});

test("an invoice in any status can be deleted, with its items and payments", () => {
  const draft = repo.saveInvoice(null, input());
  const sent = repo.saveInvoice(null, input());
  const paid = repo.saveInvoice(null, input());
  repo.markSent(sent, "INV-2026-001");
  repo.markSent(paid, "INV-2026-002");
  repo.recordPayment(paid, "IDR", pay(3_000_000));
  repo.recordPayment(sent, "IDR", pay(1_000));
  for (const id of [draft, sent, paid]) {
    assert.equal(repo.deleteInvoice(id), true);
    assert.equal(repo.getInvoice(id), null);
  }
  assert.equal(repo.deleteInvoice(draft), false);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM invoice_items").get()?.n, 0);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM payments").get()?.n, 0);
  assert.deepEqual(repo.dashboard(TODAY).summaries, []);
});

test("deleting the newest numbered invoice frees its number for the next one", () => {
  const a = repo.saveInvoice(null, input());
  repo.markSent(a, "INV-2026-001");
  repo.deleteInvoice(a);
  const b = repo.saveInvoice(null, input());
  assert.equal(repo.suggestNumber(b), "INV-2026-001");
});

test("duplicate makes an unnumbered draft dated today with the same content", () => {
  const a = repo.saveInvoice(
    null,
    input({ issueDate: "2026-09-01", dueDate: "2026-09-15", taxRateBp: 1100, currency: "USD", discountType: "amount", discountValue: 500, downPaymentType: "percent", downPaymentValue: 5000 }),
  );
  repo.markSent(a, "INV-2026-001");
  repo.recordPayment(a, "USD", pay(500));
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
  assert.equal(copy.discountType, "amount");
  assert.equal(copy.discountAmount, 500);
  assert.equal(copy.items[0].description, "Logo design");
  assert.equal(copy.downPaymentType, "percent");
  assert.equal(copy.downPaymentValue, 5000);
  assert.deepEqual(copy.payments, []);
  assert.equal(copy.balance, copy.total);
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

test("the dashboard counts balances owed and money received this month, per currency", () => {
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
  repo.recordPayment(idrLate, "IDR", pay(1_000_000, "2026-10-02")); // 2,000,000 still owed, and overdue
  repo.recordPayment(idrPaid, "IDR", { ...pay(150_000, "2026-10-05"), writeOff: true }); // 50,000 written off is not income
  repo.recordPayment(idrPaidLastMonth, "IDR", pay(999, "2026-09-30"));

  const { summaries, latest } = repo.dashboard(TODAY);
  assert.deepEqual(summaries, [
    {
      currency: "IDR", outstanding: 2_500_000, overdue: 2_000_000, paidThisMonth: 1_150_000,
      aging: { notDue: 500_000, days1To30: 2_000_000, days31To60: 0, over60: 0 },
    },
    {
      currency: "USD", outstanding: 15_000, overdue: 0, paidThisMonth: 0,
      aging: { notDue: 15_000, days1To30: 0, days31To60: 0, over60: 0 },
    },
  ]);
  assert.equal(latest.length, 6);
});

test("the dashboard ages each currency's balance by days past due", () => {
  // 3,000,000 IDR unless overridden.
  const owed = (number: string, dueDate: string, overrides: Partial<InvoiceInput> = {}) =>
    sentInvoice(number, { issueDate: "2026-07-01", dueDate, ...overrides });
  const dueToday = owed("INV-2026-001", TODAY);
  repo.recordPayment(dueToday, "IDR", pay(1_000_000)); // part paid, and not yet due: 2,000,000
  owed("INV-2026-002", "2026-10-11"); // 1 day late
  const late30 = owed("INV-2026-003", "2026-09-12");
  repo.recordPayment(late30, "IDR", pay(500_000)); // 30 days late: 2,500,000
  const late31 = owed("INV-2026-004", "2026-09-11");
  repo.recordPayment(late31, "IDR", { ...pay(1_000_000), writeOff: true }); // writes off the other 2,000,000
  const payment = invoice(late31).payments.find((p) => p.kind === "payment");
  assert.ok(payment);
  repo.removePayment(late31, payment.id); // 31 days late, only the write-off left: 1,000,000
  owed("INV-2026-005", "2026-08-13"); // 60 days late
  owed("INV-2026-006", "2026-08-12"); // 61 days late
  const settled = owed("INV-2026-007", "2026-08-01");
  repo.recordPayment(settled, "IDR", { ...pay(1), writeOff: true }); // owes nothing
  repo.saveInvoice(null, input({ issueDate: "2026-07-01", dueDate: "2026-08-01" })); // a draft counts nowhere
  const usd = (unitPrice: number) => ({ currency: "USD" as const, items: [{ description: "x", qty: 1, unitPrice, notes: "" }] });
  const usdLate = owed("INV-2026-008", "2026-07-01", usd(20_000));
  repo.recordPayment(usdLate, "USD", pay(5_000)); // 103 days late: 15,000
  owed("INV-2026-009", "2026-11-01", usd(7_500));

  const { summaries } = repo.dashboard(TODAY);
  assert.deepEqual(summaries.map((s) => [s.currency, s.aging]), [
    ["IDR", { notDue: 2_000_000, days1To30: 5_500_000, days31To60: 4_000_000, over60: 3_000_000 }],
    ["USD", { notDue: 7_500, days1To30: 0, days31To60: 0, over60: 15_000 }],
  ]);
  for (const { currency, outstanding, overdue, aging } of summaries) {
    assert.equal(aging.notDue + aging.days1To30 + aging.days31To60 + aging.over60, outstanding, currency);
    assert.equal(aging.days1To30 + aging.days31To60 + aging.over60, overdue, currency);
    // Not yet due is what the invoice list, through displayStatus, shows as owed and not overdue.
    const current = repo.listInvoices({ currency, outstanding: true }, TODAY).filter((row) => row.display !== "overdue");
    assert.equal(aging.notDue, current.reduce((sum, row) => sum + row.balance, 0), currency);
  }
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

test("refuses a number that differs only by letter case", () => {
  const a = repo.saveInvoice(null, input());
  const b = repo.saveInvoice(null, input());
  assert.deepEqual(repo.markSent(a, "INV-2026-005"), { ok: true });
  assert.equal(repo.markSent(b, "inv-2026-005").ok, false);
  const second = repo.getInvoice(b);
  assert.ok(second);
  assert.equal(second.number, null);
});

test("the dashboard does not fail when sent totals add up past what a number can hold", () => {
  const big = input({ items: [{ description: "Huge", qty: 1, unitPrice: 10_000_000_000_000, notes: "" }] });
  for (let i = 0; i < 901; i++) repo.saveInvoice(null, big);
  getDb().exec("UPDATE invoices SET status = 'sent', number = 'BIG-' || id");
  const { summaries } = repo.dashboard(TODAY);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].outstanding, Number.MAX_SAFE_INTEGER);
  assert.equal(summaries[0].aging.notDue, Number.MAX_SAFE_INTEGER);
});

test('invoice project links enforce clients and archived history atomically', async () => {
  const { saveProject, setProjectArchived } = await import('./projects.ts');
  const c = repo.createClient({name:'Synthetic A',company:'',address:'',email:'',phone:''});
  const other = repo.createClient({name:'Synthetic B',company:'',address:'',email:'',phone:''});
  const projectInput = {clientId:c, name:'Brand', description:'', status:'in_progress' as const, startDate:null, deadline:null};
  const projectId = saveProject(null, projectInput);
  const id = repo.saveInvoice(null, input({clientId:c, projectId}));
  repo.markSent(id, 'INV-2026-901');
  repo.recordPayment(id, 'IDR', pay(100));
  const before = invoice(id);
  assert.throws(() => repo.saveInvoice(id, input({clientId:other, projectId})), repo.ProjectConflictError);
  assert.deepEqual(invoice(id), before);
  assert.throws(() => repo.saveInvoice(null, input({clientId:c, projectId:999})), repo.ProjectConflictError);
  assert.throws(() => repo.saveInvoice(null, input({clientId:999, projectId})), repo.ProjectConflictError);
  assert.throws(() => saveProject(projectId, {...projectInput, clientId:other}), repo.ProjectConflictError);
  repo.updateClient(c,{name:'New name',company:'Updated',address:'Changed',email:'',phone:''});
  saveProject(projectId,{...projectInput,status:'completed'});
  setProjectArchived(projectId,true);
  assert.deepEqual(invoice(id), before);
  assert.throws(() => repo.saveInvoice(null, input({clientId:c,projectId})), repo.ProjectConflictError);
  repo.saveInvoice(id,{...before, notes:'Revised notes'});
  assert.equal(invoice(id).projectId, projectId);
  const copy = repo.duplicateInvoice(id, TODAY)!;
  assert.equal(invoice(copy).projectId, null);
  assert.equal(invoice(id).projectId, projectId);
  setProjectArchived(projectId,false);
  assert.equal(invoice(repo.duplicateInvoice(id,TODAY)!).projectId,projectId);
  repo.saveInvoice(id,{...before,projectId:null});
  assert.equal(invoice(id).projectId,null);
});

test('invoice project filters compose with client, currency and collectible balances', async () => {
  const {saveProject} = await import('./projects.ts');
  const c = repo.createClient({name:'Filter client',company:'',address:'',email:'',phone:''});
  const projectId = saveProject(null,{clientId:c,name:'Filter project',description:'',status:'planned',startDate:null,deadline:null});
  const draft = repo.saveInvoice(null,input({clientId:c,projectId}));
  const sent = sentInvoice('INV-2026-801',{clientId:c,projectId});
  const unlinked = repo.saveInvoice(null,input({clientId:c,projectId:null}));
  assert.deepEqual(repo.listInvoices({projectId},TODAY).map(r=>r.id),[sent,draft]);
  assert.deepEqual(repo.listInvoices({projectId,clientId:c,outstanding:true,currency:'IDR'},TODAY).map(r=>r.id),[sent]);
  assert.equal(repo.listInvoices({projectId,currency:'USD'},TODAY).length,0);
  assert.equal(repo.listInvoices({projectId,clientId:999},TODAY).length,0);
  assert.ok(repo.listInvoices({clientId:c},TODAY).some(r=>r.id===unlinked));
  repo.recordPayment(sent,'IDR',pay(3_000_000));
  assert.equal(repo.listInvoices({projectId,outstanding:true},TODAY).length,0);
});

test('stale project-prefilled invoice is rejected if its client changes or it is archived', async () => {
  const {saveProject,setProjectArchived} = await import('./projects.ts');
  const a = repo.createClient({name:'Before',company:'',address:'',email:'',phone:''});
  const b = repo.createClient({name:'After',company:'',address:'',email:'',phone:''});
  const project = {clientId:a,name:'Stale',description:'',status:'planned' as const,startDate:null,deadline:null};
  const projectId = saveProject(null,project);
  const stale = input({clientId:a,projectId});
  saveProject(projectId,{...project,clientId:b});
  assert.throws(()=>repo.saveInvoice(null,stale),repo.ProjectConflictError);
  setProjectArchived(projectId,true);
  assert.throws(()=>repo.saveInvoice(null,{...stale,clientId:b}),repo.ProjectConflictError);
  assert.equal(repo.listInvoices({},TODAY).length,0);
});

test("every invoice write leaves a millisecond version", () => {
  const MS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
  const stamp = (id: number) => (getDb().prepare("SELECT updated_at AS v FROM invoices WHERE id = ?").get(id) as { v: string }).v;
  // Start each write from a seconds-format stamp, so a match proves that write stamped it.
  const reset = (id: number) => getDb().prepare("UPDATE invoices SET updated_at = '2026-10-01 00:00:00' WHERE id = ?").run(id);
  const id = repo.saveInvoice(null, input());
  assert.match(stamp(id), MS);
  const steps: [string, () => void][] = [
    ["save", () => repo.saveInvoice(id, input())],
    ["markSent", () => assert.deepEqual(repo.markSent(id, "INV-2026-050"), { ok: true })],
    ["recordPayment", () => assert.deepEqual(repo.recordPayment(id, "IDR", pay(1_000)), { ok: true })],
    ["removePayment", () => assert.ok(repo.removePayment(id, invoice(id).payments[0].id))],
    ["revertToDraft", () => assert.deepEqual(repo.revertToDraft(id), { ok: true })],
  ];
  for (const [name, write] of steps) { reset(id); write(); assert.match(stamp(id), MS, name); }
});
