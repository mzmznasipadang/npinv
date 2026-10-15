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

  assert.equal(version(db), 4);
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
  assert.equal(version(db), 4);
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

test("studio migration preserves all legacy financial data and gives every invoice no project", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, 3);
  db.exec(`INSERT INTO clients (id, name) VALUES (1, 'Synthetic client');
    INSERT INTO invoices (id, client_id, number, bill_to_name, issue_date, due_date, currency, status, subtotal, total, discount_type, discount_value, discount_amount)
    VALUES (1, 1, NULL, 'Draft snapshot', '2026-10-01', '2026-10-10', 'USD', 'draft', 1000, 900, 'amount', 100, 100),
    (2, 1, 'INV-2026-001', 'Sent snapshot', '2026-10-01', '2026-10-10', 'IDR', 'sent', 2000, 2000, 'percent', 0, 0),
    (3, 1, 'INV-2026-002', 'Paid snapshot', '2026-10-01', '2026-10-10', 'USD', 'paid', 3000, 3000, 'percent', 0, 0);
    INSERT INTO invoice_items (invoice_id, position, description, qty, unit_price) VALUES (1, 0, 'Design', 1, 1000);
    INSERT INTO payments (invoice_id, paid_on, amount) VALUES (2, '2026-10-02', 500), (3, '2026-10-03', 3000);`);
  const tables = ['invoices', 'invoice_items', 'payments', 'clients', 'settings'];
  const before = tables.map(t => rows(db, `SELECT * FROM ${t} ORDER BY id`));
  migrate(db);
  assert.equal(version(db), 4);
  for (const [i, table] of tables.entries()) {
    const after = rows(db, `SELECT * FROM ${table} ORDER BY id`).map(row => {
      const copy = { ...row };
      if (table === 'invoices') { assert.equal(copy.project_id, null); delete copy.project_id; }
      return copy;
    });
    assert.deepEqual(after, before[i]);
  }
  assert.deepEqual(rows(db, 'PRAGMA foreign_key_check'), []);
  migrate(db);
  assert.equal(version(db), 4);
  db.close();
});

test("project relationships protect financial records and only tasks cascade", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  db.exec(`INSERT INTO clients (id, name) VALUES (1, 'Synthetic');
    INSERT INTO projects (id, client_id, name) VALUES (1, 1, 'Design');
    INSERT INTO tasks (project_id, title) VALUES (1, 'Sketch');
    INSERT INTO invoices (id, client_id, project_id, bill_to_name, issue_date, due_date, currency)
      VALUES (1, 1, 1, 'Snapshot', '2026-10-01', '2026-10-10', 'IDR');`);
  assert.throws(() => db.exec('DELETE FROM clients WHERE id = 1'), /FOREIGN KEY/);
  assert.throws(() => db.exec('DELETE FROM projects WHERE id = 1'), /FOREIGN KEY/);
  assert.equal(rows(db, 'SELECT * FROM invoices').length, 1);
  db.exec('UPDATE invoices SET project_id = NULL; DELETE FROM projects WHERE id = 1');
  assert.equal(rows(db, 'SELECT * FROM tasks').length, 0);
  assert.equal(rows(db, 'SELECT * FROM invoices').length, 1);
  db.close();
});

test("a failed studio migration preserves version 3", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, 3);
  db.exec('CREATE TABLE tasks (x INTEGER)');
  assert.throws(() => migrate(db));
  assert.equal(version(db), 3);
  assert.equal(rows(db, "SELECT name FROM sqlite_master WHERE name = 'projects'").length, 0);
  assert.ok(!rows(db, 'PRAGMA table_info(invoices)').some(c => c.name === 'project_id'));
  db.close();
});

test('a synthetic file database migrates and can be recovered from its pre-migration backup', async () => {
  const {mkdtempSync, copyFileSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'npinv-migration-'));
  const path = join(dir,'studio.db');
  const backup = join(dir,'before-v4.db');
  try {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL');
    migrate(db,3);
    db.exec(`INSERT INTO invoices (number,bill_to_name,issue_date,due_date,currency,status,total)
      VALUES ('INV-2026-001','Synthetic snapshot','2026-10-01','2026-10-14','USD','sent',10000);
      INSERT INTO payments (invoice_id,paid_on,amount) VALUES (1,'2026-10-10',2500)`);
    const before = rows(db,'SELECT * FROM payments');
    db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
    migrate(db);
    assert.equal(version(db),4);
    assert.equal(rows(db,'SELECT project_id FROM invoices')[0].project_id,null);
    assert.deepEqual(rows(db,'SELECT * FROM payments'),before);
    assert.deepEqual(rows(db,'PRAGMA foreign_key_check'),[]);
    db.close();
    copyFileSync(backup,path);
    const restored = new DatabaseSync(path);
    assert.equal(version(restored),3);
    assert.deepEqual(rows(restored,'SELECT * FROM payments'),before);
    assert.equal(rows(restored,'SELECT total FROM invoices')[0].total,10000);
    assert.ok(!rows(restored,'PRAGMA table_info(invoices)').some(c => c.name === 'project_id'));
    restored.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
