import { getDb, transaction } from "./db.ts";
import { formatMoney, invoiceTotals } from "./money.ts";
import type { Currency, Portion } from "./money.ts";
import { addDays, displayStatus, formatNumber, nextSequence } from "./rules.ts";
import type { DisplayStatus, Status } from "./rules.ts";

export type Settings = {
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  paymentDetails: string;
  defaultCurrency: Currency;
  defaultTaxRateBp: number;
  taxLabel: string;
  invoicePrefix: string;
  defaultDueDays: number;
  defaultNotes: string;
};

export type Client = { id: number; name: string; company: string; address: string; email: string; phone: string };
export type ClientInput = Omit<Client, "id">;

export type ItemInput = { description: string; qty: number; unitPrice: number; notes: string };

export type InvoiceInput = {
  clientId: number | null;
  billToName: string;
  billToCompany: string;
  billToAddress: string;
  issueDate: string;
  dueDate: string;
  currency: Currency;
  taxRateBp: number;
  discountType: Portion["type"];
  /** Basis points for a percentage, the smallest unit for an amount. Zero means no discount. */
  discountValue: number;
  downPaymentType: Portion["type"];
  /** Basis points for a percentage, the smallest unit for an amount. Zero means no down payment is asked for. */
  downPaymentValue: number;
  notes: string;
  items: ItemInput[];
};

export type PaymentKind = "payment" | "write_off";
export type Payment = { id: number; paidOn: string; amount: number; kind: PaymentKind; note: string };
/** One payment. With `writeOff`, whatever it leaves owing is written off on the same date. */
export type PaymentInput = { paidOn: string; amount: number; note: string; writeOff: boolean };

export type Invoice = InvoiceInput & {
  id: number;
  number: string | null;
  status: Status;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  paidAt: string | null;
  payments: Payment[];
  /** Money received: payments only, without write-offs. */
  paid: number;
  /** Total minus payments and write-offs. */
  balance: number;
};

export type InvoiceRow = {
  id: number;
  number: string | null;
  billToName: string;
  billToCompany: string;
  issueDate: string;
  dueDate: string;
  currency: Currency;
  total: number;
  paid: number;
  balance: number;
  status: Status;
  display: DisplayStatus;
};

export type InvoiceFilter = { status?: DisplayStatus | "all"; q?: string };
export type CurrencySummary = { currency: Currency; outstanding: number; overdue: number; paidThisMonth: number };
export type Result = { ok: true } | { ok: false; error: string };

export class NotFoundError extends Error {}

export class ProjectConflictError extends Error {
  field: string;
  constructor(field: string, message: string) { super(message); this.field = field; }
}

/** An edit that conflicts with recorded payments. `field` is the form field to show the message on. */
export class PaymentConflictError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

type Arg = string | number | null;

// Rows are copied into plain objects so they can be passed to Client Components.
function one<T>(sql: string, ...args: Arg[]): T | undefined {
  const row = getDb().prepare(sql).get(...args);
  return row ? ({ ...row } as T) : undefined;
}

function many<T>(sql: string, ...args: Arg[]): T[] {
  return getDb().prepare(sql).all(...args).map((row) => ({ ...row }) as T);
}

function run(sql: string, ...args: Arg[]): { changes: number; id: number } {
  const result = getDb().prepare(sql).run(...args);
  return { changes: Number(result.changes), id: Number(result.lastInsertRowid) };
}

// Settings

const SETTINGS_COLS = `business_name AS businessName, business_address AS businessAddress,
  business_email AS businessEmail, business_phone AS businessPhone, payment_details AS paymentDetails,
  default_currency AS defaultCurrency, default_tax_rate_bp AS defaultTaxRateBp, tax_label AS taxLabel,
  invoice_prefix AS invoicePrefix, default_due_days AS defaultDueDays, default_notes AS defaultNotes`;

export function getSettings(): Settings {
  return one<Settings>(`SELECT ${SETTINGS_COLS} FROM settings WHERE id = 1`)!;
}

