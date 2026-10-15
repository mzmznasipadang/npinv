import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from './db.ts';
import * as repo from './repo.ts';
import * as projects from './projects.ts';
import { createDeviceSession } from './mobile-sessions.ts';
import { handleMobileRequest } from './mobile-api.ts';
const NOW = Date.UTC(2026,9,15,3); const TODAY = '2026-10-15';
let token: string;
beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'synthetic-test-password';
  getDb().exec('DELETE FROM invoices; DELETE FROM projects; DELETE FROM clients; DELETE FROM device_sessions');
  token = createDeviceSession('Synthetic phone', NOW).token;
});
async function api(path: string, method = 'GET', body?: unknown, credential: string | null = token) {
  const headers: Record<string,string> = {};
  if (credential) headers.authorization = `Bearer ${credential}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await handleMobileRequest(new Request(`https://example.test/api/v1/${path}`, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)}), NOW);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return { status:response.status, body:await response.json() };
}
const client = (name: string) => repo.createClient({name,company:'',address:'',email:'',phone:''});
const project = (clientId: number, name: string) => projects.saveProject(null, {clientId,name,description:'',status:'in_progress',startDate:null,deadline:TODAY});
test('all reads and session revocations require device authorization, not a web cookie', async () => {
  for (const route of ['overview','projects','tasks','clients','invoices','sessions','invoices/1','invoices/1/print']) {
    assert.equal((await api(route,'GET',undefined,null)).status,401);
  }
  assert.equal((await api('sessions/1','DELETE',undefined,null)).status,401);
  assert.equal((await api('clients','POST',{})).status,405);
  const response = await handleMobileRequest(new Request('https://example.test/api/v1/clients',{headers:{cookie:'npinv_session=anything'}}),NOW);
  assert.equal(response.status,401);
});
test('login returns one credential, listing hides secrets, revocation invalidates only that device', async () => {
  assert.equal((await api('sessions','POST',{password:'wrong',deviceName:'Test'},null)).status,401);
  const login = await api('sessions','POST',{password:process.env.ADMIN_PASSWORD,deviceName:'Tablet'},null);
  assert.equal(login.status,201); assert.match(login.body.token,/^[a-f0-9]{64}$/);
  const listing = await api('sessions'); assert.equal(listing.body.data.length,2);
  assert.equal(listing.body.data.filter((s: {current:boolean}) => s.current).length,1);
  assert.ok(!JSON.stringify(listing.body).includes(login.body.token));
  assert.equal((await api(`sessions/${login.body.id}`,'DELETE')).status,200);
  assert.equal((await api('overview','GET',undefined,login.body.token)).status,401);
  assert.equal((await api('overview')).status,200);
  assert.equal((await api('sessions','POST',{password:'x'.repeat(9000),deviceName:'Phone'},null)).status,413);
});
test('filters are strict and pagination is bounded, stable, and counted before limiting', async () => {
  const ids = [client('Zulu'), client('Alpha'),client('Beta')];
  const page = await api('clients?page=2&pageSize=1');
  assert.equal(page.body.data[0].id,ids[2]);
  assert.deepEqual(page.body.pagination,{page:2,pageSize:1,total:3,hasMore:true});
  assert.equal((await api('clients?page=99')).body.data.length,0);
  assert.equal((await api('clients?q=alpha')).body.pagination.total,1);
  for (const query of ['page=0','page=-1','pageSize=101','pageSize=0','page=1&page=2','__proto__=x','__proto__=x&__proto__=y','constructor=x','toString=x','wat=x','page=999999999999999999999','q='+ 'x'.repeat(101)]) assert.equal((await api(`clients?${query}`)).status,400,query);
  for (const path of ['projects?status=bad','tasks?completed=maybe','tasks?dueFrom=2026-02-30','tasks?dueFrom=2026-10-20&dueTo=2026-10-01','invoices?projectId=bad','projects?archived=true&archived=false']) assert.equal((await api(path)).status,400,path);
  assert.equal((await api('clients?q=%25')).body.data.length,0);
});
test('project/task filters preserve archived history and checklist boolean types', async () => {
  const c = client('Studio'); const p = project(c,'Design'); const archive = project(c,'Archive');
  projects.setProjectArchived(archive,true);
  projects.saveTask(p,null,{title:'Review',dueDate:TODAY,completed:false});
  projects.saveTask(p,null,{title:'Done',dueDate:null,completed:true});
  projects.saveTask(archive,null,{title:'Old',dueDate:TODAY,completed:false});
  const list = await api('tasks?completed=false&dueFrom=2026-10-15&dueTo=2026-10-15&pageSize=1');
  assert.equal(list.body.pagination.total,1); assert.equal(list.body.data[0].completed,false);
  assert.equal((await api('projects')).body.pagination.total,1);
  assert.equal((await api('projects?archived=true')).body.data[0].id,archive);
  assert.equal((await api(`tasks?projectId=${archive}&archived=true`)).body.data[0].title,'Old');
  assert.equal((await api(`projects/${p}`)).body.data.taskCount,2);
  assert.equal((await api(`tasks/${list.body.data[0].id}`)).body.data.projectId,p);
  assert.equal((await api('tasks?completed=true')).body.pagination.total,1);
});
test('API balances, statuses, and overview match shared financial calculations', async () => {
  const c = client('Studio'); const p = project(c,'Design');
  const id = repo.saveInvoice(null,{clientId:c,projectId:p,billToName:'Saved name',billToCompany:'',billToAddress:'',issueDate:'2026-10-01',dueDate:'2026-10-10',currency:'USD',taxRateBp:0,discountType:'amount',discountValue:0,downPaymentType:'amount',downPaymentValue:0,notes:'',items:[{description:'Design',qty:1,unitPrice:10000,notes:''}]});
  repo.markSent(id,'TEST-001'); repo.recordPayment(id,'USD',{paidOn:TODAY,amount:2500,note:'',writeOff:false},10000);
  const invoice = await api(`invoices/${id}`);
  assert.equal(invoice.body.data.balance,7500); assert.equal(invoice.body.data.paid,2500); assert.equal(invoice.body.data.display,'overdue');
  const list = await api(`invoices?projectId=${p}&outstanding=true&currency=USD&pageSize=1`);
  assert.equal(list.body.data[0].balance,7500); assert.equal(list.body.pagination.total,1);
  const overview = await api('overview'); assert.deepEqual(overview.body.data.financial,repo.dashboard(TODAY));
  assert.equal(overview.body.data.today,TODAY);
  repo.recordPayment(id,'USD',{paidOn:TODAY,amount:5000,note:'',writeOff:true},7500);
  assert.equal((await api(`invoices/${id}`)).body.data.balance,0);
  assert.equal((await api('invoices?outstanding=true')).body.pagination.total,0);
  assert.equal((await api(`invoices/${id}`)).body.data.paid,7500);
});
test('detail IDs, unknown paths, and malformed login bodies fail cleanly', async () => {
  for (const path of ['clients/99999','projects/99999','tasks/99999','invoices/99999','unknown']) assert.equal((await api(path)).status,404);
  for (const path of ['clients/0','projects/no','tasks/1.5','invoices/1/extra']) assert.ok([400,404].includes((await api(path)).status));
  assert.equal((await api('sessions','POST',{password:4,deviceName:'Phone'},null)).status,400);
  assert.equal((await api('sessions','POST',{password:'synthetic-test-password',deviceName:''},null)).status,400);
  const response = await handleMobileRequest(new Request('https://example.test/api/v1/sessions',{method:'POST',headers:{'content-type':'application/json'},body:'{'}),NOW);
  assert.equal(response.status,400);
});
test('overview attention links use complete counts and exclude completed projects', async () => {
  const c = client('Studio'); const done = project(c,'Completed');
  projects.saveProject(done,{...projects.getProject(done)!,status:'completed'});
  projects.saveTask(done,null,{title:'Obsolete task',completed:false,dueDate:TODAY});
  for(let i=0;i<7;i++) {
    const p=project(c,`Project ${i}`);
    projects.saveTask(p,null,{title:`Task ${i}`,completed:false,dueDate:TODAY});
  }
  const overview=await api('overview');
  assert.equal(overview.body.data.work.dueTaskCount,7);
  assert.equal(overview.body.data.work.tasks.length,5);
  const tasks=await api('tasks?attention=due&pageSize=2');
  assert.equal(tasks.body.pagination.total,7);
  assert.equal(tasks.body.data.length,2);
  assert.equal(overview.body.data.work.activeCount,7);
});
async function raw(path: string, method = 'GET') {
  return handleMobileRequest(new Request(`https://example.test/api/v1/${path}`, {method, headers:{authorization:`Bearer ${token}`}}), NOW);
}
test('the print endpoint returns the escaped, self-contained invoice document for the chosen version', async () => {
  repo.updateSettings({...repo.getSettings(), businessName:'Studio <b>', taxLabel:'VAT"', paymentDetails:"Bank & 'Co'"});
  const hostile = '<script>alert(1)</script>"><img src=x onerror=alert(2)>&';
  const id = repo.saveInvoice(null,{clientId:client('Print client'),projectId:null,billToName:hostile,billToCompany:hostile,billToAddress:hostile,issueDate:'2026-10-01',dueDate:'2026-10-31',currency:'IDR',taxRateBp:1100,discountType:'percent',discountValue:1000,downPaymentType:'percent',downPaymentValue:3000,notes:hostile,items:[{description:hostile,qty:2,unitPrice:100000,notes:hostile}]});
  repo.markSent(id,'PRINT-001');
  repo.recordPayment(id,'IDR',{paidOn:'2026-10-05',amount:50000,note:hostile,writeOff:false});

  const response = await raw(`invoices/${id}/print`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'");
  const body = await response.text();
  assert.ok(!body.includes('<script') && !body.includes('<img src=x'),'user text must never become markup');
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=alert(2)&gt;&amp;'));
  assert.ok(body.includes('Studio &lt;b&gt;') && body.includes('VAT&quot; 11%') && body.includes('Bank &amp; &#x27;Co&#x27;'));
  assert.equal((body.match(/<img [^>]*src="data:image\/png;base64,/g) ?? []).length,2,'both brand images are inline');
  assert.equal((body.match(/@font-face\{font-family:Montserrat;[^}]*src:url\(data:font\/woff2;base64,/g) ?? []).length,2,'both Montserrat subsets are inline');
  assert.ok(!/src="\//.test(body),'nothing loads from the server');
  assert.ok(body.includes('Balance due'),'an invoice with payments defaults to the payments version, like the web page');
  assert.ok((await (await raw(`invoices/${id}/print?version=dp`)).text()).includes('Down payment due (30%)'));
  assert.ok(!(await (await raw(`invoices/${id}/print?version=full`)).text()).includes('Balance due'));

  for (const query of ['version=bad','version=full&version=dp','wat=1']) assert.equal((await raw(`invoices/${id}/print?${query}`)).status,400,query);
  assert.equal((await raw('invoices/999999/print')).status,404);
  assert.equal((await raw(`invoices/${id}/print`,'POST')).status,405);
  assert.equal((await raw(`invoices/${id}/print/extra`)).status,404);
  assert.equal((await raw(`clients/${id}/print`)).status,404);
  assert.deepEqual((await api(`invoices/${id}`)).body.data.printVersions,['full','payments','dp']);
});
