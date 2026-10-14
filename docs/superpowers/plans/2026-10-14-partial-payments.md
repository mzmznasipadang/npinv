# Partial Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record full payments, down payments, instalments and written-off short payments on an invoice, derive its status and balance from them, show them on the dashboard and the invoice list, and print three versions of the invoice.

**Architecture:** A new `payments` table (schema version 3) holds each payment or write-off. The repository derives an invoice's `status`, `paid_at`, `paid` and `balance` from it in one `settle` step that runs after every payment change and every save. Pure helpers (`money`, `rules`) and the repository are tested with `node --test`; the UI reads through the repository and writes through Server Actions, as today.

**Tech Stack:** Next.js 16.4.0 (App Router, Server Actions), React 19.3.0, TypeScript, zod 4.6.6, SQLite via `node:sqlite`, shadcn/ui, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-14-partial-payments-design.md` (extends `docs/superpowers/specs/2026-10-12-npinv-design.md`; where they differ, the partial payments spec wins).

## Global Constraints

- Money is integers in the smallest unit (whole rupiah, cents). No floating-point arithmetic on amounts.
- Currencies are `IDR` and `USD` only. Amounts in different currencies are never added together.
- "Today" and "this month" use `Asia/Jakarta` (`today()` in `src/lib/rules.ts`).
- Database: SQLite through `node:sqlite`, plain SQL, no ORM. Schema changes are new migration steps only. Never edit the text of an earlier step (`SCHEMA`, `DISCOUNT`).
- Every Server Action validates its input with zod or explicit checks before touching the database. Arguments from the client are untrusted, including ids.
- Files loaded by `node --test` (everything in `src/lib/` except `actions.ts`, `auth-actions.ts`) import each other with explicit `.ts` extensions and use `import type` for types. Node strips types without transforming, so only erasable TypeScript is allowed there: no parameter properties, no enums, no namespaces.
- User-facing words, exactly: "Record payment", "Part paid", "Paid so far", "Balance due", "Written off", "Write off the remaining …", "Ask for a down payment", "Down payment due", "Full invoice", "With payments", "Down payment request".
- `npm test` must pass at the end of every task. `npx tsc --noEmit`, `npm run lint` and `npm run build` must pass from the end of Task 7 onward; Tasks 4–6 change types the UI only catches up with in Task 7.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Next.js 16.4 differs from older versions. Before writing framework code not shown in this plan, read the matching guide in `node_modules/next/dist/docs/`.
- The live app holds real invoices. Never record or remove a payment, mark an invoice sent, or delete one on live. Anything that connects to the server over SSH (backup, deploy, checks) is run by Victor or with his explicit approval in the session.

## Review Focus

Each line names a condition the spec implies but does not spell out, and the task whose tests pin it.

1. **Deleting an invoice that has payments.** Expected: its payments go with it and the dashboard no longer counts them. Pinned in Task 4 ("an invoice in any status can be deleted, with its items and payments").
2. **Duplicating a paid or part-paid invoice.** Expected: the copy is a draft with the same down payment request, no payments, and its full total owed. Pinned in Task 4 ("duplicate makes an unnumbered draft …").
3. **A zero-total invoice** (100% discount). Expected: it cannot take a payment; an old one already marked paid stays paid when saved. Pinned in Task 4 ("a zero-total invoice cannot take payments …").
4. **A `version` address parameter that is repeated, unknown, or names a version the invoice does not have.** Expected: the default version prints, with no error. Pinned in Task 3 (`printVersions` tests).
5. **A payment entered from a page whose balance is stale** (a second tab, or Next keeping an old page mounted). Expected: the server refuses an overpayment and writes nothing. Pinned in Task 4 ("a payment above the balance … is refused").

## File Structure

| Path | Change |
|---|---|
| `src/lib/money.ts` | `Discount` becomes `Portion`; shared `portionOf`; new `downPaymentAmount`. |
| `src/lib/db.ts` | `PAYMENTS` step, `STEPS` list, exported `migrate(db, target)`. |
| `src/lib/db.test.ts` | New: migration tests. |
| `src/lib/rules.ts` | `displayStatus` learns `partial`; new `printVersions`. |
| `src/lib/repo.ts` | Payment types and functions, `settle`, save guards, down payment storage, balances on rows, dashboard. `markPaid` and `undoStatus` go; `revertToDraft` arrives. |
| `src/lib/schemas.ts` | Down payment fields; `parsePaymentForm`. |
| `src/lib/invoice-form.ts` | Down payment form values; `blankPaymentValues`. |
| `src/lib/actions.ts` | `recordPaymentAction`, `removePaymentAction`, `revertToDraftAction`; `markPaidAction` and `undoStatusAction` go. |
| `src/components/status-badge.tsx` | "Part paid" badge. |
| `src/components/invoice-form.tsx` | Down payment controls and Totals line; a `payments` slot. |
| `src/components/invoice-status-actions.tsx` | Record payment dialog; Mark unpaid goes; Revert to draft only without payments. |
| `src/components/payments-card.tsx` | New: the Payments card. |
| `src/components/invoice-table.tsx` | Balance under a part-paid total. |
| `src/app/(app)/invoices/[id]/page.tsx` | Passes balance, currency and payments through. |
| `src/app/(app)/page.tsx` | New tile hints. |
| `src/app/(print)/invoices/[id]/print/page.tsx`, `print-toolbar.tsx`, `print.css` | Version picker and the two extra totals blocks. |
| `docs/superpowers/specs/2026-10-12-npinv-design.md` | Points at the partial payments spec. |

---

### Task 1: Shared percentage-or-amount and the down payment amount

**Files:**
- Modify: `src/lib/money.ts`
- Modify: `src/lib/repo.ts` (type import only)
- Modify: `src/components/invoice-form.tsx` (type import only)
- Test: `src/lib/money.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type Portion = { type: "percent" | "amount"; value: number }` (replaces `Discount`); `export function downPaymentAmount(total: number, downPayment: Portion): number` (throws `RangeError` when above the total). `invoiceTotals(lines, taxRateBp, discount?: Portion)` keeps its behaviour.

- [ ] **Step 1: Write the failing tests**

In `src/lib/money.test.ts`, add `downPaymentAmount` to the import list:

```ts
import {
  amountToInput,
  downPaymentAmount,
  formatMoney,
  invoiceTotals,
  lineTotal,
  parseAmount,
  parsePercent,
  percentToInput,
} from "./money.ts";
```

Append:

```ts
test("a down payment is a share of the total rounded half up, or a fixed amount", () => {
  assert.equal(downPaymentAmount(1_110_000, { type: "percent", value: 5000 }), 555_000);
  assert.equal(downPaymentAmount(101, { type: "percent", value: 5000 }), 51); // 50.5 -> 51
  assert.equal(downPaymentAmount(100, { type: "percent", value: 3333 }), 33); // 33.33 -> 33
  assert.equal(downPaymentAmount(1_110_000, { type: "percent", value: 10000 }), 1_110_000);
  assert.equal(downPaymentAmount(1_110_000, { type: "amount", value: 500_000 }), 500_000);
});