export function updateSettings(s: Settings): void {
  run(
    `UPDATE settings SET business_name = ?, business_address = ?, business_email = ?, business_phone = ?,
       payment_details = ?, default_currency = ?, default_tax_rate_bp = ?, tax_label = ?, invoice_prefix = ?,
       default_due_days = ?, default_notes = ? WHERE id = 1`,
    s.businessName, s.businessAddress, s.businessEmail, s.businessPhone, s.paymentDetails, s.defaultCurrency,
    s.defaultTaxRateBp, s.taxLabel, s.invoicePrefix, s.defaultDueDays, s.defaultNotes,
  );
}

// Clients

const CLIENT_COLS = "id, name, company, address, email, phone";

export function listClients(): Client[] {
  return many<Client>(`SELECT ${CLIENT_COLS} FROM clients ORDER BY name COLLATE NOCASE, id`);
}

export function createClient(input: ClientInput): number {
  return run(
    "INSERT INTO clients (name, company, address, email, phone) VALUES (?, ?, ?, ?, ?)",
    input.name, input.company, input.address, input.email, input.phone,
  ).id;
}

export function updateClient(id: number, input: ClientInput): boolean {
  return (
    run(
      "UPDATE clients SET name = ?, company = ?, address = ?, email = ?, phone = ? WHERE id = ?",
      input.name, input.company, input.address, input.email, input.phone, id,
    ).changes > 0
  );
}

export function deleteClient(id: number): boolean {
  return transaction(() => {
    if (one("SELECT 1 FROM projects WHERE client_id = ? LIMIT 1", id)) {
      throw new ProjectConflictError("clientId", "This client has projects. Keep the client to preserve their project history.");
    }
    return run("DELETE FROM clients WHERE id = ?", id).changes > 0;
  });
}

// Invoices

const INVOICE_COLS = `id, number, client_id AS clientId, bill_to_name AS billToName, bill_to_company AS billToCompany,
  bill_to_address AS billToAddress, issue_date AS issueDate, due_date AS dueDate, currency, tax_rate_bp AS taxRateBp,
  discount_type AS discountType, discount_value AS discountValue, discount_amount AS discountAmount,
  dp_type AS downPaymentType, dp_value AS downPaymentValue,
  status, subtotal, tax_amount AS taxAmount, total, notes, paid_at AS paidAt`;

// Payments and write-offs together, and payments alone, for the invoice in the enclosing query.
const SETTLED = "COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = invoices.id), 0)";
const PAID = "COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = invoices.id AND kind = 'payment'), 0)";

const ROW_COLS = `id, number, bill_to_name AS billToName, bill_to_company AS billToCompany, issue_date AS issueDate,
  due_date AS dueDate, currency, total, ${PAID} AS paid, total - ${SETTLED} AS balance, status`;

export function listInvoices(filter: InvoiceFilter, todayDate: string, limit = 1000): InvoiceRow[] {
  const where: string[] = [];
  const args: Arg[] = [];
  if (filter.status === "draft" || filter.status === "paid") {
    where.push("status = ?");
    args.push(filter.status);
  } else if (filter.status === "sent") {
    where.push("status = 'sent' AND due_date >= ?");
    args.push(todayDate);
  } else if (filter.status === "overdue") {
    where.push("status = 'sent' AND due_date < ?");
    args.push(todayDate);
  }
  const q = filter.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(
      "(number LIKE ? ESCAPE '\\' OR bill_to_name LIKE ? ESCAPE '\\' OR bill_to_company LIKE ? ESCAPE '\\')",
    );
    args.push(like, like, like);
  }
  const rows = many<Omit<InvoiceRow, "display">>(
    `SELECT ${ROW_COLS} FROM invoices ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY issue_date DESC, id DESC LIMIT ?`,
    ...args,
    limit,
  );
  return rows.map((row) => ({ ...row, display: displayStatus(row.status, row.dueDate, todayDate, row.paid) }));
}

