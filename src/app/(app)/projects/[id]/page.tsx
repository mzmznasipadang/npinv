import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { getProject, listTasks } from '@/lib/projects';
import { parseRecordId } from '@/lib/project-schemas';
import { listClients } from '@/lib/repo';
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
  return <><PageHeader title={project.name}><ProjectStatusBadge status={project.status} archived={!!project.archivedAt} /><ConfirmButton label={project.archivedAt ? 'Restore' : 'Archive'} title={project.archivedAt ? 'Restore project?' : 'Archive project?'} description="Project history and linked invoices will be kept." confirmLabel={project.archivedAt ? 'Restore project' : 'Archive project'} action={archiveProjectAction.bind(null, project.id, !project.archivedAt)} /></PageHeader>
    {project.archivedAt ? <p className="mb-6 text-sm text-muted-foreground">Archived project. Restore it to include it in current work and create linked invoices.</p> : null}
    <ProjectForm key={project.id} project={project} clients={listClients()} />
    <section className="mt-10 grid gap-4" aria-labelledby="tasks"><h2 id="tasks" className="text-lg font-semibold">Tasks <span className="text-sm font-normal text-muted-foreground">{project.completedTaskCount}/{project.taskCount} completed</span></h2><TaskChecklist projectId={project.id} tasks={listTasks(project.id)} todayDate={today()} /></section>
  </>;
}