test("a fixed down payment above the total throws RangeError", () => {
  assert.equal(downPaymentAmount(100, { type: "amount", value: 100 }), 100);
  assert.throws(() => downPaymentAmount(100, { type: "amount", value: 101 }), RangeError);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `DATABASE_PATH=:memory: node --test src/lib/money.test.ts`
Expected: FAIL, `SyntaxError: The requested module './money.ts' does not provide an export named 'downPaymentAmount'`.

- [ ] **Step 3: Implement**

In `src/lib/money.ts`, replace:

```ts
/** A percentage in basis points, or a fixed amount in the smallest unit. */
export type Discount = { type: "percent" | "amount"; value: number };
export type Totals = { subtotal: number; discountAmount: number; taxAmount: number; total: number };

const NO_DISCOUNT: Discount = { type: "percent", value: 0 };
```

with:

```ts
/** A percentage in basis points, or a fixed amount in the smallest unit. Used for discounts and down payments. */
export type Portion = { type: "percent" | "amount"; value: number };
export type Totals = { subtotal: number; discountAmount: number; taxAmount: number; total: number };

const NONE: Portion = { type: "percent", value: 0 };

/** `portion` of `base`: a percentage rounded half up, or the fixed amount. */
function portionOf(base: bigint, portion: Portion): bigint {
  return portion.type === "percent" ? (base * BigInt(portion.value) + 5000n) / 10000n : BigInt(portion.value);
}
```

In `invoiceTotals`, change the signature and the discount line:

```ts
export function invoiceTotals(lines: readonly Line[], taxRateBp: number, discount: Portion = NONE): Totals {
  let subtotal = 0n;
  for (const line of lines) subtotal += BigInt(line.qty) * BigInt(line.unitPrice);
  const discountAmount = portionOf(subtotal, discount);
```

(the rest of the function is unchanged). Directly after `invoiceTotals`, add:

```ts
/** The down payment asked for on an invoice of `total`. Throws RangeError when it is above the total. */
export function downPaymentAmount(total: number, downPayment: Portion): number {
  const amount = portionOf(BigInt(total), downPayment);
  if (amount > BigInt(total)) throw new RangeError("Down payment is larger than the total");
  return Number(amount);
}
```

In `src/lib/repo.ts`, change `import type { Currency, Discount } from "./money.ts";` to `import type { Currency, Portion } from "./money.ts";` and `discountType: Discount["type"];` to `discountType: Portion["type"];`.

In `src/components/invoice-form.tsx`, change `import type { Currency, Discount, Line, Totals } from "@/lib/money";` to `import type { Currency, Line, Portion, Totals } from "@/lib/money";` and `const type: Discount["type"] =` to `const type: Portion["type"] =`.

- [ ] **Step 4: Run all checks**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests pass (the two new ones included), no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts src/lib/repo.ts src/components/invoice-form.tsx
git commit -m "Share percentage-or-amount maths; add the down payment amount

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema version 3

**Files:**
- Modify: `src/lib/db.ts`
- Create: `src/lib/db.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function migrate(db: DatabaseSync, target?: number): void`. After it runs to the latest version (3) there is a `payments` table (`id`, `invoice_id`, `paid_on`, `amount`, `kind` `'payment' | 'write_off'`, `note`, `created_at`) and `invoices.dp_type` (`'percent' | 'amount'`), `invoices.dp_value` (integer, 0 = none).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/db.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.ts";

function version(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function rows(db: DatabaseSync, sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all().map((row) => ({ ...row }));
}

test("upgrading from version 2 turns each paid invoice into one full payment and changes nothing else", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, 2);
  assert.equal(version(db), 2);
  db.exec(`INSERT INTO invoices (id, number, bill_to_name, issue_date, due_date, currency, status, subtotal, total, paid_at)
    VALUES
      (1, 'INV-2026-001', 'Paid', '2026-10-01', '2026-10-15', 'IDR', 'paid', 1000000, 1000000, '2026-10-05'),
      (2, 'INV-2026-002', 'Sent', '2026-10-01', '2026-10-15', 'IDR', 'sent', 500000, 500000, NULL),
      (3, NULL, 'Draft', '2026-10-01', '2026-10-15', 'USD', 'draft', 100, 100, NULL),
      (4, 'INV-2026-003', 'Free', '2026-10-01', '2026-10-15', 'IDR', 'paid', 0, 0, '2026-10-06')`);

  migrate(db);

  assert.equal(version(db), 3);
  assert.deepEqual(rows(db, "SELECT invoice_id AS invoiceId, paid_on AS paidOn, amount, kind, note FROM payments"), [
    { invoiceId: 1, paidOn: "2026-10-05", amount: 1_000_000, kind: "payment", note: "" },
  ]);
  assert.deepEqual(
    rows(db, "SELECT id, status, total, paid_at AS paidAt, dp_type AS dpType, dp_value AS dpValue FROM invoices ORDER BY id"),
    [
      { id: 1, status: "paid", total: 1_000_000, paidAt: "2026-10-05", dpType: "percent", dpValue: 0 },
      { id: 2, status: "sent", total: 500_000, paidAt: null, dpType: "percent", dpValue: 0 },
      { id: 3, status: "draft", total: 100, paidAt: null, dpType: "percent", dpValue: 0 },
      { id: 4, status: "paid", total: 0, paidAt: "2026-10-06", dpType: "percent", dpValue: 0 },
    ],
  );
});

test("a paid invoice with no paid date gets its issue date", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, 2);
  db.exec(`INSERT INTO invoices (bill_to_name, issue_date, due_date, currency, status, total)
    VALUES ('Old', '2026-09-01', '2026-09-15', 'IDR', 'paid', 700)`);
  migrate(db);
  assert.deepEqual(rows(db, "SELECT paid_on AS paidOn, amount FROM payments"), [{ paidOn: "2026-09-01", amount: 700 }]);
});

test("migrating an up-to-date database changes nothing", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  migrate(db);
  assert.equal(version(db), 3);
});

test("a step that fails leaves the database at its old version", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, 2);
  db.exec("CREATE TABLE payments (x INTEGER)"); // makes the version 3 step fail
  assert.throws(() => migrate(db));
  assert.equal(version(db), 2);
  const columns = rows(db, "PRAGMA table_info(invoices)").map((column) => column.name);
  assert.ok(!columns.includes("dp_type"));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `DATABASE_PATH=:memory: node --test src/lib/db.test.ts`
Expected: FAIL, `does not provide an export named 'migrate'`.

- [ ] **Step 3: Implement**

In `src/lib/db.ts`, directly after the `DISCOUNT` constant, add:

```ts
// Version 3: payments, and a down payment request per invoice. Every paid invoice becomes one
// payment of its full total, so its status and the dashboard read the same as before.
const PAYMENTS = `
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  paid_on TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'write_off')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX payments_invoice ON payments (invoice_id, paid_on);
ALTER TABLE invoices ADD COLUMN dp_type TEXT NOT NULL DEFAULT 'percent' CHECK (dp_type IN ('percent', 'amount'));
ALTER TABLE invoices ADD COLUMN dp_value INTEGER NOT NULL DEFAULT 0
  CHECK (dp_value >= 0 AND (dp_type = 'amount' OR dp_value <= 10000));
INSERT INTO payments (invoice_id, paid_on, amount)
  SELECT id, COALESCE(paid_at, issue_date), total FROM invoices WHERE status = 'paid' AND total > 0;
`;

// Step i takes the database from version i to version i + 1.
const STEPS = [SCHEMA, DISCOUNT, PAYMENTS];

/** Brings the database up to `target`, the latest version by default. */
export function migrate(db: DatabaseSync, target = STEPS.length): void {
  // The version check and the steps run in one write transaction, so two
  // processes starting together cannot both apply them, and a failed step changes nothing.
  db.exec("BEGIN IMMEDIATE");
  try {
    const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let step = version; step < target; step++) db.exec(`${STEPS[step]} PRAGMA user_version = ${step + 1};`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
```

Replace the body of `open()` with:

