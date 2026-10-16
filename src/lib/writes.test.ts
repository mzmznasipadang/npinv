import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from './db.ts';
import { createClient, NotFoundError, ProjectConflictError } from './repo.ts';
import * as projects from './projects.ts';
import { parseProjectForm } from './project-schemas.ts';
import * as writes from './writes.ts';
beforeEach(() => getDb().exec('DELETE FROM invoices; DELETE FROM projects; DELETE FROM clients'));
const client = () => createClient({name:'Synthetic', company:'', address:'', email:'', phone:''});
const values = (clientId: number, overrides: Record<string, string> = {}) =>
  ({clientId:String(clientId), name:'Brand refresh', description:'', status:'planned', startDate:'', deadline:'', ...overrides});
const count = () => (getDb().prepare('SELECT COUNT(*) AS n FROM projects').get() as {n:number}).n;

test('saveProject returns the parser errors and writes nothing for an invalid form', () => {
  const invalid = values(client(), {name:'  ', startDate:'2026-10-20', deadline:'2026-10-10'});
  assert.deepEqual(writes.saveProject(null, invalid), parseProjectForm(invalid));
  assert.equal(count(), 0);
});
test('saveProject creates and updates through the shared writer', () => {
  const c = client();
  const created = writes.saveProject(null, values(c, {name:'  Brand refresh  ', deadline:'2026-10-20'}));
  assert.ok(created.ok);
  assert.equal(projects.getProject(created.id)?.name, 'Brand refresh');
  assert.equal(projects.getProject(created.id)?.startDate, null);
  assert.deepEqual(writes.saveProject(created.id, values(c, {status:'completed'})), {ok:true, id:created.id});
  assert.equal(projects.getProject(created.id)?.status, 'completed');
});
test('saveProject throws the writer errors for a missing client or project', () => {
  assert.throws(() => writes.saveProject(null, values(999999)), ProjectConflictError);
  assert.throws(() => writes.saveProject(999999, values(client())), NotFoundError);
  assert.equal(count(), 0);
});
