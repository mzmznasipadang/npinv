import { requireSession } from "@/lib/session";
import { getProject, listProjects } from "@/lib/projects";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/page-header";
import { PaymentsCard } from "@/components/payments-card";
import { StatusBadge } from "@/components/status-badge";
import { invoiceToValues } from "@/lib/invoice-form";
import { getInvoice, getSettings, listClients, suggestNumber } from "@/lib/repo";
import { displayStatus, today } from "@/lib/rules";

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  await connection();
  await requireSession();
  const { id } = await params;
  const invoice = /^\d{1,15}$/.test(id) ? getInvoice(Number(id)) : null;
  if (!invoice) notFound();
  const settings = getSettings();
  const todayDate = today();
  const projects = listProjects({}, todayDate);
  const linked = invoice.projectId === null ? null : getProject(invoice.projectId);
  if (linked?.archivedAt) projects.push(linked);

  return (
    <>
      <PageHeader title={invoice.number ?? "Draft invoice"}>
        <StatusBadge status={displayStatus(invoice.status, invoice.dueDate, todayDate, invoice.paid)} />
      </PageHeader>
      <InvoiceForm
        key={invoice.id}
        invoiceId={invoice.id}
        initial={invoiceToValues(invoice, settings)}
        clients={listClients()}
        projects={projects}
        taxLabel={settings.taxLabel}
        status={{
          id: invoice.id,
          status: invoice.status,
          number: invoice.number,
          suggestedNumber: invoice.number ?? suggestNumber(invoice.id) ?? "",
          today: todayDate,
          balance: invoice.balance,
          currency: invoice.currency,
          hasPayments: invoice.payments.length > 0,
        }}
        payments={
          invoice.status === "draft" ? undefined : (
            <PaymentsCard
              invoiceId={invoice.id}
              payments={invoice.payments}
              paid={invoice.paid}
              balance={invoice.balance}
              currency={invoice.currency}
            />
          )
        }
      />
    </>
  );
}
