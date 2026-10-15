import { addDays } from './rules.ts';
import { getDb } from './db.ts';
export type Pagination = { page:number; pageSize:number; total:number; hasMore:boolean };
export type Page<T> = { data:T[]; pagination:Pagination };
export function pageOf<T>(data:T[], total:number, page:number, pageSize:number): Page<T> {
  return {data,pagination:{page,pageSize,total,hasMore:page*pageSize<total}};
}
type Arg = string | number;
const like = (q:string) => `%${q.replace(/[\\%_]/g,'\\$&')}%`;
export function readClients(filter:{q?:string},page:number,pageSize:number) {
  const clause = filter.q ? "WHERE name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\'" : '';
  const args:Arg[] = filter.q ? Array(4).fill(like(filter.q)) : [];
  const total = getDb().prepare(`SELECT COUNT(*) AS total FROM clients ${clause}`).get(...args)!.total as number;
  const data = getDb().prepare(`SELECT id,name,company,address,email,phone FROM clients ${clause} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
  return pageOf(data,total,page,pageSize);
}
export type TaskFilter = {q?:string;projectId?:number;clientId?:number;completed?:boolean;archived?:boolean;dueFrom?:string;dueTo?:string;attention?:'due'};
const TASK_COLS = 't.id,t.project_id AS projectId,t.title,t.completed,t.due_date AS dueDate,p.name AS projectName';
export function readTasks(filter:TaskFilter,page:number,pageSize:number,todayDate:string) {
  const where:string[] = filter.archived ? [] : ['p.archived_at IS NULL']; const args:Arg[]=[];
  if(filter.attention === 'due') {where.push("p.status != 'completed' AND t.completed = 0 AND t.due_date <= ?");args.push(addDays(todayDate,7));}
  if(filter.q) {where.push("t.title LIKE ? ESCAPE '\\'");args.push(like(filter.q));}
  if(filter.projectId !== undefined) {where.push('t.project_id = ?');args.push(filter.projectId);}
  if(filter.clientId !== undefined) {where.push('p.client_id = ?');args.push(filter.clientId);}
  if(filter.completed !== undefined) {where.push('t.completed = ?');args.push(Number(filter.completed));}
  if(filter.dueFrom) {where.push('t.due_date >= ?');args.push(filter.dueFrom);}
  if(filter.dueTo) {where.push('t.due_date <= ?');args.push(filter.dueTo);}
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = getDb().prepare(`SELECT COUNT(*) AS total FROM tasks t JOIN projects p ON p.id = t.project_id ${clause}`).get(...args)!.total as number;
  const data = getDb().prepare(`SELECT ${TASK_COLS} FROM tasks t JOIN projects p ON p.id = t.project_id ${clause} ORDER BY t.completed,t.due_date IS NULL,t.due_date,t.id LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize).map(row=>({...row,completed:Boolean(row.completed)}));
  return pageOf(data,total,page,pageSize);
}
export function readTask(id:number) {
  const row = getDb().prepare(`SELECT ${TASK_COLS} FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`).get(id);
  return row ? {...row,completed:Boolean(row.completed)} : null;
}
export function readClient(id:number) {
  return getDb().prepare('SELECT id,name,company,address,email,phone FROM clients WHERE id = ?').get(id) ?? null;
}