```ts
function open(): DatabaseSync {
  const path = process.env.DATABASE_PATH ?? "data/npinv.db";
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass, including the four new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "Add schema version 3: payments and down payment columns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Part paid status and print versions

**Files:**
- Modify: `src/lib/rules.ts`
- Modify: `src/components/status-badge.tsx`
- Test: `src/lib/rules.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export type DisplayStatus = Status | "overdue" | "partial"`
  - `export function displayStatus(status: Status, dueDate: string, todayDate: string, paid?: number): DisplayStatus`. `paid` is money received in the smallest unit, default 0.
  - `export type PrintVersion = "full" | "payments" | "dp"`
  - `export function printVersions(hasPayments: boolean, hasDownPayment: boolean, asked: unknown): { versions: PrintVersion[]; version: PrintVersion }`

- [ ] **Step 1: Write the failing tests**

In `src/lib/rules.test.ts`, add `printVersions` to the import list, then append:

```ts
test("a sent invoice with money received is part paid, unless it is overdue", () => {
  assert.equal(displayStatus("sent", "2026-10-13", "2026-10-12", 500), "partial");
  assert.equal(displayStatus("sent", "2026-10-12", "2026-10-12", 500), "partial"); // due today
  assert.equal(displayStatus("sent", "2026-10-11", "2026-10-12", 500), "overdue");
  assert.equal(displayStatus("sent", "2026-10-13", "2026-10-12", 0), "sent");
  assert.equal(displayStatus("paid", "2026-10-13", "2026-10-12", 500), "paid");
});

test("the print version falls back to payments, then the down payment request, then the full invoice", () => {
  assert.deepEqual(printVersions(false, false, undefined), { versions: ["full"], version: "full" });
  assert.deepEqual(printVersions(true, true, undefined), { versions: ["full", "payments", "dp"], version: "payments" });
  assert.deepEqual(printVersions(false, true, undefined), { versions: ["full", "dp"], version: "dp" });
  assert.deepEqual(printVersions(true, false, "full"), { versions: ["full", "payments"], version: "full" });
  assert.deepEqual(printVersions(true, true, "dp"), { versions: ["full", "payments", "dp"], version: "dp" });
});

test("a print version that is unknown, repeated or not available falls back", () => {
  assert.equal(printVersions(false, true, "bogus").version, "dp");
  assert.equal(printVersions(false, true, "payments").version, "dp"); // no payments yet
  assert.equal(printVersions(true, false, ["full", "payments"]).version, "payments"); // ?version=a&version=b
  assert.equal(printVersions(false, false, "dp").version, "full");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `DATABASE_PATH=:memory: node --test src/lib/rules.test.ts`
Expected: FAIL, `does not provide an export named 'printVersions'`.

- [ ] **Step 3: Implement**

In `src/lib/rules.ts`, replace:

```ts
export type DisplayStatus = Status | "overdue";
```

with:

```ts
export type DisplayStatus = Status | "overdue" | "partial";
export type PrintVersion = "full" | "payments" | "dp";
```

Replace the whole `displayStatus` function, comment included, with:

```ts
/**
 * Overdue means sent and due before today; due today is not overdue. Otherwise a sent
 * invoice with money already received (`paid`, in the smallest unit) is part paid.
 */
export function displayStatus(status: Status, dueDate: string, todayDate: string, paid = 0): DisplayStatus {
  if (status !== "sent") return status;
  if (dueDate < todayDate) return "overdue";
  return paid > 0 ? "partial" : "sent";
}

/**
 * The print versions an invoice has, in toolbar order, and the one to show: `asked` when it is one
 * of them, otherwise With payments, then the Down payment request, then the Full invoice.
 */
export function printVersions(
  hasPayments: boolean,
  hasDownPayment: boolean,
  asked: unknown,
): { versions: PrintVersion[]; version: PrintVersion } {
  const versions: PrintVersion[] = ["full"];
  if (hasPayments) versions.push("payments");
  if (hasDownPayment) versions.push("dp");
  const fallback: PrintVersion = hasPayments ? "payments" : hasDownPayment ? "dp" : "full";
  return { versions, version: versions.find((version) => version === asked) ?? fallback };
}
```

In `src/components/status-badge.tsx`, add a `partial` entry to `STYLES`, between `sent` and `overdue`:

```ts
  partial: { label: "Part paid", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts src/lib/rules.test.ts src/components/status-badge.tsx
git commit -m "Add the Part paid status and print version choice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Payments in the repository

**Files:**
- Modify: `src/lib/repo.ts`
- Test: `src/lib/repo.test.ts`

**Interfaces:**
- Consumes: `migrate` and the version 3 tables (Task 2); `displayStatus(status, dueDate, today, paid)` (Task 3); `Portion`, `formatMoney` (Task 1 / existing).
- Produces, all exported from `src/lib/repo.ts`:
  - `InvoiceInput` gains `downPaymentType: Portion["type"]` and `downPaymentValue: number` (basis points or smallest unit; 0 = none).
  - `type PaymentKind = "payment" | "write_off"`
  - `type Payment = { id: number; paidOn: string; amount: number; kind: PaymentKind; note: string }`
  - `type PaymentInput = { paidOn: string; amount: number; note: string; writeOff: boolean }`
  - `Invoice` gains `payments: Payment[]`, `paid: number` (payments only), `balance: number` (total − payments − write-offs).
  - `InvoiceRow` gains `paid: number` and `balance: number`.
  - `class PaymentConflictError extends Error { field: string }`, thrown by `saveInvoice`. `field` is `"items"` (the total dropped below what is settled) or `"currency"`.
  - `recordPayment(id: number, currency: Currency, input: PaymentInput): Result`
  - `removePayment(invoiceId: number, paymentId: number): boolean`
  - `revertToDraft(id: number): Result`
  - Removed: `markPaid`, `undoStatus`.
  - `dashboard` keeps its return type: `outstanding` and `overdue` are balances, and `paidThisMonth` is the payments dated this month.

- [ ] **Step 1: Update the test helpers**

In `src/lib/repo.test.ts`:

Change the type import to `import type { InvoiceInput, PaymentInput } from "./repo.ts";`.

In `input()`, add after `discountValue: 0,`:

```ts
    downPaymentType: "percent",
    downPaymentValue: 0,
```

After `input()`, add:

```ts
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
```

(`input()` makes an invoice with a total of Rp 3,000,000: two items of Rp 1,500,000 and no tax.)

- [ ] **Step 2: Rewrite the tests that used `markPaid` and `undoStatus`**

In "a number, once assigned, survives revert and re-send", change `repo.undoStatus(a)` to `repo.revertToDraft(a)`.

Replace the whole test "only a sent invoice can be marked paid, and undo clears the paid date" and the whole test "a draft cannot be undone further" with:

```ts
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
```

In "an invoice in any status can be deleted, with its items", rename it to "an invoice in any status can be deleted, with its items and payments". Replace `repo.markPaid(paid, TODAY);` with:

```ts
  repo.recordPayment(paid, "IDR", pay(3_000_000));
  repo.recordPayment(sent, "IDR", pay(1_000));
```

and after the existing `invoice_items` count assertion add:

```ts
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM payments").get()?.n, 0);
  assert.deepEqual(repo.dashboard(TODAY).summaries, []);
```

In "duplicate makes an unnumbered draft dated today with the same content", add `downPaymentType: "percent", downPaymentValue: 5000` to the `input({...})` of the source. After `repo.markSent(a, "INV-2026-001");` add `repo.recordPayment(a, "USD", pay(500));`. At the end of the test, before the `duplicateInvoice(424242, …)` line, add:

```ts
  assert.equal(copy.downPaymentType, "percent");
  assert.equal(copy.downPaymentValue, 5000);
  assert.deepEqual(copy.payments, []);
  assert.equal(copy.balance, copy.total);
```

Replace the whole test "the dashboard totals each currency separately" with:

```ts
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
    { currency: "IDR", outstanding: 2_500_000, overdue: 2_000_000, paidThisMonth: 1_150_000 },
    { currency: "USD", outstanding: 15_000, overdue: 0, paidThisMonth: 0 },
  ]);
  assert.equal(latest.length, 6);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `DATABASE_PATH=:memory: node --test src/lib/repo.test.ts`
