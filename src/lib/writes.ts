import { parseProjectForm, parseTaskForm } from './project-schemas.ts';
import * as projects from './projects.ts';
import * as repo from './repo.ts';
import { parseClientForm } from './schemas.ts';
import type { FieldErrors } from './schemas.ts';

// One function per write, shared by the web Server Actions and the mobile API so both parse and write the same way.
// They throw the writers' NotFoundError and ProjectConflictError; each caller maps those to its own response.

export function saveTask(projectId: number, id: number | null, values: unknown): { ok: true; id: number } | { ok: false; errors: FieldErrors } {
  const parsed = parseTaskForm(values);
  return parsed.ok ? { ok: true, id: projects.saveTask(projectId, id, parsed.data) } : parsed;
}

export function saveProject(id: number | null, values: unknown): { ok: true; id: number } | { ok: false; errors: FieldErrors } {
  const parsed = parseProjectForm(values);
  return parsed.ok ? { ok: true, id: projects.saveProject(id, parsed.data) } : parsed;
}

export function saveClient(id: number | null, values: unknown): { ok: true; id: number } | { ok: false; errors: FieldErrors } {
  const parsed = parseClientForm(values);
  if (!parsed.ok) return parsed;
  if (id === null) return { ok: true, id: repo.createClient(parsed.data) };
  if (!repo.updateClient(id, parsed.data)) throw new repo.NotFoundError('Client no longer exists.');
  return { ok: true, id };
}
