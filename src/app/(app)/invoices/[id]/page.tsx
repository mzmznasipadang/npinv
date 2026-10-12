import { notFound } from "next/navigation";
import { connection } from "next/server";
import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { invoiceToValues } from "@/lib/invoice-form";
import { getInvoice, getSettings, listClients, suggestNumber } from "@/lib/repo";
import { displayStatus, today } from "@/lib/rules";

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  await connection();
  const { id } = await params;
  const invoice = /^\d{1,15}$/.test(id) ? getInvoice(Number(id)) : null;
  if (!invoice) notFound();
  const settings = getSettings();
  const todayDate = today();

  return (
    <>
      <PageHeader title={invoice.number ?? "Draft invoice"}>
        <StatusBadge status={displayStatus(invoice.status, invoice.dueDate, todayDate)} />
      </PageHeader>
      <InvoiceForm
        key={invoice.id}
        invoiceId={invoice.id}
        initial={invoiceToValues(invoice, settings)}
        clients={listClients()}
        taxLabel={settings.taxLabel}
        status={{
          id: invoice.id,
          status: invoice.status,
          number: invoice.number,
          suggestedNumber: invoice.number ?? suggestNumber(invoice.id) ?? "",
          today: todayDate,
        }}
      />
    </>
  );
}
