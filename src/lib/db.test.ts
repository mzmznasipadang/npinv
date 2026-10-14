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