export function getInvoice(id: number): Invoice | null {
  const invoice = one<Omit<Invoice, "items" | "payments" | "paid" | "balance">>(
    `SELECT ${INVOICE_COLS} FROM invoices WHERE id = ?`,
    id,
  );
  if (!invoice) return null;
  const items = many<ItemInput>(
    "SELECT description, qty, unit_price AS unitPrice, notes FROM invoice_items WHERE invoice_id = ? ORDER BY position",
    id,
  );
  const payments = many<Payment>(
    "SELECT id, paid_on AS paidOn, amount, kind, note FROM payments WHERE invoice_id = ? ORDER BY paid_on, id",
    id,
  );
  let paid = 0;
  let settled = 0;
  for (const payment of payments) {
    settled += payment.amount;
    if (payment.kind === "payment") paid += payment.amount;
  }
  return { ...invoice, items, payments, paid, balance: invoice.total - settled };
}

/**
 * Sets a sent or paid invoice to paid when payments and write-offs cover its total (paid on the
 * latest of their dates), and to sent while something is owed. Runs inside the caller's transaction.
 * A zero total with nothing settled keeps its status: such an invoice cannot take payments.
 */
function settle(id: number): void {
  const invoice = one<{ status: Status; total: number; settled: number; lastPaidOn: string | null }>(
    `SELECT status, total, ${SETTLED} AS settled,
       (SELECT MAX(paid_on) FROM payments WHERE invoice_id = invoices.id) AS lastPaidOn
     FROM invoices WHERE id = ?`,
    id,
  );
  if (!invoice || invoice.status === "draft") return;
  if (invoice.settled > 0 && invoice.settled >= invoice.total) {
    run("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?", invoice.lastPaidOn, id);
  } else if (invoice.settled < invoice.total) {
    run("UPDATE invoices SET status = 'sent', paid_at = NULL WHERE id = ?", id);
  }
}

/**
 * Creates (id null) or updates an invoice. Throws RangeError for an unstorable total, NotFoundError for
 * a missing id, and PaymentConflictError for an edit that recorded payments do not allow.
 */
export function saveInvoice(id: number | null, input: InvoiceInput): number {
  const totals = invoiceTotals(input.items, input.taxRateBp, { type: input.discountType, value: input.discountValue });
  return transaction(() => {
    // The client may have been deleted while the form was open.
    const clientId =
      input.clientId !== null && one("SELECT 1 AS found FROM clients WHERE id = ?", input.clientId)
        ? input.clientId
        : null;
    const fields: Arg[] = [
      clientId, input.billToName, input.billToCompany, input.billToAddress, input.issueDate, input.dueDate,
      input.currency, input.taxRateBp, input.discountType, input.discountValue, input.downPaymentType,
      input.downPaymentValue, input.notes, totals.subtotal, totals.discountAmount, totals.taxAmount, totals.total,
    ];
    let invoiceId: number;
    if (id === null) {
      invoiceId = run(
        `INSERT INTO invoices (client_id, bill_to_name, bill_to_company, bill_to_address, issue_date, due_date,
           currency, tax_rate_bp, discount_type, discount_value, dp_type, dp_value, notes, subtotal,
           discount_amount, tax_amount, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...fields,
      ).id;
    } else {
      const current = one<{ currency: Currency; settled: number }>(
        `SELECT currency, ${SETTLED} AS settled FROM invoices WHERE id = ?`,
        id,
      );
      if (!current) throw new NotFoundError(`Invoice ${id} does not exist`);
      // Payments are stored in the invoice currency, so they would mean something else after a change.
      if (current.settled > 0 && input.currency !== current.currency) {
        throw new PaymentConflictError("currency", "The currency cannot change once payments are recorded.");
      }
      if (totals.total < current.settled) {
        throw new PaymentConflictError(
          "items",
          `Payments already cover ${formatMoney(current.settled, current.currency)}; remove one first, or keep the total at least that much.`,
        );
      }
      run(
        `UPDATE invoices SET client_id = ?, bill_to_name = ?, bill_to_company = ?, bill_to_address = ?,
           issue_date = ?, due_date = ?, currency = ?, tax_rate_bp = ?, discount_type = ?, discount_value = ?,
           dp_type = ?, dp_value = ?, notes = ?, subtotal = ?, discount_amount = ?, tax_amount = ?, total = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
        ...fields,
        id,
      );
      run("DELETE FROM invoice_items WHERE invoice_id = ?", id);
      invoiceId = id;
    }
    input.items.forEach((item, position) => {
      run(
        "INSERT INTO invoice_items (invoice_id, position, description, qty, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?)",
        invoiceId, position, item.description, item.qty, item.unitPrice, item.notes,
      );
    });
    settle(invoiceId);
    return invoiceId;
  });
}