Expected: FAIL. The new tests fail with `repo.recordPayment is not a function`, `repo.revertToDraft is not a function`, or a missing `downPaymentType`.

- [ ] **Step 4: Implement the types**

In `src/lib/repo.ts`, change the money import to:

```ts
import { formatMoney, invoiceTotals } from "./money.ts";
import type { Currency, Portion } from "./money.ts";
```

In `InvoiceInput`, after `discountValue: number;`, add:

```ts
  downPaymentType: Portion["type"];
  /** Basis points for a percentage, the smallest unit for an amount. Zero means no down payment is asked for. */
  downPaymentValue: number;
```

After `InvoiceInput`, add:

```ts
export type PaymentKind = "payment" | "write_off";
export type Payment = { id: number; paidOn: string; amount: number; kind: PaymentKind; note: string };
/** One payment. With `writeOff`, whatever it leaves owing is written off on the same date. */
export type PaymentInput = { paidOn: string; amount: number; note: string; writeOff: boolean };
```

In `Invoice`, after `paidAt: string | null;`, add:

```ts
  payments: Payment[];
  /** Money received: payments only, without write-offs. */
  paid: number;
  /** Total minus payments and write-offs. */
  balance: number;
```

In `InvoiceRow`, after `total: number;`, add:

```ts
  paid: number;
  balance: number;
```

After `export class NotFoundError extends Error {}`, add:

```ts
/** An edit that conflicts with recorded payments. `field` is the form field to show the message on. */
export class PaymentConflictError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}
```

- [ ] **Step 5: Implement reads**

Replace `INVOICE_COLS` and `ROW_COLS` with:

```ts
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
```

In `listInvoices`, change the last line to:

```ts
  return rows.map((row) => ({ ...row, display: displayStatus(row.status, row.dueDate, todayDate, row.paid) }));
```

Replace `getInvoice` with:

```ts
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
```

- [ ] **Step 6: Implement `settle` and the save guards**

Directly above `saveInvoice`, add:

```ts
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
```

Replace `saveInvoice` with:

```ts
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
```

- [ ] **Step 7: Implement recording, removing and reverting**

Delete `markPaid` and `undoStatus`. In their place add:

```ts
/** Records a payment on a sent invoice whose currency is `currency`. Refuses an amount above the balance. */
export function recordPayment(id: number, currency: Currency, input: PaymentInput): Result {
  return transaction((): Result => {
    const invoice = one<{ status: Status; currency: Currency; balance: number; writeOffs: number }>(
      `SELECT status, currency, total - ${SETTLED} AS balance,
         (SELECT COUNT(*) FROM payments WHERE invoice_id = invoices.id AND kind = 'write_off') AS writeOffs
       FROM invoices WHERE id = ?`,
      id,
    );
    if (!invoice) return { ok: false, error: "This invoice no longer exists." };
    if (invoice.status !== "sent") return { ok: false, error: "Payments can only be recorded on a sent invoice." };
    // The amount was read in this currency; after a change it would mean something else.
    if (invoice.currency !== currency) {
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
```

In `duplicateInvoice`, after `discountValue: source.discountValue,`, add:

```ts
    downPaymentType: source.downPaymentType,
    downPaymentValue: source.downPaymentValue,
```

- [ ] **Step 8: Implement the dashboard**

Replace the `summaries` query in `dashboard` with:

```ts
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
```

(The `?` for the due date comes first in the text, so `todayDate` binds to it and the month to the second.)

- [ ] **Step 9: Run the tests**

Run: `npm test`
Expected: all tests pass. `npx tsc --noEmit` now reports errors in `actions.ts`, `invoice-form.ts`, `schemas.test.ts` and the components; Tasks 5–7 fix them.

- [ ] **Step 10: Commit**

```bash
git add src/lib/repo.ts src/lib/repo.test.ts
git commit -m "Record payments and derive invoice status and balance from them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Validation, form values and actions

**Files:**
- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/invoice-form.ts`
- Modify: `src/lib/actions.ts`
- Test: `src/lib/schemas.test.ts`

**Interfaces:**
- Consumes: `InvoiceInput`, `PaymentInput`, `Invoice`, `PaymentConflictError`, `recordPayment`, `removePayment`, `revertToDraft` (Task 4); `invoiceTotals`, `Portion` (Task 1).
- Produces:
  - `InvoiceFormValues` gains `downPaymentEnabled: boolean`, `downPaymentType: string`, `downPayment: string`. Field errors are `downPaymentType` and `downPayment`.
  - `type PaymentFormValues = { paidOn: string; amount: string; note: string; writeOff: boolean }`
  - `parsePaymentForm(values: unknown, currency: Currency): Parsed<PaymentInput>`
  - `blankPaymentValues(balance: number, currency: Currency, todayDate: string): PaymentFormValues` in `src/lib/invoice-form.ts`
  - Server Actions `recordPaymentAction(id: number, values: PaymentFormValues): Promise<FormState>`, `removePaymentAction(invoiceId: number, paymentId: number): Promise<FormState>`, `revertToDraftAction(id: number): Promise<FormState>`. `markPaidAction` and `undoStatusAction` are removed.
  - `saveInvoiceAction` returns `{ errors: { [field]: message } }` for a `PaymentConflictError`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/schemas.test.ts`:

Change the imports to:

```ts
import { blankInvoiceValues, blankPaymentValues, invoiceToValues, settingsToValues } from "./invoice-form.ts";
import { parseClientForm, parseInvoiceForm, parseInvoiceNumber, parsePaymentForm, parseSettingsForm } from "./schemas.ts";
```

In `values()`, after `discount: "",`, add:

```ts
    downPaymentEnabled: false,
    downPaymentType: "percent",
    downPayment: "",
```

In "a valid form becomes repository input in the smallest unit", add to the expected `parsed.data` after `discountValue: 0,`:

```ts
    downPaymentType: "percent",
    downPaymentValue: 0,
```

In "a stored invoice survives the trip through the form unchanged", add to the `invoice` literal after `discountValue: 300,`:

```ts
    downPaymentType: "percent",
    downPaymentValue: 5000,
    payments: [],
    paid: 0,
    balance: 2995,
```

and to the expected `parsed.data` after `discountValue: 300,`:

```ts
    downPaymentType: "percent",
    downPaymentValue: 5000,
