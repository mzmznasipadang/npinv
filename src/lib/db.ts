import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'Naspad Studio',
  business_address TEXT NOT NULL DEFAULT '',
  business_email TEXT NOT NULL DEFAULT '',
  business_phone TEXT NOT NULL DEFAULT '',
  payment_details TEXT NOT NULL DEFAULT '',
  default_currency TEXT NOT NULL DEFAULT 'IDR' CHECK (default_currency IN ('IDR', 'USD')),
  default_tax_rate_bp INTEGER NOT NULL DEFAULT 1100 CHECK (default_tax_rate_bp BETWEEN 0 AND 10000),
  tax_label TEXT NOT NULL DEFAULT 'PPN',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  default_due_days INTEGER NOT NULL DEFAULT 14 CHECK (default_due_days BETWEEN 0 AND 365),
  default_notes TEXT NOT NULL DEFAULT ''
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  bill_to_name TEXT NOT NULL,
  bill_to_company TEXT NOT NULL DEFAULT '',
  bill_to_address TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('IDR', 'USD')),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 1),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX invoice_items_invoice ON invoice_items (invoice_id, position);
`;

// Version 2: one discount per invoice. Existing invoices get none, so their totals are unchanged.
const DISCOUNT = `
ALTER TABLE invoices ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'percent'
  CHECK (discount_type IN ('percent', 'amount'));
ALTER TABLE invoices ADD COLUMN discount_value INTEGER NOT NULL DEFAULT 0
  CHECK (discount_value >= 0 AND (discount_type = 'amount' OR discount_value <= 10000));
ALTER TABLE invoices ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
`;

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

// Version 4: studio projects and tasks. Legacy invoice values remain untouched.
const PROJECTS = `
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'on_hold', 'completed')),
  start_date TEXT,
  deadline TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX projects_client ON projects(client_id);
CREATE INDEX projects_status_deadline ON projects(archived_at, status, deadline);
CREATE INDEX projects_updated ON projects(updated_at);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX tasks_project ON tasks(project_id, completed, due_date);
CREATE INDEX tasks_due ON tasks(completed, due_date);
ALTER TABLE invoices ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT;
CREATE INDEX invoices_project ON invoices(project_id);
CREATE INDEX invoices_client ON invoices(client_id);
`;

// Step i takes the database from version i to version i + 1.
const STEPS = [SCHEMA, DISCOUNT, PAYMENTS, PROJECTS];

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

function open(): DatabaseSync {
  const path = process.env.DATABASE_PATH ?? "data/npinv.db";
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

// One connection per process. It is opened on first use, not on import, and
// kept on globalThis so development hot reloads reuse it.
const holder = globalThis as unknown as { __npinvDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  return (holder.__npinvDb ??= open());
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
