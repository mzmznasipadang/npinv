import { connection } from "next/server";
import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/page-header";
import { blankInvoiceValues } from "@/lib/invoice-form";
import { getSettings, listClients } from "@/lib/repo";
import { today } from "@/lib/rules";

export default async function NewInvoicePage() {
  await connection();
  const settings = getSettings();
  const initial = blankInvoiceValues(settings, today());
  return (
    <>
      <PageHeader title="New invoice" />
      {/* Next keeps this page mounted while hidden, so a half-typed draft survives a visit elsewhere.
          The key starts it again when the date or the defaults in Settings change. */}
      <InvoiceForm
        key={JSON.stringify(initial)}
        invoiceId={null}
        initial={initial}
        clients={listClients()}
        taxLabel={settings.taxLabel}
      />
    </>
  );
}
