import { parseProjectForm, parseTaskForm } from './project-schemas.ts';
import * as projects from './projects.ts';
import * as repo from './repo.ts';
import { parseClientForm, parseInvoiceForm, parseInvoiceNumber, parsePaymentForm } from './schemas.ts';
import type { Currency } from './money.ts';
import type { FieldErrors } from './schemas.ts';

// One function per write, shared by the web Server Actions and the mobile API so both parse and write the same way.
// They throw the writers' errors (NotFoundError, ProjectConflictError and, for invoices, PaymentConflictError and RangeError); each caller maps those to its own response.

export function saveTask(projectId: number, id: number | null, values: unknown): { ok: true; id: number } | { ok: false; errors: FieldErrors } {
  const parsed = parseTaskForm(values);
  return parsed.ok ? { ok: true, id: projects.saveTask(projectId, id, parsed.data) } : parsed;
}

export function saveProject(id: number | null, values: unknown): { ok: true; id: number } | { ok: false; errors: FieldErrors } {
  const parsed = parseProjectForm(values);
  return parsed.ok ? { ok: true, id: projects.saveProject(id, parsed.data) } : parsed;
}

export function saveClient(id: number | null, values: unknown): { ok: true; id: number } | { ok: false; errors: FieldErrors } {
  const parsed = parseClientForm(values);
  if (!parsed.ok) return parsed;
  if (id === null) return { ok: true, id: repo.createClient(parsed.data) };
  if (!repo.updateClient(id, parsed.data)) throw new repo.NotFoundError('Client no longer exists.');
  return { ok: true, id };
}

export function saveInvoice(id: number | null, values: unknown): { ok: true; id: number } | { ok: false; errors: FieldErrors } {
  const parsed = parseInvoiceForm(values);
  return parsed.ok ? { ok: true, id: repo.saveInvoice(id, parsed.data) } : parsed;
}

/** `errors` for a malformed number; `error` for the writer's refusal, such as a number already in use. */
export function markSent(id: number, number: unknown): { ok: true } | { ok: false; errors: FieldErrors } | { ok: false; error: string } {
  const parsed = parseInvoiceNumber(number);
  return parsed.ok ? repo.markSent(id, parsed.data) : parsed;
}

/** A payment in the invoice currency the person saw. `shown` is also the guard: the writer refuses a balance that has since changed. */
export function recordPayment(id: number, shown: { currency: Currency; balance: number }, values: unknown): { ok: true } | { ok: false; errors: FieldErrors } | { ok: false; error: string } {
  const parsed = parsePaymentForm(values, shown.currency);
  return parsed.ok ? repo.recordPayment(id, shown.currency, parsed.data, shown.balance) : parsed;
}
