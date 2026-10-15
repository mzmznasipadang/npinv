import Form from 'next/form';
import Link from 'next/link';
import { connection } from 'next/server';
import { Plus } from 'lucide-react';
import { requireSession } from '@/lib/session';
import { parseProjectFilter } from '@/lib/project-schemas';
import { listProjects } from '@/lib/projects';
import { listClients } from '@/lib/repo';
import { today } from '@/lib/rules';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ProjectTable } from '@/components/project-table';
import { PROJECT_STATUS_LABELS } from '@/components/project-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
const selectClass = 'h-9 w-full max-w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring';
export default async function ProjectsPage({searchParams}: PageProps<'/projects'>) {
  await connection(); await requireSession();
  const params = await searchParams;
  const parsed = parseProjectFilter(params);
  const todayDate = today();
  const projects = parsed.ok ? listProjects(parsed.data,todayDate) : [];
  const clients = listClients();
  const value = (key:string) => typeof params[key] === 'string' ? params[key] as string : '';
  return <>
    <PageHeader title="Projects"><Button asChild><Link href="/projects/new"><Plus />New project</Link></Button></PageHeader>
    <Form key={JSON.stringify(params)} action="/projects" className="mb-6 flex flex-wrap items-end gap-3">
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="project-search">Search</Label><Input id="project-search" type="search" name="q" placeholder="Project or client" defaultValue={value('q')} /></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="project-status">Status</Label><select id="project-status" name="status" defaultValue={value('status')} className={selectClass}><option value="">All statuses</option>{Object.entries(PROJECT_STATUS_LABELS).map(([v,label]) => <option value={v} key={v}>{label}</option>)}</select></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="project-client">Client</Label><select id="project-client" name="clientId" defaultValue={value('clientId')} className={selectClass}><option value="">All clients</option>{clients.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="project-attention">Deadlines</Label><select id="project-attention" name="attention" defaultValue={value('attention')} className={selectClass}><option value="">All work</option><option value="overdue">Overdue projects</option><option value="upcoming">Next 7 days</option><option value="tasks">Tasks due or overdue</option></select></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="project-archive">View</Label><select id="project-archive" name="archived" defaultValue={value('archived')} className={selectClass}><option value="">Current projects</option><option value="true">Archived projects</option></select></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="project-sort">Sort</Label><select id="project-sort" name="sort" defaultValue={value('sort') || 'updated'} className={selectClass}><option value="updated">Recently updated</option><option value="deadline">Deadline</option></select></div>
      <Button type="submit" variant="outline">Apply filters</Button><Button variant="ghost" asChild><Link href="/projects">Reset</Link></Button>
    </Form>
    {!parsed.ok ? <p role="alert" className="mb-4 text-sm text-destructive">Invalid filters. Reset them and try again.</p> : null}
    {projects.length ? <ProjectTable projects={projects} todayDate={todayDate} /> : <EmptyState title="No projects here" text={clients.length ? 'Create a project or adjust your filters.' : 'Add a client before creating your first project.'}><Button asChild><Link href={clients.length ? '/projects/new' : '/clients'}>{clients.length ? 'New project' : 'Add a client'}</Link></Button></EmptyState>}
  </>;
}
