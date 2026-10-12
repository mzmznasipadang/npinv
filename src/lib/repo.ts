import { getDb, transaction } from "./db.ts";
import { invoiceTotals } from "./money.ts";
import type { Currency } from "./money.ts";
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
  notes: string;
  items: ItemInput[];
};

export type Invoice = InvoiceInput & {
  id: number;
  number: string | null;
  status: Status;
  subtotal: number;
  taxAmount: number;
  total: number;
  paidAt: string | null;
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
  status: Status;
  display: DisplayStatus;
};

export type InvoiceFilter = { status?: DisplayStatus | "all"; q?: string };
export type CurrencySummary = { currency: Currency; outstanding: number; overdue: number; paidThisMonth: number };
export type Result = { ok: true } | { ok: false; error: string };

export class NotFoundError extends Error {}

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
  return run("DELETE FROM clients WHERE id = ?", id).changes > 0;
}

// Invoices

const INVOICE_COLS = `id, number, client_id AS clientId, bill_to_name AS billToName, bill_to_company AS billToCompany,
  bill_to_address AS billToAddress, issue_date AS issueDate, due_date AS dueDate, currency, tax_rate_bp AS taxRateBp,
  status, subtotal, tax_amount AS taxAmount, total, notes, paid_at AS paidAt`;

const ROW_COLS = `id, number, bill_to_name AS billToName, bill_to_company AS billToCompany, issue_date AS issueDate,
  due_date AS dueDate, currency, total, status`;

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
  return rows.map((row) => ({ ...row, display: displayStatus(row.status, row.dueDate, todayDate) }));
}

export function getInvoice(id: number): Invoice | null {
  const invoice = one<Omit<Invoice, "items">>(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = ?`, id);
  if (!invoice) return null;
  const items = many<ItemInput>(
    "SELECT description, qty, unit_price AS unitPrice, notes FROM invoice_items WHERE invoice_id = ? ORDER BY position",
    id,
  );
  return { ...invoice, items };
}

/** Creates (id null) or updates an invoice. Throws RangeError for an unstorable total, NotFoundError for a missing id. */
export function saveInvoice(id: number | null, input: InvoiceInput): number {
  const totals = invoiceTotals(input.items, input.taxRateBp);
  return transaction(() => {
    // The client may have been deleted while the form was open.
    const clientId =
      input.clientId !== null && one("SELECT 1 AS found FROM clients WHERE id = ?", input.clientId)
        ? input.clientId
        : null;
    const fields: Arg[] = [
      clientId, input.billToName, input.billToCompany, input.billToAddress, input.issueDate, input.dueDate,
      input.currency, input.taxRateBp, input.notes, totals.subtotal, totals.taxAmount, totals.total,
    ];
    let invoiceId: number;
    if (id === null) {
      invoiceId = run(
        `INSERT INTO invoices (client_id, bill_to_name, bill_to_company, bill_to_address, issue_date, due_date,
           currency, tax_rate_bp, notes, subtotal, tax_amount, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...fields,
      ).id;
    } else {
      const { changes } = run(
        `UPDATE invoices SET client_id = ?, bill_to_name = ?, bill_to_company = ?, bill_to_address = ?,
           issue_date = ?, due_date = ?, currency = ?, tax_rate_bp = ?, notes = ?, subtotal = ?, tax_amount = ?,
           total = ?, updated_at = datetime('now') WHERE id = ?`,
        ...fields,
        id,
      );
      if (changes === 0) throw new NotFoundError(`Invoice ${id} does not exist`);
      run("DELETE FROM invoice_items WHERE invoice_id = ?", id);
      invoiceId = id;
    }
    input.items.forEach((item, position) => {
      run(
        "INSERT INTO invoice_items (invoice_id, position, description, qty, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?)",
        invoiceId, position, item.description, item.qty, item.unitPrice, item.notes,
      );
    });
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
    if (one("SELECT 1 AS found FROM invoices WHERE number = ? AND id <> ?", final, id)) {
      return { ok: false, error: `Number ${final} is already used by another invoice.` };
    }
    run("UPDATE invoices SET status = 'sent', number = ?, updated_at = datetime('now') WHERE id = ?", final, id);
    return { ok: true };
  });
}

export function markPaid(id: number, paidAt: string): Result {
  return transaction((): Result => {
    const invoice = statusOf(id);
    if (!invoice) return { ok: false, error: "This invoice no longer exists." };
    if (invoice.status !== "sent") return { ok: false, error: "Only a sent invoice can be marked paid." };
    run("UPDATE invoices SET status = 'paid', paid_at = ?, updated_at = datetime('now') WHERE id = ?", paidAt, id);
    return { ok: true };
  });
}

/** One step back: paid to sent, or sent to draft. The number is kept. */
export function undoStatus(id: number): Result {
  return transaction((): Result => {
    const invoice = statusOf(id);
    if (!invoice) return { ok: false, error: "This invoice no longer exists." };
    if (invoice.status === "draft") return { ok: false, error: "A draft has nothing to undo." };
    const previous: Status = invoice.status === "paid" ? "sent" : "draft";
    run(
      "UPDATE invoices SET status = ?, paid_at = NULL, updated_at = datetime('now') WHERE id = ?",
      previous,
      id,
    );
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
    notes: source.notes,
    items: source.items,
  });
}

/** Only a draft that was never numbered can be deleted. */
export function deleteInvoice(id: number): boolean {
  return run("DELETE FROM invoices WHERE id = ? AND status = 'draft' AND number IS NULL", id).changes > 0;
}

export function dashboard(todayDate: string): { summaries: CurrencySummary[]; latest: InvoiceRow[] } {
  const summaries = many<CurrencySummary>(
    `SELECT currency,
       COALESCE(SUM(CASE WHEN status = 'sent' THEN total END), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN status = 'sent' AND due_date < ? THEN total END), 0) AS overdue,
       COALESCE(SUM(CASE WHEN status = 'paid' AND substr(paid_at, 1, 7) = ? THEN total END), 0) AS paidThisMonth
     FROM invoices GROUP BY currency ORDER BY currency`,
    todayDate,
    todayDate.slice(0, 7),
  );
  return { summaries, latest: listInvoices({}, todayDate, 10) };
}
