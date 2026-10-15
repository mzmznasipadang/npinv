import Link from 'next/link';
import { connection } from 'next/server';
import { Plus } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { InvoiceTable } from '@/components/invoice-table';
import { ProjectTable } from '@/components/project-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import { dashboard, listInvoices } from '@/lib/repo';
import { workSummary } from '@/lib/projects';
import { today, formatDate } from '@/lib/rules';
import { requireSession } from '@/lib/session';
import { cn } from '@/lib/utils';
function Tile({label,value,hint,href,alert}: {label:string;value:string;hint:string;href:string;alert?:boolean}) {
  return <Link href={href} className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><Card className="h-full transition-colors hover:bg-accent"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className={cn('text-2xl tabular-nums',alert && 'text-destructive')}>{value}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{hint}</CardContent></Card></Link>;
}
export default async function DashboardPage() {
  await connection(); await requireSession();
  const todayDate = today();
  const {summaries,latest} = dashboard(todayDate);
  const work = workSummary(todayDate);
  const attentionInvoices = listInvoices({outstanding:true,status:'overdue'},todayDate,5);
  return <>
    <PageHeader title="Overview"><Button variant="outline" asChild><Link href="/projects/new"><Plus />New project</Link></Button><Button asChild><Link href="/invoices/new"><Plus />New invoice</Link></Button></PageHeader>
    <div className="grid gap-8">
      <section aria-label="Work summary" className="grid gap-4 sm:grid-cols-3">
        <Tile label="Projects in progress" value={String(work.activeCount)} hint="Current projects moving forward" href="/projects?status=in_progress" />
        <Tile label="Overdue projects" value={String(work.overdueCount)} hint="Unfinished work past its deadline" href="/projects?attention=overdue&sort=deadline" alert={work.overdueCount>0} />
        <Tile label="Tasks due or overdue" value={String(work.dueTaskCount)} hint="Unfinished tasks through the next 7 days" href="/projects?attention=tasks&sort=deadline" />
      </section>
      {summaries.map(s => <section key={s.currency} aria-labelledby={`summary-${s.currency}`} className="grid gap-3"><h2 id={`summary-${s.currency}`} className="text-sm font-semibold text-muted-foreground">{s.currency}</h2><div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Outstanding" value={formatMoney(s.outstanding,s.currency)} hint="Balance still owed on sent invoices" href={`/invoices?currency=${s.currency}&outstanding=true`} />
        <Tile label="Overdue" value={formatMoney(s.overdue,s.currency)} hint="Balance owed past the due date" href={`/invoices?currency=${s.currency}&status=overdue&outstanding=true`} alert={s.overdue>0} />
        <Card><CardHeader><CardDescription>Paid this month</CardDescription><CardTitle className="text-2xl tabular-nums">{formatMoney(s.paidThisMonth,s.currency)}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Payments received, by payment date</CardContent></Card>
      </div></section>)}
      <section aria-labelledby="deadlines" className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="deadlines" className="text-lg font-semibold">Project deadlines</h2><Link className="text-sm font-semibold underline underline-offset-4" href="/projects?attention=upcoming&sort=deadline">Next 7 days</Link></div>
        {work.overdue.length || work.upcoming.length ? <ProjectTable projects={[...work.overdue,...work.upcoming].slice(0,5)} todayDate={todayDate} /> : <EmptyState title="No deadlines coming up" text="Add a project deadline to see upcoming work here."><Button asChild variant="outline"><Link href="/projects/new">New project</Link></Button></EmptyState>}
      </section>
      <section aria-labelledby="due-tasks" className="grid gap-3"><div className="flex items-center justify-between gap-3"><h2 id="due-tasks" className="text-lg font-semibold">Tasks needing attention</h2><Link href="/projects?attention=tasks&sort=deadline" className="text-sm font-semibold underline underline-offset-4">View projects</Link></div>
        {work.tasks.length ? <ul className="divide-y">{work.tasks.slice(0,5).map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><Link className="font-semibold underline underline-offset-4 break-words" href={`/projects/${t.projectId}`}>{t.title}</Link><p className="text-sm text-muted-foreground">{t.projectName}</p></div><span className={cn('text-sm',t.dueDate! < todayDate && 'text-destructive')}>{formatDate(t.dueDate!)}{t.dueDate! < todayDate ? ' · Overdue' : ''}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No unfinished tasks due through the next 7 days.</p>}
      </section>
      {attentionInvoices.length ? <section aria-labelledby="overdue-invoices" className="grid gap-3"><h2 id="overdue-invoices" className="text-lg font-semibold">Invoices needing attention</h2><InvoiceTable rows={attentionInvoices} /></section> : null}
      <section aria-labelledby="latest" className="grid gap-3"><div className="flex items-center justify-between gap-3"><h2 id="latest" className="text-lg font-semibold">Latest invoices</h2><Link href="/invoices" className="text-sm font-semibold underline underline-offset-4">View all</Link></div>{latest.length ? <InvoiceTable rows={latest} /> : <EmptyState title="No invoices yet" text="Create an invoice on its own or from a project."><Button asChild><Link href="/invoices/new">New invoice</Link></Button></EmptyState>}</section>
    </div>
  </>;
}
