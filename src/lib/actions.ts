"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as repo from "./repo";
import { isValidDate, today } from "./rules";
import { parseClientForm, parseInvoiceForm, parseInvoiceNumber, parseSettingsForm } from "./schemas";
import type { ClientFormValues, FormState, InvoiceFormValues, SettingsFormValues } from "./schemas";

const GONE = "This invoice no longer exists.";

// Arguments arrive from the browser, so ids are checked like any other input.
function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function refresh(): void {
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(values: SettingsFormValues): Promise<FormState> {
  const parsed = parseSettingsForm(values);
  if (!parsed.ok) return { errors: parsed.errors };
  repo.updateSettings(parsed.data);
  refresh();
  return { ok: true };
}

export async function saveClientAction(id: number | null, values: ClientFormValues): Promise<FormState> {
  if (id !== null && !isId(id)) return { message: "This client no longer exists." };
  const parsed = parseClientForm(values);
  if (!parsed.ok) return { errors: parsed.errors };
  if (id === null) repo.createClient(parsed.data);
  else if (!repo.updateClient(id, parsed.data)) return { message: "This client no longer exists." };
  refresh();
  return { ok: true };
}

export async function deleteClientAction(id: number): Promise<FormState> {
  if (!isId(id) || !repo.deleteClient(id)) return { message: "This client no longer exists." };
  refresh();
  return { ok: true };
}

export async function saveInvoiceAction(id: number | null, values: InvoiceFormValues): Promise<FormState> {
  if (id !== null && !isId(id)) return { message: GONE };
  const parsed = parseInvoiceForm(values);
  if (!parsed.ok) return { errors: parsed.errors };
  let savedId: number;
  try {
    savedId = repo.saveInvoice(id, parsed.data);
  } catch (error) {
    if (error instanceof RangeError) return { message: "The invoice total is too large to store." };
    if (error instanceof repo.NotFoundError) return { message: GONE };
    throw error;
  }
  refresh();
  if (id === null) redirect(`/invoices/${savedId}`);
  return { ok: true };
}

export async function markSentAction(id: number, number: string): Promise<FormState> {
  if (!isId(id)) return { message: GONE };
  const parsed = parseInvoiceNumber(number);
  if (!parsed.ok) return { errors: parsed.errors };
  const result = repo.markSent(id, parsed.data);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}

export async function markPaidAction(id: number, paidAt: string): Promise<FormState> {
  if (!isId(id)) return { message: GONE };
  if (typeof paidAt !== "string" || !isValidDate(paidAt)) return { errors: { paidAt: "Enter a valid date" } };
  const result = repo.markPaid(id, paidAt);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}

export async function undoStatusAction(id: number): Promise<FormState> {
  if (!isId(id)) return { message: GONE };
  const result = repo.undoStatus(id);
  if (!result.ok) return { message: result.error };
  refresh();
  return { ok: true };
}

export async function duplicateInvoiceAction(id: number): Promise<FormState> {
  if (!isId(id)) return { message: GONE };
  const copyId = repo.duplicateInvoice(id, today());
  if (copyId === null) return { message: GONE };
  refresh();
  redirect(`/invoices/${copyId}`);
}

export async function deleteInvoiceAction(id: number): Promise<FormState> {
  if (!isId(id) || !repo.deleteInvoice(id)) return { message: GONE };
  refresh();
  redirect("/invoices");
}
