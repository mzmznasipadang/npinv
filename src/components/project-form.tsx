'use client';
import { useId } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Field, invalid } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PROJECT_STATUS_LABELS } from '@/components/project-status';
import { useServerForm } from '@/hooks/use-actions';
import { saveProjectAction } from '@/lib/project-actions';
import type { Project } from '@/lib/projects';
import type { Client } from '@/lib/repo';
import type { ProjectFormValues } from '@/lib/project-schemas';
export function ProjectForm({project, clients, clientId}: {project:Project | null; clients:Client[]; clientId?:number}) {
  const prefix = useId();
  const form = useServerForm<ProjectFormValues>({name:project?.name ?? '', description:project?.description ?? '', clientId:String(project?.clientId ?? clientId ?? ''), status:project?.status ?? 'planned', startDate:project?.startDate ?? '', deadline:project?.deadline ?? ''}, async values => {
    const result = await saveProjectAction(project?.id ?? null, values);
    if (result.ok) toast.success('Project saved');
    return result;
  });
  const {values, errors, set} = form;
  const bind = (name:'name' | 'description' | 'startDate' | 'deadline') => ({id:`${prefix}-${name}`, value:values[name], onChange:(e:React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(name,e.target.value), ...invalid(`${prefix}-${name}`,errors[name])});
  return <form onSubmit={form.onSubmit} noValidate className="grid max-w-3xl gap-5">
    <Field id={`${prefix}-name`} label="Project name" error={errors.name}><Input {...bind('name')} autoComplete="off" /></Field>
    <div className="grid gap-5 sm:grid-cols-2">
      <Field id={`${prefix}-clientId`} label="Client" error={errors.clientId}>
        <Select value={values.clientId} onValueChange={v => set('clientId', v)}><SelectTrigger id={`${prefix}-clientId`} className="w-full" {...invalid(`${prefix}-clientId`,errors.clientId)}><SelectValue placeholder="Choose a client" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select>
      </Field>
      <Field id={`${prefix}-status`} label="Status" error={errors.status}>
        <Select value={values.status} onValueChange={v => set('status', v)}><SelectTrigger id={`${prefix}-status`} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PROJECT_STATUS_LABELS).map(([v,label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select>
      </Field>
      <Field id={`${prefix}-startDate`} label="Start date (optional)" error={errors.startDate}><Input type="date" {...bind('startDate')} /></Field>
      <Field id={`${prefix}-deadline`} label="Deadline (optional)" error={errors.deadline}><Input type="date" {...bind('deadline')} /></Field>
    </div>
    <Field id={`${prefix}-description`} label="Notes (optional)" error={errors.description}><Textarea rows={4} {...bind('description')} /></Field>
    {form.errors.form ? <p role="alert" className="text-sm text-destructive">{form.errors.form}</p> : null}
    <div className="flex flex-wrap gap-3"><Button disabled={form.pending || clients.length === 0} type="submit">{form.pending ? 'Saving…' : 'Save project'}</Button><Button variant="outline" asChild><Link href="/projects">Back to projects</Link></Button></div>
  </form>;
}
