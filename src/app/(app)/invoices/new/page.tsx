import { connection } from "next/server";
import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/page-header";
import { blankInvoiceValues } from "@/lib/invoice-form";
import { getSettings, listClients } from "@/lib/repo";
import { today } from "@/lib/rules";

export default async function NewInvoicePage() {
  await connection();
  const settings = getSettings();
  return (
    <>
      <PageHeader title="New invoice" />
      <InvoiceForm
        invoiceId={null}
        initial={blankInvoiceValues(settings, today())}
        clients={listClients()}
        taxLabel={settings.taxLabel}
      />
    </>
  );
}
