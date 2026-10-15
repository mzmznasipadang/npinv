import { z } from 'zod';
import { isValidDate } from './rules.ts';
import { PROJECT_STATUSES } from './projects.ts';
import type { ProjectFilter, ProjectInput, TaskInput } from './projects.ts';
import type { Parsed } from './schemas.ts';
export type ProjectFormValues = { clientId: string; name: string; description: string; status: string; startDate: string; deadline: string };
export type TaskFormValues = { title: string; dueDate: string; completed: boolean };
export function parseRecordId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
const optionalDate = z.string().refine(s => s === '' || isValidDate(s), 'Enter a valid date').transform(s => s || null);
const projectSchema = z.object({
  clientId: z.string().refine(s => parseRecordId(s) !== null, 'Choose a client').transform(s => Number(s)),
  name: z.string().trim().min(1, 'Enter a project name').max(200),
  description: z.string().trim().max(2000),
  status: z.enum(PROJECT_STATUSES),
  startDate: optionalDate,
  deadline: optionalDate,
}).refine(v => !v.startDate || !v.deadline || v.deadline >= v.startDate, {path:['deadline'], message:'The deadline cannot be before the start date'});
const taskSchema = z.object({ title:z.string().trim().min(1, 'Enter a task title').max(300), dueDate:optionalDate, completed:z.boolean() });
function parsed<T>(result: z.ZodSafeParseResult<T>): Parsed<T> {
  if (result.success) return {ok:true, data:result.data};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) errors[issue.path.join('.') || 'form'] ??= issue.message;
  return {ok:false, errors};
}
export function parseProjectForm(values: unknown): Parsed<ProjectInput> { return parsed(projectSchema.safeParse(values)); }
export function parseTaskForm(values: unknown): Parsed<TaskInput> { return parsed(taskSchema.safeParse(values)); }
export function parseProjectFilter(params: Record<string, string | string[] | undefined>): Parsed<ProjectFilter> {
  const result = z.object({
    q:z.string().trim().max(100).optional(),
    status:z.enum(PROJECT_STATUSES).optional(),
    archived:z.enum(['true', 'false']).transform(s => s === 'true').optional(),
    clientId:z.string().refine(s => parseRecordId(s) !== null, 'Invalid client').transform(Number).optional(),
    attention:z.enum(['overdue', 'upcoming', 'tasks']).optional(),
    sort:z.enum(['deadline', 'updated']).optional(),
  }).safeParse(Object.fromEntries(Object.entries(params).filter(([,v]) => v !== '')));
  return parsed(result);
}

export function parseInvoiceFilter(params: Record<string, string | string[] | undefined>): Parsed<import('./repo.ts').InvoiceFilter> {
  return parsed(z.object({
    q:z.string().trim().max(100).optional(),
    status:z.enum(['all','draft','sent','paid','overdue']).optional(),
    projectId:z.string().refine(s => parseRecordId(s) !== null, 'Invalid project').transform(Number).optional(),
    clientId:z.string().refine(s => parseRecordId(s) !== null, 'Invalid client').transform(Number).optional(),
    currency:z.enum(['IDR','USD']).optional(),
    outstanding:z.enum(['true','false']).transform(s => s === 'true').optional(),
  }).safeParse(Object.fromEntries(Object.entries(params).filter(([,v]) => v !== ''))));
}
