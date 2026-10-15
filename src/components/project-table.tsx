import Link from 'next/link';
import { ProjectStatusBadge } from '@/components/project-status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/rules';
import type { Project } from '@/lib/projects';
export function ProjectTable({projects, todayDate}: {projects:Project[]; todayDate:string}) {
  return <Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead>Deadline</TableHead><TableHead className="text-right">Tasks</TableHead></TableRow></TableHeader><TableBody>{projects.map(p => {
    const overdue = !p.archivedAt && p.status !== 'completed' && p.deadline && p.deadline < todayDate;
    return <TableRow key={p.id}><TableCell className="font-semibold"><Link href={`/projects/${p.id}`} className="underline underline-offset-4">{p.name}</Link></TableCell><TableCell>{p.clientName}</TableCell><TableCell><ProjectStatusBadge status={p.status} archived={!!p.archivedAt} /></TableCell><TableCell>{p.deadline ? <span className={overdue ? 'text-destructive' : ''}>{formatDate(p.deadline)}{overdue ? ' · Overdue' : ''}</span> : <span className="text-muted-foreground">No deadline</span>}</TableCell><TableCell className="text-right tabular-nums">{p.completedTaskCount}/{p.taskCount}</TableCell></TableRow>;
  })}</TableBody></Table>;
}
