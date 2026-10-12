"use server";

import { revalidatePath } from "next/cache";
import * as repo from "./repo";
import { parseClientForm, parseSettingsForm } from "./schemas";
import type { ClientFormValues, FormState, SettingsFormValues } from "./schemas";

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