```

In "blank values come from settings", add `assert.equal(blank.downPaymentEnabled, false);`.

Append:

```ts
test("a down payment is stored only when switched on, and an amount may not exceed the total", () => {
  const percent = parseInvoiceForm(values({ downPaymentEnabled: true, downPayment: "50" }));
  assert.ok(percent.ok);
  assert.equal(percent.data.downPaymentValue, 5000);
  const off = parseInvoiceForm(values({ downPaymentEnabled: false, downPayment: "junk" }));
  assert.ok(off.ok);
  assert.equal(off.data.downPaymentValue, 0);
  // values() totals 3,000,000 with no tax
  assert.ok(parseInvoiceForm(values({ downPaymentEnabled: true, downPaymentType: "amount", downPayment: "3000000" })).ok);
  assert.ok(errorsOf(values({ downPaymentEnabled: true, downPaymentType: "amount", downPayment: "3000001" })).downPayment);
  assert.ok(errorsOf(values({ downPaymentEnabled: true, downPayment: "101" })).downPayment);
  assert.ok(errorsOf(values({ downPaymentType: "bogus" })).downPaymentType);
  // 11% tax makes the total 3,330,000
  assert.ok(
    parseInvoiceForm(values({ taxEnabled: true, downPaymentEnabled: true, downPaymentType: "amount", downPayment: "3330000" })).ok,
  );
});

test("a payment needs a real date and an amount above zero in the invoice currency", () => {
  const good = parsePaymentForm({ paidOn: "2026-10-12", amount: "19.99", note: " BCA ", writeOff: true }, "USD");
  assert.ok(good.ok);
  assert.deepEqual(good.data, { paidOn: "2026-10-12", amount: 1999, note: "BCA", writeOff: true });
  const bad = parsePaymentForm({ paidOn: "2026-02-30", amount: "0", note: "", writeOff: false }, "IDR");
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.errors.paidOn);
    assert.ok(bad.errors.amount);
  }
  for (const amount of ["1.5", "1.500.000", "-5", "", "abc"]) {
    assert.equal(parsePaymentForm({ paidOn: "2026-10-12", amount, note: "", writeOff: false }, "IDR").ok, false, amount);
  }
  assert.equal(parsePaymentForm(null, "IDR").ok, false);
});

