import { z } from "zod";
import { parseAmount, parsePercent } from "./money.ts";
import type { Currency } from "./money.ts";
import { isValidDate } from "./rules.ts";
import type { ClientInput, InvoiceInput, Settings } from "./repo.ts";

export type FieldErrors = Record<string, string>;
export type FormState = { ok?: boolean; errors?: FieldErrors; message?: string };
export type Parsed<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

export type ItemFormValues = { description: string; qty: string; unitPrice: string; notes: string };

export type InvoiceFormValues = {
  clientId: string;
  billToName: string;
  billToCompany: string;
  billToAddress: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxEnabled: boolean;
  taxRate: string;
  notes: string;
  items: ItemFormValues[];
};

export type ClientFormValues = { name: string; company: string; address: string; email: string; phone: string };

export type SettingsFormValues = {
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  paymentDetails: string;
  defaultCurrency: string;
  defaultTaxRate: string;
  taxLabel: string;
  invoicePrefix: string;
  defaultDueDays: string;
  defaultNotes: string;
};

const RATE_MESSAGE = "Enter a rate between 0 and 100";
const DAYS_MESSAGE = "A number of days from 0 to 365";

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);
const required = (max: number, message: string) => text(max).min(1, message);
const date = z.string().refine(isValidDate, "Enter a valid date");
const email = z.union([z.literal(""), z.email("Enter a valid email address")]);
const currency = z.enum(["IDR", "USD"], "Choose IDR or USD");

/** A percentage such as "11" or "11.5", stored as basis points. */
const percent = z
  .string()
  .refine((s) => parsePercent(s) !== null, RATE_MESSAGE)
  .transform((s) => parsePercent(s) ?? 0);

/** An amount in the given currency, stored in its smallest unit. */
const amount = (cur: Currency) =>
  z
    .string()
    .refine(
      (s) => parseAmount(s, cur) !== null,
      cur === "IDR" ? "Whole rupiah, digits only" : "An amount such as 150 or 150.50",
    )
    .transform((s) => parseAmount(s, cur) ?? 0);

/** The first message for each field, keyed by its dotted path. */
function collect(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) errors[issue.path.join(".") || "form"] ??= issue.message;
  return errors;
}

export function parseInvoiceForm(values: unknown): Parsed<InvoiceInput> {
  // Three rules depend on another field: the price format on the currency, the
  // tax rate on the switch, and the due date on the issue date. The schema is
  // built per submission so every field still reports its own error in one pass.
  const raw = typeof values === "object" && values !== null ? (values as Record<string, unknown>) : {};
  const cur: Currency = raw.currency === "USD" ? "USD" : "IDR";
  const issueDate = typeof raw.issueDate === "string" && isValidDate(raw.issueDate) ? raw.issueDate : null;

  const schema = z.object({
    clientId: z
      .string()
      .regex(/^\d{0,15}$/, "Unknown client")
      .transform((s) => (s === "" ? null : Number(s))),
    billToName: required(200, "Enter the client's name"),
    billToCompany: text(200),
    billToAddress: text(500),
    issueDate: date,
    dueDate: date.refine(
      (d) => issueDate === null || d >= issueDate,
      "The due date cannot be before the issue date",
    ),
    currency,
    taxRate: raw.taxEnabled === true ? percent : z.unknown().transform(() => 0),
    notes: text(2000),
    items: z
      .array(
        z.object({
          description: required(300, "Describe the item"),
          qty: z
            .string()
            .trim()
            .regex(/^[1-9]\d{0,5}$/, "Whole number, at least 1")
            .transform(Number),
          unitPrice: amount(cur),
          notes: text(200),
        }),
      )
      .min(1, "Add at least one item")
      .max(200, "At most 200 items"),
  });

  const result = schema.safeParse(values);
  if (!result.success) return { ok: false, errors: collect(result.error) };
  const { taxRate, ...rest } = result.data;
  return { ok: true, data: { ...rest, taxRateBp: taxRate } };
}

const clientSchema = z.object({
  name: required(200, "Enter a name"),
  company: text(200),
  address: text(500),
  email,
  phone: text(50),
});

export function parseClientForm(values: unknown): Parsed<ClientInput> {
  const result = clientSchema.safeParse(values);
  return result.success ? { ok: true, data: result.data } : { ok: false, errors: collect(result.error) };
}

const settingsSchema = z.object({
  businessName: required(200, "Enter the business name"),
  businessAddress: text(500),
  businessEmail: email,
  businessPhone: text(50),
  paymentDetails: text(1000),
  defaultCurrency: currency,
  defaultTaxRate: percent,
  taxLabel: required(20, "Enter a label, such as PPN"),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, "Letters and digits only, up to 10"),
  defaultDueDays: z
    .string()
    .trim()
    .refine((s) => /^\d{1,3}$/.test(s) && Number(s) <= 365, DAYS_MESSAGE)
    .transform(Number),
  defaultNotes: text(2000),
});

export function parseSettingsForm(values: unknown): Parsed<Settings> {
  const result = settingsSchema.safeParse(values);
  if (!result.success) return { ok: false, errors: collect(result.error) };
  const { defaultTaxRate, ...rest } = result.data;
  return { ok: true, data: { ...rest, defaultTaxRateBp: defaultTaxRate } };
}

// Stored in upper case, so two numbers can never differ only by letter case.
const numberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9/._-]{0,29}$/, "Up to 30 letters, digits, dashes, dots or slashes");

export function parseInvoiceNumber(value: unknown): Parsed<string> {
  const result = numberSchema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, errors: { number: result.error.issues[0].message } };
}
