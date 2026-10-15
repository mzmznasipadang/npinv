'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from './session';
import { NotFoundError, ProjectConflictError } from './repo';
import * as projects from './projects';
import { parseProjectForm } from './project-schemas';
import type { ProjectFormValues, TaskFormValues } from './project-schemas';
import * as writes from './writes';
import type { FormState } from './schemas';
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function failure(error: unknown): FormState {
  if (error instanceof NotFoundError) return {message:error.message};
  if (error instanceof ProjectConflictError) return {errors:{[error.field]:error.message}};
  throw error;
}
export async function saveProjectAction(id: number | null, values: ProjectFormValues): Promise<FormState> {
  await requireSession();
  if (id !== null && !isId(id)) return {message:'Project no longer exists.'};
  const parsed = parseProjectForm(values);
  if (!parsed.ok) return {errors:parsed.errors};
  let saved: number;
  try { saved = projects.saveProject(id, parsed.data); } catch (error) { return failure(error); }
  revalidatePath('/', 'layout');
  if (id === null) redirect(`/projects/${saved}`);
  return {ok:true};
}
export async function archiveProjectAction(id: number, archived: boolean): Promise<FormState> {
  await requireSession();
  if (!isId(id) || typeof archived !== 'boolean') return {message:'Reload the project and try again.'};
  try { projects.setProjectArchived(id, archived); } catch (error) { return failure(error); }
  revalidatePath('/', 'layout');
  return {ok:true};
}
export async function saveTaskAction(projectId: number, id: number | null, values: TaskFormValues): Promise<FormState> {
  await requireSession();
  if (!isId(projectId) || (id !== null && !isId(id))) return {message:'Task no longer exists.'};
  let result: ReturnType<typeof writes.saveTask>;
  try { result = writes.saveTask(projectId, id, values); } catch (error) { return failure(error); }
  if (!result.ok) return {errors:result.errors};
  revalidatePath('/', 'layout');
  return {ok:true};
}
export async function deleteTaskAction(projectId: number, id: number): Promise<FormState> {
  await requireSession();
  if (!isId(projectId) || !isId(id) || !projects.deleteTask(projectId, id)) return {message:'Task no longer exists.'};
  revalidatePath('/', 'layout');
  return {ok:true};
}
