import Form from 'next/form';
import Link from 'next/link';
import { connection } from 'next/server';
import { Plus } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { InvoiceTable } from '@/components/invoice-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listClients, listInvoices } from '@/lib/repo';
import { listProjects } from '@/lib/projects';
import { parseInvoiceFilter } from '@/lib/project-schemas';
import { requireSession } from '@/lib/session';
import { today } from '@/lib/rules';
const FILTERS = [{value:'all',label:'All'},{value:'draft',label:'Draft'},{value:'sent',label:'Sent'},{value:'overdue',label:'Overdue'},{value:'paid',label:'Paid'}] as const;
const selectClass = 'h-9 w-full max-w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring';
export default async function InvoicesPage({searchParams}:PageProps<'/invoices'>) {
  await connection(); await requireSession();
  const params = await searchParams;
  const parsed = parseInvoiceFilter(params);
  const filter = parsed.ok ? parsed.data : {};
  const todayDate = today();
  const projects = [...listProjects({},todayDate), ...listProjects({archived:true},todayDate)];
  const clients = listClients();
  const rows = parsed.ok ? listInvoices(filter,todayDate) : [];
  const selectedProject = projects.find(p => p.id === filter.projectId);
  const selectedClient = clients.find(c => c.id === filter.clientId);
  const filtered = Object.values(filter).some(v => v !== undefined && v !== '' && v !== 'all' && v !== false);
  function hrefFor(status:string) {
    const search = new URLSearchParams();
    for (const [key,value] of Object.entries(filter)) if (value !== undefined && value !== '' && value !== false) search.set(key,String(value));
    if (status === 'all') search.delete('status'); else search.set('status',status);
    return `/invoices${search.size ? `?${search}` : ''}`;
  }
  return <><PageHeader title="Invoices"><Button asChild><Link href="/invoices/new"><Plus />New invoice</Link></Button></PageHeader>
    <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">{FILTERS.map(f => <Button key={f.value} asChild size="sm" variant={f.value === (filter.status ?? 'all') ? 'default' : 'outline'}><Link href={hrefFor(f.value)} aria-current={f.value === (filter.status ?? 'all') ? 'page' : undefined}>{f.label}</Link></Button>)}</nav>
    <Form key={JSON.stringify(params)} action="/invoices" className="mb-6 flex flex-wrap items-end gap-3">
      {filter.status && filter.status !== 'all' ? <input type="hidden" name="status" value={filter.status} /> : null}
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="invoice-search">Search</Label><Input id="invoice-search" type="search" name="q" placeholder="Number or client" defaultValue={filter.q ?? ''} /></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="invoice-project">Project</Label><select id="invoice-project" name="projectId" defaultValue={filter.projectId ?? ''} className={selectClass}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.archivedAt ? ' (archived)' : ''}</option>)}</select></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="invoice-client">Client</Label><select id="invoice-client" name="clientId" defaultValue={filter.clientId ?? ''} className={selectClass}><option value="">All clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="grid min-w-0 max-w-full gap-1.5"><Label htmlFor="invoice-currency">Currency</Label><select id="invoice-currency" name="currency" defaultValue={filter.currency ?? ''} className={selectClass}><option value="">All currencies</option><option>IDR</option><option>USD</option></select></div>
      <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" name="outstanding" value="true" defaultChecked={filter.outstanding} className="size-4 accent-primary" />Outstanding only</label>
      <Button type="submit" variant="outline">Apply filters</Button><Button variant="ghost" asChild><Link href="/invoices">Reset</Link></Button>
    </Form>
    {!parsed.ok ? <p role="alert" className="mb-4 text-sm text-destructive">Invalid filters. Reset them and try again.</p> : null}
    {selectedProject || selectedClient ? <p className="mb-4 text-sm text-muted-foreground">{selectedProject ? `Project: ${selectedProject.name}` : ''}{selectedProject && selectedClient ? ' · ' : ''}{selectedClient ? `Client: ${selectedClient.name}` : ''}</p> : null}
    {rows.length ? <InvoiceTable rows={rows} /> : filtered || !parsed.ok ? <EmptyState title="No invoices match" text="Adjust your filters or reset the list." /> : <EmptyState title="No invoices yet" text="Create your first invoice and it will appear here."><Button asChild><Link href="/invoices/new">New invoice</Link></Button></EmptyState>}
  </>;
}
