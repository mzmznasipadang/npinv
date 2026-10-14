import { amountToInput, percentToInput } from "./money.ts";
import type { Currency, Portion } from "./money.ts";
import { addDays } from "./rules.ts";
import type { Invoice, Settings } from "./repo.ts";
import type { InvoiceFormValues, ItemFormValues, PaymentFormValues, SettingsFormValues } from "./schemas.ts";

export function blankItem(): ItemFormValues {
  return { description: "", qty: "1", unitPrice: "", notes: "" };
}

/** A percentage or amount as form text; empty when there is none. */
function portionToInput(type: Portion["type"], value: number, currency: Currency): string {
  if (value === 0) return "";
  return type === "amount" ? amountToInput(value, currency) : percentToInput(value);
}

export function blankInvoiceValues(s: Settings, todayDate: string): InvoiceFormValues {
  return {
    clientId: "",
    billToName: "",
    billToCompany: "",
    billToAddress: "",
    issueDate: todayDate,
    dueDate: addDays(todayDate, s.defaultDueDays),
    currency: s.defaultCurrency,
    taxEnabled: false,
    taxRate: percentToInput(s.defaultTaxRateBp),
    discountEnabled: false,
    discountType: "percent",
    discount: "",
    downPaymentEnabled: false,
    downPaymentType: "percent",
    downPayment: "",
    notes: s.defaultNotes,
    items: [blankItem()],
  };
}

export function invoiceToValues(inv: Invoice, s: Settings): InvoiceFormValues {
  return {
    clientId: inv.clientId === null ? "" : String(inv.clientId),
    billToName: inv.billToName,
    billToCompany: inv.billToCompany,
    billToAddress: inv.billToAddress,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    taxEnabled: inv.taxRateBp > 0,
    taxRate: percentToInput(inv.taxRateBp > 0 ? inv.taxRateBp : s.defaultTaxRateBp),
    discountEnabled: inv.discountValue > 0,
    discountType: inv.discountType,
    discount: portionToInput(inv.discountType, inv.discountValue, inv.currency),
    downPaymentEnabled: inv.downPaymentValue > 0,
    downPaymentType: inv.downPaymentType,
    downPayment: portionToInput(inv.downPaymentType, inv.downPaymentValue, inv.currency),
    notes: inv.notes,
    items: inv.items.map((item) => ({
      description: item.description,
      qty: String(item.qty),
      unitPrice: amountToInput(item.unitPrice, inv.currency),
      notes: item.notes,
    })),
  };
}

export function settingsToValues(s: Settings): SettingsFormValues {
  return {
    businessName: s.businessName,
    businessAddress: s.businessAddress,
    businessEmail: s.businessEmail,
    businessPhone: s.businessPhone,
    paymentDetails: s.paymentDetails,
    defaultCurrency: s.defaultCurrency,
    defaultTaxRate: percentToInput(s.defaultTaxRateBp),
    taxLabel: s.taxLabel,
    invoicePrefix: s.invoicePrefix,
    defaultDueDays: String(s.defaultDueDays),
    defaultNotes: s.defaultNotes,
  };
}

/** A payment of the whole balance, dated today. */
export function blankPaymentValues(balance: number, currency: Currency, todayDate: string): PaymentFormValues {
  return { paidOn: todayDate, amount: amountToInput(balance, currency), note: "", writeOff: false };
}