test("the payment form starts with today and the full balance", () => {
  assert.deepEqual(blankPaymentValues(150_050, "USD", "2026-10-12"), {
    paidOn: "2026-10-12",
    amount: "1500.50",
    note: "",
    writeOff: false,
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `DATABASE_PATH=:memory: node --test src/lib/schemas.test.ts`
Expected: FAIL, `does not provide an export named 'blankPaymentValues'`.

- [ ] **Step 3: Implement the schemas**

In `src/lib/schemas.ts`:

Change the money import to `import { invoiceTotals, lineTotal, parseAmount, parsePercent } from "./money.ts";` and the repo type import to `import type { ClientInput, InvoiceInput, PaymentInput, Settings } from "./repo.ts";`.

In `InvoiceFormValues`, after `discount: string;`, add:

```ts
  downPaymentEnabled: boolean;
  downPaymentType: string;
  downPayment: string;
```

After `InvoiceFormValues`, add:

```ts
export type PaymentFormValues = { paidOn: string; amount: string; note: string; writeOff: boolean };
```

In `parseInvoiceForm`, change the comment's opening to read:

```ts
  // Some rules depend on another field: the price format on the currency, the tax
  // rate, discount and down payment on their switches, the discount and down payment
  // formats on their types, and the due date on the issue date. The schema is built
  // per submission so every field still reports its own error in one pass.
```

In the schema object, after the `discount:` entry, add:

```ts
    downPaymentType: z.enum(["percent", "amount"], "Choose a percentage or an amount"),
    downPayment:
      raw.downPaymentEnabled !== true
        ? z.unknown().transform(() => 0)
        : raw.downPaymentType === "amount"
          ? amount(cur)
          : percent,
```

Replace everything after `if (!result.success) return { ok: false, errors: collect(result.error) };` in `parseInvoiceForm` with:

```ts
  const { taxRate, discount, downPayment, ...rest } = result.data;
  const data: InvoiceInput = { ...rest, taxRateBp: taxRate, discountValue: discount, downPaymentValue: downPayment };
  // A float sum is close enough here: a subtotal past exact integers is far above any discount.
  const subtotal = data.items.reduce((sum, item) => sum + lineTotal(item), 0);
  if (data.discountType === "amount" && discount > subtotal) {
    return { ok: false, errors: { discount: "The discount cannot be more than the subtotal" } };
  }
  if (data.downPaymentType === "amount" && downPayment > 0) {
    const total = totalOf(data);
    if (total !== null && downPayment > total) {
      return { ok: false, errors: { downPayment: "The down payment cannot be more than the total" } };
    }
  }
  return { ok: true, data };
}

/** The invoice total, or null when it is too large to store (saving reports that). */
function totalOf(input: InvoiceInput): number | null {
  try {
    return invoiceTotals(input.items, input.taxRateBp, { type: input.discountType, value: input.discountValue }).total;
  } catch {
    return null;
  }
}

/** A payment in the invoice currency, stored in its smallest unit. */
export function parsePaymentForm(values: unknown, cur: Currency): Parsed<PaymentInput> {
  const result = z
    .object({
      paidOn: date,
      amount: amount(cur).refine((minor) => minor > 0, "Enter an amount above zero"),
      note: text(200),
      writeOff: z.boolean(),
    })
    .safeParse(values);
  return result.success ? { ok: true, data: result.data } : { ok: false, errors: collect(result.error) };
}
```

- [ ] **Step 4: Implement the form values**

In `src/lib/invoice-form.ts`, change the imports to:

```ts
import { amountToInput, percentToInput } from "./money.ts";
import type { Currency, Portion } from "./money.ts";
import { addDays } from "./rules.ts";
import type { Invoice, Settings } from "./repo.ts";
import type { InvoiceFormValues, ItemFormValues, PaymentFormValues, SettingsFormValues } from "./schemas.ts";
```

Above `blankInvoiceValues`, add:

```ts
/** A percentage or amount as form text; empty when there is none. */
function portionToInput(type: Portion["type"], value: number, currency: Currency): string {
  if (value === 0) return "";
  return type === "amount" ? amountToInput(value, currency) : percentToInput(value);
}
```

In `blankInvoiceValues`, after `discount: "",`, add:

```ts
    downPaymentEnabled: false,
    downPaymentType: "percent",
    downPayment: "",
```

In `invoiceToValues`, replace the whole `discount:` entry (the nested ternary) with `discount: portionToInput(inv.discountType, inv.discountValue, inv.currency),`, and after it add:

```ts
    downPaymentEnabled: inv.downPaymentValue > 0,
    downPaymentType: inv.downPaymentType,
    downPayment: portionToInput(inv.downPaymentType, inv.downPaymentValue, inv.currency),
```

At the end of the file, add:

```ts
/** A payment of the whole balance, dated today. */
export function blankPaymentValues(balance: number, currency: Currency, todayDate: string): PaymentFormValues {
  return { paidOn: todayDate, amount: amountToInput(balance, currency), note: "", writeOff: false };
}
```

- [ ] **Step 5: Implement the actions**

In `src/lib/actions.ts`:

Change the imports to:

```ts
import * as repo from "./repo";
import { today } from "./rules";
import { parseClientForm, parseInvoiceForm, parseInvoiceNumber, parsePaymentForm, parseSettingsForm } from "./schemas";
import type { ClientFormValues, FormState, InvoiceFormValues, PaymentFormValues, SettingsFormValues } from "./schemas";
```

In `saveInvoiceAction`'s `catch`, after the `NotFoundError` line, add:

```ts
    if (error instanceof repo.PaymentConflictError) return { errors: { [error.field]: error.message } };
```

Delete `markPaidAction` and `undoStatusAction`, and add in their place:

```ts
export async function recordPaymentAction(id: number, values: PaymentFormValues): Promise<FormState> {
  if (!isId(id)) return { message: GONE };
  const invoice = repo.getInvoice(id);
  if (!invoice) return { message: GONE };
  const parsed = parsePaymentForm(values, invoice.currency);
  if (!parsed.ok) return { errors: parsed.errors };
  const result = repo.recordPayment(id, invoice.currency, parsed.data);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}

export async function removePaymentAction(invoiceId: number, paymentId: number): Promise<FormState> {
  if (!isId(invoiceId) || !isId(paymentId) || !repo.removePayment(invoiceId, paymentId)) {
    return { message: "This payment no longer exists." };
  }
  refresh();
  return { ok: true };
}

export async function revertToDraftAction(id: number): Promise<FormState> {
  if (!isId(id)) return { message: GONE };
  const result = repo.revertToDraft(id);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: all pass. `npx tsc --noEmit` still reports errors in the components (`markPaidAction`, `undoStatusAction` and the new form fields); Tasks 6–7 fix them.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts src/lib/invoice-form.ts src/lib/actions.ts
git commit -m "Validate down payments and payments; add payment actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Down payment controls in the invoice form

**Files:**
- Modify: `src/components/invoice-form.tsx`

**Interfaces:**
- Consumes: `InvoiceFormValues.downPayment*` (Task 5); `downPaymentAmount`, `Portion` (Task 1).
- Produces: `InvoiceForm` accepts `payments?: ReactNode`, which is rendered directly under the status bar. Task 7 fills it.

- [ ] **Step 1: Share the parsing of switchable % or amount fields**

In `src/components/invoice-form.tsx`, change the money import to:

```ts
import { downPaymentAmount, formatMoney, invoiceTotals, parseAmount, parsePercent } from "@/lib/money";
```

Add `| "downPayment"` to the `TextField` union after `| "discount"`.

Above `liveTotals`, add:

```ts
/** What a switchable % or amount field holds: none when switched off, null while the text is invalid. */
function typedPortion(enabled: boolean, type: string, text: string, currency: Currency): Portion | null {
  const kind: Portion["type"] = type === "amount" ? "amount" : "percent";
  if (!enabled) return { type: kind, value: 0 };
  const value = kind === "amount" ? parseAmount(text, currency) : parsePercent(text);
  return value === null ? null : { type: kind, value };
}
```

In `liveTotals`, replace everything from `const type: Portion["type"] =` through the line `return invoiceTotals(lines, taxRateBp, { type, value: discount });` with:

```ts
  const discount = typedPortion(values.discountEnabled, values.discountType, values.discount, currency);
  if (discount === null) return null;
  try {
    return invoiceTotals(lines, taxRateBp, discount);
```

After `liveTotals`, add:

```ts
/** The down payment for what is typed so far, or undefined while it cannot be worked out. */
function liveDownPayment(values: InvoiceFormValues, currency: Currency, totals: Totals | null): number | undefined {
  const downPayment = typedPortion(values.downPaymentEnabled, values.downPaymentType, values.downPayment, currency);
  if (!values.downPaymentEnabled || downPayment === null || totals === null) return undefined;
  try {
    return downPaymentAmount(totals.total, downPayment);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Add the `payments` slot and the computed down payment**

In `InvoiceFormProps`, after `status?: …;`, add:

```ts
  /** Shown under the status bar; the invoice page passes the Payments card. */
  payments?: ReactNode;
```

Change the component signature to `export function InvoiceForm({ invoiceId, initial, clients, taxLabel, status, payments }: InvoiceFormProps) {`, and after `const totals = liveTotals(values, currency);` add:

```ts
  const downPayment = liveDownPayment(values, currency, totals);
```

Change `{status ? <InvoiceStatusActions {...status} dirty={dirty} /> : null}` to:

```tsx
      {status ? <InvoiceStatusActions {...status} dirty={dirty} /> : null}
      {payments}
```

- [ ] **Step 3: Add the controls**

In the Details card, directly after the closing `) : null}` of the `values.taxEnabled` rate field, add:

```tsx
              <div className="flex items-center gap-3">
                <Switch
                  id={fid("downPaymentEnabled")}
                  checked={values.downPaymentEnabled}
                  onCheckedChange={(checked) => set("downPaymentEnabled", checked)}
                />
                <Label htmlFor={fid("downPaymentEnabled")}>Ask for a down payment</Label>
              </div>
              {values.downPaymentEnabled ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={fid("downPaymentType")} label="Down payment as" error={errors.downPaymentType}>
                    <Select value={values.downPaymentType} onValueChange={(value) => set("downPaymentType", value)}>
                      <SelectTrigger id={fid("downPaymentType")} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Percentage of the total</SelectItem>
                        <SelectItem value="amount">Amount in {currency}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    id={fid("downPayment")}
                    label={values.downPaymentType === "amount" ? `Down payment (${currency})` : "Down payment (%)"}
                    error={errors.downPayment}
                  >
                    <Input inputMode="decimal" autoComplete="off" {...bind("downPayment")} />
                  </Field>
                </div>
              ) : null}
```

In the Totals card, directly after the `Total` `<dd>`, add:

```tsx
                {values.downPaymentEnabled ? (
                  <>
                    <dt className="text-muted-foreground">
                      Down payment due{values.downPaymentType === "amount" ? "" : ` (${values.downPayment}%)`}
                    </dt>
                    <dd className="text-right">{money(downPayment)}</dd>
                  </>
                ) : null}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass. `npx tsc --noEmit` should now report errors only in `invoice-status-actions.tsx` and `src/app/(app)/invoices/[id]/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/invoice-form.tsx
git commit -m "Ask for a down payment in the invoice form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Record payment and the Payments card

**Files:**
- Modify: `src/components/invoice-status-actions.tsx`
- Create: `src/components/payments-card.tsx`
- Modify: `src/app/(app)/invoices/[id]/page.tsx`

**Interfaces:**
- Consumes: `recordPaymentAction`, `removePaymentAction`, `revertToDraftAction`, `PaymentFormValues`, `blankPaymentValues` (Task 5); `Payment`, `Invoice.paid`, `Invoice.balance`, `Invoice.payments` (Task 4); `displayStatus(…, paid)` (Task 3); `InvoiceForm`'s `payments` slot (Task 6).
- Produces: `InvoiceStatusProps` gains `balance: number`, `currency: Currency`, `hasPayments: boolean`. `PaymentsCard` takes `{ invoiceId: number; payments: Payment[]; paid: number; balance: number; currency: Currency }`.

- [ ] **Step 1: Replace Mark paid with Record payment**

In `src/components/invoice-status-actions.tsx`:

Replace the imports from `lucide-react` through `import type { Status } from "@/lib/rules";` with:

```ts
import { Copy, Download, Send, Trash2, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, invalid } from "@/components/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction, useServerForm } from "@/hooks/use-actions";
import {
  deleteInvoiceAction,
  duplicateInvoiceAction,
  markSentAction,
  recordPaymentAction,
  revertToDraftAction,
} from "@/lib/actions";
import { blankPaymentValues } from "@/lib/invoice-form";
import { formatMoney, parseAmount } from "@/lib/money";
import type { Currency } from "@/lib/money";
import type { Status } from "@/lib/rules";
import type { PaymentFormValues } from "@/lib/schemas";
```

In `InvoiceStatusProps`, after `today: string;`, add:

```ts
  /** What is still owed, in the smallest unit. */
  balance: number;
  currency: Currency;
  /** True when any payment or write-off is recorded; an invoice with some cannot go back to draft. */
  hasPayments: boolean;
```

Change the component signature to:

```ts
export function InvoiceStatusActions({
  id,
  status,
  number,
  suggestedNumber,
  today,
  balance,
  currency,
  hasPayments,
  dirty,
}: InvoiceStatusProps) {
```

Replace the three blocks from `{status === "sent" ? <MarkPaidDialog …` through the closing `) : null}` of the `status === "paid"` "Mark unpaid" button with:

```tsx
      {status === "sent" ? (
        <RecordPaymentDialog id={id} balance={balance} currency={currency} today={today} disabled={blocked} />
      ) : null}
      {status === "sent" && !hasPayments ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked}
          onClick={() => run(() => revertToDraftAction(id), () => toast.success("Reverted to draft"))}
        >
          <Undo2 /> Revert to draft
        </Button>
      ) : null}
```

Delete the whole `MarkPaidDialog` function and add in its place:

```tsx
type RecordPaymentProps = { id: number; balance: number; currency: Currency; today: string; disabled: boolean };

function RecordPaymentDialog({ id, balance, currency, today, disabled }: RecordPaymentProps) {
  const [open, setOpen] = useState(false);
  const initial = blankPaymentValues(balance, currency, today);

  /** What the typed amount leaves owing, or 0 while it is not a valid amount below the balance. */
  function leftOver(values: PaymentFormValues): number {
    const amount = parseAmount(values.amount, currency);
    return amount !== null && amount > 0 && amount < balance ? balance - amount : 0;
  }

  const form = useServerForm(initial, async (values) => {
    const result = await recordPaymentAction(id, { ...values, writeOff: values.writeOff && leftOver(values) > 0 });
    if (result?.ok) {
      setOpen(false);
      toast.success("Payment recorded");
    }
    return result;
  });
  const { values, set, errors } = form;
  const rest = leftOver(values);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(initial);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled}>
          <Wallet /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={form.onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {formatMoney(balance, currency)} is still owed. The payment date decides which month it counts in.
            </DialogDescription>
          </DialogHeader>
          <Field id="payment-paid-on" label="Paid on" error={errors.paidOn}>
            <Input
              id="payment-paid-on"
              type="date"
              value={values.paidOn}
              onChange={(event) => set("paidOn", event.target.value)}
              {...invalid("payment-paid-on", errors.paidOn)}
            />
          </Field>
          <Field id="payment-amount" label={`Amount (${currency})`} error={errors.amount}>
            <Input
              id="payment-amount"
              inputMode="decimal"
              autoComplete="off"
              value={values.amount}
              onChange={(event) => set("amount", event.target.value)}
              {...invalid("payment-amount", errors.amount)}
            />
          </Field>
          <Field id="payment-note" label="Note (optional)" error={errors.note}>
            <Input
              id="payment-note"
              autoComplete="off"
              placeholder="e.g. DP 50%, BCA transfer"
              value={values.note}
              onChange={(event) => set("note", event.target.value)}
              {...invalid("payment-note", errors.note)}
            />
          </Field>
          {rest > 0 ? (
            <div className="flex items-center gap-3">
              <Switch
                id="payment-write-off"
                checked={values.writeOff}
                onCheckedChange={(checked) => set("writeOff", checked)}
              />
              <Label htmlFor="payment-write-off">Write off the remaining {formatMoney(rest, currency)}</Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={form.pending}>
              {form.pending ? "Saving…" : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

(`useState` and `useTransition` stay imported from `react`: `MarkSentDialog` still uses both.)

- [ ] **Step 2: Create the Payments card**

Create `src/components/payments-card.tsx`:

```tsx
import { ConfirmButton } from "@/components/confirm-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { removePaymentAction } from "@/lib/actions";
import { formatMoney } from "@/lib/money";
import type { Currency } from "@/lib/money";
import type { Payment } from "@/lib/repo";
import { formatDate } from "@/lib/rules";

type PaymentsCardProps = { invoiceId: number; payments: Payment[]; paid: number; balance: number; currency: Currency };

/** What has been paid on a sent or paid invoice, and what is still owed. */
export function PaymentsCard({ invoiceId, payments, paid, balance, currency }: PaymentsCardProps) {
  const money = (minor: number) => formatMoney(minor, currency);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet. Use Record payment when money arrives.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => {
                const writeOff = payment.kind === "write_off";
                return (
                  <TableRow key={payment.id}>
                    <TableCell>{formatDate(payment.paidOn)}</TableCell>
                    <TableCell>{writeOff ? "Written off" : payment.note || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(payment.amount)}</TableCell>
                    <TableCell className="text-right">
                      <ConfirmButton
                        label="Remove"
                        title={writeOff ? "Remove this write-off?" : "Remove this payment?"}
                        description={`${money(payment.amount)} on ${formatDate(payment.paidOn)} is removed, and the balance and status are worked out again.`}
                        confirmLabel="Remove"
                        action={removePaymentAction.bind(null, invoiceId, payment.id)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <dl className="grid grid-cols-2 gap-y-2 tabular-nums">
          <dt className="text-muted-foreground">Paid so far</dt>
          <dd className="text-right">{money(paid)}</dd>
          <dt className="font-semibold">Balance due</dt>
          <dd className="text-right text-lg font-semibold">{money(balance)}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Wire up the invoice page**

In `src/app/(app)/invoices/[id]/page.tsx`, add `import { PaymentsCard } from "@/components/payments-card";`. Change the badge to:

```tsx
        <StatusBadge status={displayStatus(invoice.status, invoice.dueDate, todayDate, invoice.paid)} />
```

Change the `status={{ … }}` prop and add `payments` after it:

```tsx
        status={{
          id: invoice.id,
          status: invoice.status,
          number: invoice.number,
          suggestedNumber: invoice.number ?? suggestNumber(invoice.id) ?? "",
          today: todayDate,
          balance: invoice.balance,
          currency: invoice.currency,
          hasPayments: invoice.payments.length > 0,
        }}
        payments={
          invoice.status === "draft" ? undefined : (
            <PaymentsCard
              invoiceId={invoice.id}
              payments={invoice.payments}
              paid={invoice.paid}
              balance={invoice.balance}
              currency={invoice.currency}
            />
          )
        }
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass with no errors. From here on, all four stay green.

- [ ] **Step 5: Commit**

```bash
git add src/components/invoice-status-actions.tsx src/components/payments-card.tsx "src/app/(app)/invoices/[id]/page.tsx"
git commit -m "Record and remove payments from the invoice page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Balances in the list and on the dashboard

**Files:**
- Modify: `src/components/invoice-table.tsx`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `InvoiceRow.paid`, `InvoiceRow.balance` (Task 4); the `partial` badge (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Show the balance under a part-paid total**

In `src/components/invoice-table.tsx`, replace the total cell with:

```tsx
            <TableCell className="text-right tabular-nums">
              {formatMoney(row.total, row.currency)}
              {row.status === "sent" && row.paid > 0 ? (
                <span className="block text-xs text-muted-foreground">
                  Balance {formatMoney(row.balance, row.currency)}
                </span>
              ) : null}
            </TableCell>
```

- [ ] **Step 2: Reword the dashboard hints**

In `src/app/(app)/page.tsx`, change the three `hint` values:

- Outstanding: `hint="Balance still owed on sent invoices"`
- Overdue: `hint="Balance owed past the due date"`
- Paid this month: `hint="Payments received, by payment date"`

- [ ] **Step 3: Run all checks**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/invoice-table.tsx "src/app/(app)/page.tsx"
git commit -m "Show balances in the invoice list and dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Print versions

**Files:**
- Modify: `src/app/(print)/invoices/[id]/print/page.tsx`
- Modify: `src/app/(print)/invoices/[id]/print/print-toolbar.tsx`
- Modify: `src/app/(print)/invoices/[id]/print/print.css`

**Interfaces:**
- Consumes: `printVersions`, `PrintVersion` (Task 3); `Invoice.payments`, `Invoice.balance`, `Invoice.downPayment*` (Task 4); `downPaymentAmount` (Task 1).
- Produces: `PrintToolbar` takes `versions: { label: string; href: string; current: boolean }[]`.

- [ ] **Step 1: Add the picker to the toolbar**

In `print-toolbar.tsx`, change the props type and the markup:

```tsx
type VersionLink = { label: string; href: string; current: boolean };
type PrintToolbarProps = { auto: boolean; backHref: string; title: string; versions: VersionLink[] };

/** Screen-only controls. With `auto`, opens the print dialog once fonts and images are ready. */
export function PrintToolbar({ auto, backHref, title, versions }: PrintToolbarProps) {
```

(the `useEffect` is unchanged), and replace the returned markup with:

```tsx
  return (
    <div className="toolbar">
      <Link href={backHref}>Back to invoice</Link>
      {versions.length > 1 ? (
        <nav aria-label="Version" className="versions">
          {versions.map((version) => (
            <Link key={version.href} href={version.href} replace aria-current={version.current ? "page" : undefined}>
              {version.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <button type="button" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
    </div>
  );
```

In `print.css`, add `flex-wrap: wrap;` to `.print-root .toolbar`, and after the `.print-root .toolbar button` rule add:

```css
.print-root .toolbar .versions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.print-root .toolbar a[aria-current="page"] {
  color: #fff;
  background: var(--navy);
  border-color: var(--navy);
}
```

- [ ] **Step 2: Choose the version and print the extra rows**

In `page.tsx`, change the imports:

```ts
import { downPaymentAmount, formatMoney, lineTotal, percentToInput } from "@/lib/money";
import { getInvoice, getSettings } from "@/lib/repo";
import type { Invoice } from "@/lib/repo";
import { formatDate, printVersions } from "@/lib/rules";
import type { PrintVersion } from "@/lib/rules";
```

Above `export async function generateMetadata`, add:

```ts
const LABELS: Record<PrintVersion, string> = {
  full: "Full invoice",
  payments: "With payments",
  dp: "Down payment request",
};
```

In `PrintPage`, replace `const auto = (await searchParams).print === "1";` with:

```ts
  const query = await searchParams;
  const auto = query.print === "1";
  const { versions, version } = printVersions(invoice.payments.length > 0, invoice.downPaymentValue > 0, query.version);
  const downPayment =
    version === "dp"
      ? downPaymentAmount(invoice.total, { type: invoice.downPaymentType, value: invoice.downPaymentValue })
      : 0;
```

Pass the versions to the toolbar:

```tsx
      <PrintToolbar
        auto={auto}
        backHref={`/invoices/${invoice.id}`}
        title={titleOf(invoice)}
        versions={versions.map((option) => ({
          label: LABELS[option],
          href: `/invoices/${invoice.id}/print?version=${option}`,
          current: option === version,
        }))}
      />
```

In the `totals` table, directly after the `<tr className="grand">` Total row, add:

```tsx
                      {version === "payments" ? (
                        <>
                          {invoice.payments.map((payment) => (
                            <tr key={payment.id}>
                              <th scope="row">
                                {payment.kind === "write_off" ? "Written off" : "Paid"} {formatDate(payment.paidOn)}
                              </th>
                              <td>−{money(payment.amount)}</td>
                            </tr>
                          ))}
                          <tr className="grand">
                            <th scope="row">Balance due</th>
                            <td>{money(invoice.balance)}</td>
                          </tr>
                        </>
                      ) : null}
                      {version === "dp" ? (
                        <tr className="grand">
                          <th scope="row">
                            Down payment due
                            {invoice.downPaymentType === "percent"
                              ? ` (${percentToInput(invoice.downPaymentValue)}%)`
                              : null}
                          </th>
                          <td>{money(downPayment)}</td>
                        </tr>
                      ) : null}
```

- [ ] **Step 3: Run all checks**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(print)/invoices/[id]/print/"
git commit -m "Print a full invoice, one with payments, or a down payment request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Design doc, local walkthrough, deploy handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-npinv-design.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a verified build ready for Victor to deploy.

- [ ] **Step 1: Point the main design at the new spec**

In `docs/superpowers/specs/2026-10-12-npinv-design.md`:

- Replace the "**Status changes:**" rule with: `- **Status changes:** draft → sent → paid. Paid follows the recorded payments; see 2026-10-14-partial-payments-design.md. A sent invoice with no payments can go back to draft; a number, once assigned, is kept.`
- In the invoice page's "Actions:" line, replace `Mark paid (with paid date, default today), undo status,` with `Record payment, Revert to draft (sent invoices with no payments),`.
- Append to section 14: `- **Partial payments (2026-10-14):** payments, write-offs, down payment requests and three print versions, as designed in 2026-10-14-partial-payments-design.md. Mark paid and Mark unpaid are replaced by Record payment and removing a payment.`

Commit:

```bash
git add docs/superpowers/specs/2026-10-12-npinv-design.md
git commit -m "Point the main design at partial payments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Full checks**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 3: Walk through it locally on a copy of the local database**

Never point the dev server at `data/npinv.db` itself. Copy it into the session scratchpad with `VACUUM INTO`:

```bash
node -e 'const {DatabaseSync}=require("node:sqlite");new DatabaseSync("data/npinv.db",{readOnly:true}).exec(`VACUUM INTO '"'"'${process.argv[1]}'"'"'`)' "<scratchpad>/npinv.db"
```

Start a dev server on port 3010. Set `DATABASE_PATH` to the copy and `ADMIN_PASSWORD` to a freshly generated test value. Use a temporary `.claude/launch.json` entry that you remove afterwards and never commit. Log in, then check each of these in the browser:

1. An existing paid invoice shows one payment for its full total, dated on its old paid date. The dashboard figures match what the live server showed before the upgrade.
2. On a sent invoice, set "Ask for a down payment" to 50% and save. The Totals card shows "Down payment due (50%)". The print page offers Full invoice and Down payment request, and opens on the DP request.
3. Record a payment of half the balance with the note "DP 50%". The badge reads Part paid, the list shows "Balance …", and the dashboard's Outstanding falls by that amount.
4. Record a second, short payment and tick "Write off the remaining …". The invoice turns Paid. The Payments card lists the payment and "Written off". The print page opens on With payments, which shows both rows and "Balance due Rp 0".
5. Remove the write-off. The invoice goes back to Part paid.
6. Try to lower the total below what is paid, and to change the currency. Each shows a field error and nothing is saved.
7. Delete a part-paid invoice by typing its number. It disappears and the dashboard drops it.
8. Check the browser console and the dev server log for errors. There should be none.

Stop the server and remove the temporary launch entry.

- [ ] **Step 4: Hand over for deploy**

Do not connect to the server. Tell Victor:

- **Back up, then deploy.** Run the backup first, then the deploy:
  - `. deploy/.env.local && ssh "$NPINV_HOST" /usr/local/sbin/npinv-backup`
  - `./deploy/deploy.sh`
- **The upgrade runs once.** Schema version 3 runs the first time the app opens the database after the deploy.
- **Read-only checks afterwards:**
  - The dashboard figures are unchanged.
  - A paid invoice shows one payment for its full total.
  - "Record payment" appears on a sent invoice. Don't use it on a real invoice to test.
- **Push** the commits to Gitea if he asks.