/** The next number in sequence for the invoice's issue year. Null when the invoice does not exist. */
export function suggestNumber(id: number): string | null {
  const invoice = one<{ issueDate: string }>("SELECT issue_date AS issueDate FROM invoices WHERE id = ?", id);
  if (!invoice) return null;
  const { invoicePrefix } = getSettings();
  const year = invoice.issueDate.slice(0, 4);
  // The prefix is letters and digits only (see schemas.ts), so it needs no LIKE escaping.
  const numbers = many<{ number: string }>(
    "SELECT number FROM invoices WHERE number LIKE ?",
    `${invoicePrefix}-${year}-%`,
  ).map((row) => row.number);
  return formatNumber(invoicePrefix, year, nextSequence(numbers, invoicePrefix, year));
}

type StatusRow = { status: Status; number: string | null };

function statusOf(id: number): StatusRow | undefined {
  return one<StatusRow>("SELECT status, number FROM invoices WHERE id = ?", id);
}

/** Marks a draft sent. Assigns `number` unless the invoice already has one; a number never changes. */
export function markSent(id: number, number: string): Result {
  return transaction((): Result => {
    const invoice = statusOf(id);
    if (!invoice) return { ok: false, error: "This invoice no longer exists." };
    if (invoice.status !== "draft") return { ok: false, error: "Only a draft can be marked sent." };
    const final = invoice.number ?? number;
    // Letter case is ignored, so "inv-2026-001" cannot sit beside "INV-2026-001".
    if (one("SELECT 1 AS found FROM invoices WHERE number = ? COLLATE NOCASE AND id <> ?", final, id)) {
      return { ok: false, error: `Number ${final} is already used by another invoice.` };
    }
    run("UPDATE invoices SET status = 'sent', number = ?, updated_at = datetime('now') WHERE id = ?", final, id);
    return { ok: true };
  });
}

/**
 * Records a payment on a sent invoice whose currency is `currency`. Refuses an amount above the balance, and,
 * when `shownBalance` is given, a balance that has changed since it was shown to the person paying.
 */
export function recordPayment(id: number, currency: Currency, input: PaymentInput, shownBalance?: number): Result {
  return transaction((): Result => {
    const invoice = one<{ status: Status; currency: Currency; balance: number; writeOffs: number }>(
      `SELECT status, currency, total - ${SETTLED} AS balance,
         (SELECT COUNT(*) FROM payments WHERE invoice_id = invoices.id AND kind = 'write_off') AS writeOffs
       FROM invoices WHERE id = ?`,
      id,
    );
    if (!invoice) return { ok: false, error: "This invoice no longer exists." };
    if (invoice.status !== "sent") return { ok: false, error: "Payments can only be recorded on a sent invoice." };
    // The amount was read in this currency, and any write-off worked out from the shown balance;
    // after a change in another tab either would mean something else.
    if (invoice.currency !== currency || (shownBalance !== undefined && shownBalance !== invoice.balance)) {
      return { ok: false, error: "The invoice changed while this was open. Reload and try again." };
    }
    if (input.amount > invoice.balance) {
      return { ok: false, error: `That is more than the ${formatMoney(invoice.balance, currency)} still owed.` };
    }
    const rest = invoice.balance - input.amount;
    if (input.writeOff && rest === 0) return { ok: false, error: "Nothing is left to write off." };
    if (input.writeOff && invoice.writeOffs > 0) return { ok: false, error: "This invoice already has a write-off." };
    run(
      "INSERT INTO payments (invoice_id, paid_on, amount, kind, note) VALUES (?, ?, ?, 'payment', ?)",
      id, input.paidOn, input.amount, input.note,
    );
    if (input.writeOff) {
      run("INSERT INTO payments (invoice_id, paid_on, amount, kind) VALUES (?, ?, ?, 'write_off')", id, input.paidOn, rest);
    }
    settle(id);
    run("UPDATE invoices SET updated_at = datetime('now') WHERE id = ?", id);
    return { ok: true };
  });
}

