import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from './db.ts';
import { createClient, getInvoice, listClients, markSent, NotFoundError, PaymentConflictError, ProjectConflictError, recordPayment } from './repo.ts';
import * as projects from './projects.ts';
import { parseProjectForm } from './project-schemas.ts';
import { parseClientForm, parseInvoiceForm } from './schemas.ts';
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

const clientValues = (overrides: Record<string, string> = {}) => ({name:'Studio', company:'', address:'', email:'', phone:'', ...overrides});
const clientVersion = (id: number) => (getDb().prepare('SELECT updated_at AS v FROM clients WHERE id = ?').get(id) as {v:string}).v;
const OLD = '2026-10-15 04:00:00.000';

test('saveClient returns the parser errors and writes nothing for an invalid form', () => {
  const invalid = clientValues({name:'  ', email:'nope'});
  assert.deepEqual(writes.saveClient(null, invalid), parseClientForm(invalid));
  assert.equal(listClients().length, 0);
});
test('saveClient creates and updates through the shared writer and stamps the version each time', () => {
  const created = writes.saveClient(null, clientValues({name:'  Studio  '}));
  assert.ok(created.ok);
  assert.equal(listClients()[0].name, 'Studio');
  getDb().prepare('UPDATE clients SET updated_at = ?').run(OLD);
  assert.deepEqual(writes.saveClient(created.id, clientValues({phone:'+62 21 555'})), {ok:true, id:created.id});
  assert.equal(listClients()[0].phone, '+62 21 555');
  assert.notEqual(clientVersion(created.id), OLD);
  getDb().prepare('DELETE FROM clients').run();
  const again = writes.saveClient(null, clientValues());
  assert.ok(again.ok); assert.notEqual(clientVersion(again.id), '');
});
test('saveClient throws NotFoundError for a missing client', () => {
  assert.throws(() => writes.saveClient(999999, clientValues()), NotFoundError);
});

const invoiceValues = (overrides: Record<string, unknown> = {}) => ({clientId:'', projectId:'', billToName:'Synthetic', billToCompany:'', billToAddress:'',
  issueDate:'2026-10-01', dueDate:'2026-10-31', currency:'USD', taxEnabled:false, taxRate:'11', discountEnabled:false, discountType:'percent', discount:'',
  downPaymentEnabled:false, downPaymentType:'percent', downPayment:'', notes:'', items:[{description:'Design', qty:'1', unitPrice:'100', notes:''}], ...overrides});
const invoiceCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM invoices').get() as {n:number}).n;

test('saveInvoice returns the parser errors and writes nothing for an invalid form', () => {
  const invalid = invoiceValues({items: []});
  assert.deepEqual(writes.saveInvoice(null, invalid), parseInvoiceForm(invalid));
  assert.equal(invoiceCount(), 0);
});
test('saveInvoice creates and updates through the shared writer', () => {
  const created = writes.saveInvoice(null, invoiceValues());
  assert.ok(created.ok);
  assert.equal(getInvoice(created.id)?.total, 10000);
  assert.deepEqual(writes.saveInvoice(created.id, invoiceValues({items:[{description:'Design', qty:'1', unitPrice:'200', notes:''}]})), {ok:true, id:created.id});
  assert.equal(getInvoice(created.id)?.total, 20000);
});
test('saveInvoice keeps the payment guards', () => {
  const created = writes.saveInvoice(null, invoiceValues());
  assert.ok(created.ok);
  assert.deepEqual(markSent(created.id, 'INV-1'), {ok:true});
  assert.deepEqual(recordPayment(created.id, 'USD', {paidOn:'2026-10-02', amount:5000, note:'', writeOff:false}), {ok:true});
  assert.throws(() => writes.saveInvoice(created.id, invoiceValues({currency:'IDR'})), (error: unknown) => error instanceof PaymentConflictError && error.field === 'currency');
});
test('markSent parses the number, then reports the writer refusals', () => {
  const first = writes.saveInvoice(null, invoiceValues()); const second = writes.saveInvoice(null, invoiceValues());
  assert.ok(first.ok && second.ok);
  const bad = writes.markSent(first.id, 'bad number!');
  assert.ok(!bad.ok && 'errors' in bad && typeof bad.errors.number === 'string');
  assert.deepEqual(writes.markSent(first.id, 'inv-1'), {ok:true});
  assert.equal(getInvoice(first.id)?.number, 'INV-1');
  assert.deepEqual(writes.markSent(second.id, 'INV-1'), {ok:false, error:'Number INV-1 is already used by another invoice.'});
});
