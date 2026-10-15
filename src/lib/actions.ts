"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Currency } from "./money";
import * as repo from "./repo";
import { today } from "./rules";
import { parseClientForm, parseInvoiceForm, parseInvoiceNumber, parsePaymentForm, parseSettingsForm } from "./schemas";
import type { ClientFormValues, FormState, InvoiceFormValues, PaymentFormValues, SettingsFormValues } from "./schemas";

import { requireSession } from "./session";

const GONE = "This invoice no longer exists.";

// Arguments arrive from the browser, so ids are checked like any other input.
function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function refresh(): void {
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(values: SettingsFormValues): Promise<FormState> {
  await requireSession();
  const parsed = parseSettingsForm(values);
  if (!parsed.ok) return { errors: parsed.errors };
  repo.updateSettings(parsed.data);
  refresh();
  return { ok: true };
}

export async function saveClientAction(id: number | null, values: ClientFormValues): Promise<FormState> {
  await requireSession();
  if (id !== null && !isId(id)) return { message: "This client no longer exists." };
  const parsed = parseClientForm(values);
  if (!parsed.ok) return { errors: parsed.errors };
  if (id === null) repo.createClient(parsed.data);
  else if (!repo.updateClient(id, parsed.data)) return { message: "This client no longer exists." };
  refresh();
  return { ok: true };
}

export async function deleteClientAction(id: number): Promise<FormState> {
  await requireSession();
  if (!isId(id)) return { message: "This client no longer exists." };
  try {
    if (!repo.deleteClient(id)) return { message: "This client no longer exists." };
  } catch (error) {
    if (error instanceof repo.ProjectConflictError) return { message: error.message };
    throw error;
  }
  refresh();
  return { ok: true };
}

export async function saveInvoiceAction(id: number | null, values: InvoiceFormValues): Promise<FormState> {
  await requireSession();
  if (id !== null && !isId(id)) return { message: GONE };
  const parsed = parseInvoiceForm(values);
  if (!parsed.ok) return { errors: parsed.errors };
  let savedId: number;
  try {
    savedId = repo.saveInvoice(id, parsed.data);
  } catch (error) {
    if (error instanceof RangeError) return { message: "The invoice total is too large to store." };
    if (error instanceof repo.NotFoundError) return { message: GONE };
    if (error instanceof repo.ProjectConflictError) return { errors: { [error.field]: error.message } };
    if (error instanceof repo.PaymentConflictError) return { errors: { [error.field]: error.message } };
    throw error;
  }
  refresh();
  if (id === null) redirect(`/invoices/${savedId}`);
  return { ok: true };
}

export async function markSentAction(id: number, number: string): Promise<FormState> {
  await requireSession();
  if (!isId(id)) return { message: GONE };
  const parsed = parseInvoiceNumber(number);
  if (!parsed.ok) return { errors: parsed.errors };
  const result = repo.markSent(id, parsed.data);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}

/** `shown` is the currency and balance the dialog displayed; the payment is refused if either has since changed. */
export async function recordPaymentAction(
  id: number,
  shown: { currency: Currency; balance: number },
  values: PaymentFormValues,
): Promise<FormState> {
  await requireSession();
  if (!isId(id)) return { message: GONE };
  const currency = shown?.currency;
  if ((currency !== "IDR" && currency !== "USD") || !Number.isSafeInteger(shown.balance)) {
    return { message: "Reload the page and try again." };
  }
  const parsed = parsePaymentForm(values, currency);
  if (!parsed.ok) return { errors: parsed.errors };
  const result = repo.recordPayment(id, currency, parsed.data, shown.balance);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}

export async function removePaymentAction(invoiceId: number, paymentId: number): Promise<FormState> {
  await requireSession();
  if (!isId(invoiceId) || !isId(paymentId) || !repo.removePayment(invoiceId, paymentId)) {
    return { message: "This payment no longer exists." };
  }
  refresh();
  return { ok: true };
}

export async function revertToDraftAction(id: number): Promise<FormState> {
  await requireSession();
  if (!isId(id)) return { message: GONE };
  const result = repo.revertToDraft(id);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}

export async function duplicateInvoiceAction(id: number): Promise<FormState> {
  await requireSession();
  if (!isId(id)) return { message: GONE };
  const copyId = repo.duplicateInvoice(id, today());
  if (copyId === null) return { message: GONE };
  refresh();
  redirect(`/invoices/${copyId}`);
}

export async function deleteInvoiceAction(id: number): Promise<FormState> {
  await requireSession();
  if (!isId(id) || !repo.deleteInvoice(id)) return { message: GONE };
  refresh();
  redirect("/invoices");
}
