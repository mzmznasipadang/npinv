'use client';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Field, invalid } from '@/components/field';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAction, useServerForm } from '@/hooks/use-actions';
import { deleteTaskAction, saveTaskAction } from '@/lib/project-actions';
import { formatDate } from '@/lib/rules';
import type { Task } from '@/lib/projects';
import type { TaskFormValues } from '@/lib/project-schemas';
function TaskEditor({projectId, task, onSaved}: {projectId:number; task?:Task; onSaved?:() => void}) {
  const prefix = useId();
  const empty = {title:'', dueDate:'', completed:false};
  const form = useServerForm<TaskFormValues>(task ? {title:task.title, dueDate:task.dueDate ?? '', completed:task.completed} : empty, async values => {
    const result = await saveTaskAction(projectId, task?.id ?? null, values);
    if (result.ok) { onSaved?.(); toast.success(task ? 'Task saved' : 'Task added'); }
    return result;
  });
  return <form onSubmit={form.onSubmit} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start">
    <Field id={`${prefix}-title`} label={task ? 'Task title' : 'New task'} error={form.errors.title}><Input id={`${prefix}-title`} value={form.values.title} onChange={e => form.set('title',e.target.value)} {...invalid(`${prefix}-title`,form.errors.title)} /></Field>
    <Field id={`${prefix}-due`} label="Due date (optional)" error={form.errors.dueDate}><Input id={`${prefix}-due`} type="date" value={form.values.dueDate} onChange={e => form.set('dueDate',e.target.value)} {...invalid(`${prefix}-due`,form.errors.dueDate)} /></Field>
    <div className="flex flex-wrap gap-2 sm:pt-6"><Button type="submit" disabled={form.pending}>{form.pending ? 'Saving…' : task ? 'Save task' : 'Add task'}</Button>{task ? <Button type="button" variant="outline" onClick={onSaved}>Cancel</Button> : null}</div>
  </form>;
}
function TaskRow({projectId, task, todayDate}: {projectId:number; task:Task; todayDate:string}) {
  const [editing,setEditing] = useState(false);
  const action = useAction();
  const overdue = !task.completed && task.dueDate && task.dueDate < todayDate;
  return <li className="py-4">{editing ? <TaskEditor projectId={projectId} task={task} onSaved={() => setEditing(false)} /> : <div className="flex flex-wrap items-center gap-3">
    <label className="flex min-w-0 flex-1 items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={task.completed} disabled={action.pending} onChange={() => action.run(() => saveTaskAction(projectId,task.id,{title:task.title, dueDate:task.dueDate ?? '', completed:!task.completed}))} /><span className="min-w-0 break-words"><span className={task.completed ? 'text-muted-foreground line-through' : ''}>{task.title}</span>{task.dueDate ? <span className={`mt-1 block text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>{formatDate(task.dueDate)}{overdue ? ' · Overdue' : ''}</span> : null}</span></label>
    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>Edit<span className="sr-only"> {task.title}</span></Button>
    <ConfirmButton label="Remove" title={`Remove “${task.title}”?`} description="This task will be removed from the checklist." confirmLabel="Remove task" action={deleteTaskAction.bind(null,projectId,task.id)} />
  </div>}</li>;
}
export function TaskChecklist({projectId,tasks,todayDate}: {projectId:number; tasks:Task[]; todayDate:string}) {
  const [newTaskKey, setNewTaskKey] = useState(0);
  return <div className="grid gap-4">{tasks.length ? <ul className="divide-y">{tasks.map(task => <TaskRow key={`${task.id}-${task.title}-${task.dueDate}-${task.completed}`} projectId={projectId} task={task} todayDate={todayDate} />)}</ul> : <p className="text-sm text-muted-foreground">No tasks yet. Add the first step for this project.</p>}<TaskEditor key={newTaskKey} projectId={projectId} onSaved={() => setNewTaskKey(k => k + 1)} /></div>;
}
