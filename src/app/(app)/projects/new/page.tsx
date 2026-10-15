import Link from 'next/link';
import { connection } from 'next/server';
import { requireSession } from '@/lib/session';
import { listClients } from '@/lib/repo';
import { parseRecordId } from '@/lib/project-schemas';
import { ProjectForm } from '@/components/project-form';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
export default async function NewProjectPage({searchParams}:PageProps<'/projects/new'>) {
  await connection(); await requireSession();
  const clients = listClients();
  const params = await searchParams;
  const clientId = parseRecordId(params.clientId);
  return <><PageHeader title="New project" />{clients.length ? <ProjectForm key={clientId} project={null} clients={clients} clientId={clientId ?? undefined} /> : <EmptyState title="Add a client first" text="Each project belongs to a client."><Button asChild><Link href="/clients">Add a client</Link></Button></EmptyState>}</>;
}
