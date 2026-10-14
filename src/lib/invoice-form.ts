import { amountToInput, percentToInput } from "./money.ts";
import { addDays } from "./rules.ts";
import type { Invoice, Settings } from "./repo.ts";
import type { InvoiceFormValues, ItemFormValues, SettingsFormValues } from "./schemas.ts";

export function blankItem(): ItemFormValues {
  return { description: "", qty: "1", unitPrice: "", notes: "" };
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
    discount:
      inv.discountValue === 0
        ? ""
        : inv.discountType === "amount"
          ? amountToInput(inv.discountValue, inv.currency)
          : percentToInput(inv.discountValue),
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
