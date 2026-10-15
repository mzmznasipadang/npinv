import { getDb, transaction } from './db.ts';
import { NotFoundError, ProjectConflictError } from './repo.ts';
import { addDays } from './rules.ts';

export const PROJECT_STATUSES = ['planned', 'in_progress', 'on_hold', 'completed'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];
export type ProjectInput = { clientId: number; name: string; description: string; status: ProjectStatus; startDate: string | null; deadline: string | null };
export type Project = ProjectInput & { id: number; clientName: string; archivedAt: string | null; updatedAt: string; taskCount: number; completedTaskCount: number };
export type TaskInput = { title: string; dueDate: string | null; completed: boolean };
export type Task = TaskInput & { id: number; projectId: number };
export type ProjectFilter = { q?: string; status?: ProjectStatus; archived?: boolean; clientId?: number; attention?: 'overdue' | 'upcoming' | 'tasks'; sort?: 'deadline' | 'updated' };
const COLS = `p.id, p.client_id AS clientId, c.name AS clientName, p.name, p.description, p.status,
 p.start_date AS startDate, p.deadline, p.archived_at AS archivedAt, p.updated_at AS updatedAt,
 (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) AS taskCount,
 (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND completed = 1) AS completedTaskCount`;
const STAMP = "strftime('%Y-%m-%d %H:%M:%f', 'now')";
type Arg = string | number | null;

export function listProjects(filter: ProjectFilter, todayDate: string): Project[] {
  const where = [filter.archived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL'];
  const args: Arg[] = [];
  if (filter.clientId !== undefined) { where.push('p.client_id = ?'); args.push(filter.clientId); }
  if (filter.status) { where.push('p.status = ?'); args.push(filter.status); }
  if (filter.q?.trim()) {
    const like = `%${filter.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(p.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')"); args.push(like, like);
  }
  if (filter.attention) {
    where.push("p.status != 'completed' AND p.archived_at IS NULL");
    if (filter.attention === 'overdue') { where.push('p.deadline < ?'); args.push(todayDate); }
    if (filter.attention === 'upcoming') { where.push('p.deadline BETWEEN ? AND ?'); args.push(todayDate, addDays(todayDate, 7)); }
    if (filter.attention === 'tasks') { where.push('EXISTS (SELECT 1 FROM tasks WHERE project_id = p.id AND completed = 0 AND due_date <= ?)'); args.push(addDays(todayDate, 7)); }
  }
  const order = filter.sort === 'deadline' ? 'p.deadline IS NULL, p.deadline, p.id DESC' : 'p.updated_at DESC, p.id DESC';
  return getDb().prepare(`SELECT ${COLS} FROM projects p JOIN clients c ON c.id = p.client_id WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...args).map(row => ({...row}) as Project);
}

export function getProject(id: number): Project | null {
  const row = getDb().prepare(`SELECT ${COLS} FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?`).get(id);
  return row ? {...row} as Project : null;
}

export function saveProject(id: number | null, input: ProjectInput): number {
  return transaction(() => {
    const db = getDb();
    if (id !== null && !getProject(id)) throw new NotFoundError('Project no longer exists.');
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(input.clientId)) throw new ProjectConflictError('clientId', 'Choose an existing client.');
    if (id !== null && db.prepare('SELECT id FROM invoices WHERE project_id = ? AND client_id != ? LIMIT 1').get(id, input.clientId)) {
      throw new ProjectConflictError('clientId', 'The client cannot change while invoices are linked.');
    }
    const args = [input.clientId, input.name, input.description, input.status, input.startDate, input.deadline];
    if (id === null) return Number(db.prepare('INSERT INTO projects (client_id, name, description, status, start_date, deadline) VALUES (?, ?, ?, ?, ?, ?)').run(...args).lastInsertRowid);
    db.prepare(`UPDATE projects SET client_id = ?, name = ?, description = ?, status = ?, start_date = ?, deadline = ?, updated_at = ${STAMP} WHERE id = ?`).run(...args, id);
    return id;
  });
}

export function setProjectArchived(id: number, archived: boolean): void {
  const result = getDb().prepare(`UPDATE projects SET archived_at = ${archived ? STAMP : 'NULL'}, updated_at = ${STAMP} WHERE id = ?`).run(id);
  if (!result.changes) throw new NotFoundError('Project no longer exists.');
}

export function listTasks(projectId: number): Task[] {
  return getDb().prepare(`SELECT id, project_id AS projectId, title, due_date AS dueDate, completed FROM tasks WHERE project_id = ? ORDER BY completed, due_date IS NULL, due_date, id`).all(projectId).map(row => ({...row, completed: Boolean(row.completed)}) as Task);
}

export function saveTask(projectId: number, id: number | null, input: TaskInput): number {
  return transaction(() => {
    const db = getDb();
    if (!getProject(projectId)) throw new NotFoundError('Project no longer exists.');
    let savedId = id;
    if (id === null) savedId = Number(db.prepare('INSERT INTO tasks (project_id, title, due_date, completed) VALUES (?, ?, ?, ?)').run(projectId, input.title, input.dueDate, Number(input.completed)).lastInsertRowid);
    else if (!db.prepare(`UPDATE tasks SET title = ?, due_date = ?, completed = ?, updated_at = ${STAMP} WHERE id = ? AND project_id = ?`).run(input.title, input.dueDate, Number(input.completed), id, projectId).changes) throw new NotFoundError('Task no longer exists.');
    db.prepare(`UPDATE projects SET updated_at = ${STAMP} WHERE id = ?`).run(projectId);
    return savedId!;
  });
}

export function deleteTask(projectId: number, id: number): boolean {
  return transaction(() => {
    const db = getDb();
    const deleted = db.prepare('DELETE FROM tasks WHERE id = ? AND project_id = ?').run(id, projectId).changes > 0;
    if (deleted) db.prepare(`UPDATE projects SET updated_at = ${STAMP} WHERE id = ?`).run(projectId);
    return deleted;
  });
}
