import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { InvoiceTable } from '@/components/invoice-table';
import { EmptyState } from '@/components/empty-state';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { getProject, listTasks } from '@/lib/projects';
import { parseRecordId } from '@/lib/project-schemas';
import { listClients, listInvoices } from '@/lib/repo';
import { archiveProjectAction } from '@/lib/project-actions';
import { today } from '@/lib/rules';
import { PageHeader } from '@/components/page-header';
import { ProjectForm } from '@/components/project-form';
import { ProjectStatusBadge } from '@/components/project-status';
import { TaskChecklist } from '@/components/task-checklist';
import { ConfirmButton } from '@/components/confirm-button';
export default async function ProjectPage({params}:PageProps<'/projects/[id]'>) {
  await connection(); await requireSession();
  const id = parseRecordId((await params).id);
  const project = id === null ? null : getProject(id);
  if (!project) notFound();
  const todayDate = today();
  const invoices = listInvoices({projectId:project.id},todayDate,5);
  return <><PageHeader title={project.name}><ProjectStatusBadge status={project.status} archived={!!project.archivedAt} /><ConfirmButton label={project.archivedAt ? 'Restore' : 'Archive'} title={project.archivedAt ? 'Restore project?' : 'Archive project?'} description="Project history and linked invoices will be kept." confirmLabel={project.archivedAt ? 'Restore project' : 'Archive project'} action={archiveProjectAction.bind(null, project.id, !project.archivedAt)} /></PageHeader>
    {project.archivedAt ? <p className="mb-6 text-sm text-muted-foreground">Archived project. Restore it to include it in current work and create linked invoices.</p> : null}
    {!project.archivedAt ? <div className="mb-6"><Button asChild><Link href={`/invoices/new?projectId=${project.id}`}>New invoice for project</Link></Button></div> : null}
    <ProjectForm key={project.id} project={project} clients={listClients()} />
    <section className="mt-10 grid gap-4" aria-labelledby="tasks"><h2 id="tasks" className="text-lg font-semibold">Tasks <span className="text-sm font-normal text-muted-foreground">{project.completedTaskCount}/{project.taskCount} completed</span></h2><TaskChecklist projectId={project.id} tasks={listTasks(project.id)} todayDate={todayDate} /></section>
    <section className="mt-10 grid gap-4" aria-labelledby="linked-invoices"><div className="flex items-center justify-between gap-3"><h2 id="linked-invoices" className="text-lg font-semibold">Linked invoices</h2><Link href={`/invoices?projectId=${project.id}`} className="text-sm font-semibold underline underline-offset-4">View all invoices</Link></div>{invoices.length ? <InvoiceTable rows={invoices} /> : <EmptyState title="No linked invoices" text="Create an invoice for this project to track its payments here." />}</section>
  </>;
}
