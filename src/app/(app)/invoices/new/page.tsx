import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getProject, listProjects } from "@/lib/projects";
import { parseRecordId } from "@/lib/project-schemas";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { connection } from "next/server";
import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/page-header";
import { blankInvoiceValues } from "@/lib/invoice-form";
import { getSettings, listClients } from "@/lib/repo";
import { today } from "@/lib/rules";

export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  await connection();
  await requireSession();
  const settings = getSettings();
  const todayDate = today();
  const initial = blankInvoiceValues(settings, todayDate);
  const clients = listClients();
  const params = await searchParams;
  if (params.projectId !== undefined) {
    const id = parseRecordId(params.projectId);
    const project = id === null ? null : getProject(id);
    const client = clients.find(c => c.id === project?.clientId);
    if (!project || project.archivedAt || !client) return <><PageHeader title="New invoice" /><EmptyState title="Project unavailable" text="Choose a current project, or restore an archived project before creating a linked invoice."><Button asChild><Link href="/projects">View projects</Link></Button></EmptyState></>;
    Object.assign(initial, { projectId:String(project.id), clientId:String(client.id), billToName:client.name, billToCompany:client.company, billToAddress:client.address });
  }
  return (
    <>
      <PageHeader title="New invoice" />
      {/* Next keeps this page mounted while hidden, so a half-typed draft survives a visit elsewhere.
          The key starts it again when the date or the defaults in Settings change. */}
      <InvoiceForm
        key={JSON.stringify(initial)}
        invoiceId={null}
        initial={initial}
        clients={clients}
        projects={listProjects({},todayDate)}
        taxLabel={settings.taxLabel}
      />
    </>
  );
}