/** Removes one payment or write-off and works out the status again. False when there is no such payment. */
export function removePayment(invoiceId: number, paymentId: number): boolean {
  return transaction(() => {
    if (run("DELETE FROM payments WHERE id = ? AND invoice_id = ?", paymentId, invoiceId).changes === 0) return false;
    settle(invoiceId);
    run("UPDATE invoices SET updated_at = datetime('now') WHERE id = ?", invoiceId);
    return true;
  });
}

/** Sends a sent invoice back to draft while nothing is recorded against it. The number is kept. */
export function revertToDraft(id: number): Result {
  return transaction((): Result => {
    const invoice = statusOf(id);
    if (!invoice) return { ok: false, error: "This invoice no longer exists." };
    if (invoice.status !== "sent") return { ok: false, error: "Only a sent invoice can go back to draft." };
    if (one("SELECT 1 AS found FROM payments WHERE invoice_id = ?", id)) {
      return { ok: false, error: "Remove its payments before sending it back to draft." };
    }
    run("UPDATE invoices SET status = 'draft', updated_at = datetime('now') WHERE id = ?", id);
    return { ok: true };
  });
}

/** A new unnumbered draft with the same content, issued today. Null when the source does not exist. */
export function duplicateInvoice(id: number, todayDate: string): number | null {
  const source = getInvoice(id);
  if (!source) return null;
  const { defaultDueDays } = getSettings();
  return saveInvoice(null, {
    clientId: source.clientId,
    billToName: source.billToName,
    billToCompany: source.billToCompany,
    billToAddress: source.billToAddress,
    issueDate: todayDate,
    dueDate: addDays(todayDate, defaultDueDays),
    currency: source.currency,
    taxRateBp: source.taxRateBp,
    discountType: source.discountType,
    discountValue: source.discountValue,
    downPaymentType: source.downPaymentType,
    downPaymentValue: source.downPaymentValue,
    notes: source.notes,
    items: source.items,
  });
}

/** Deletes an invoice in any status, with its items. Its number may then be reused or leave a gap. */
export function deleteInvoice(id: number): boolean {
  return run("DELETE FROM invoices WHERE id = ?", id).changes > 0;
}

// Sums are capped at the largest integer a JavaScript number holds exactly; node:sqlite
// refuses to return anything larger, which would take the dashboard down.
const CEILING = Number.MAX_SAFE_INTEGER;

export function dashboard(todayDate: string): { summaries: CurrencySummary[]; latest: InvoiceRow[] } {
  const summaries = many<CurrencySummary>(
    `SELECT currency,
       MIN(COALESCE(SUM(CASE WHEN status = 'sent' THEN total - settled END), 0), ${CEILING}) AS outstanding,
       MIN(COALESCE(SUM(CASE WHEN status = 'sent' AND due_date < ? THEN total - settled END), 0), ${CEILING})
         AS overdue,
       MIN(COALESCE(SUM(received), 0), ${CEILING}) AS paidThisMonth
     FROM (SELECT currency, status, due_date, total, ${SETTLED} AS settled,
             COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = invoices.id AND kind = 'payment'
               AND substr(paid_on, 1, 7) = ?), 0) AS received
           FROM invoices)
     GROUP BY currency ORDER BY currency`,
    todayDate,
    todayDate.slice(0, 7),
  );
  return { summaries, latest: listInvoices({}, todayDate, 10) };
}
