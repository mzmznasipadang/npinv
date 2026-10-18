import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from './db.ts';
import * as repo from './repo.ts';
import * as projects from './projects.ts';
import { createDeviceSession } from './mobile-sessions.ts';
import { handleMobileRequest } from './mobile-api.ts';
import { parseProjectForm, parseTaskForm } from './project-schemas.ts';
import { parseClientForm, parseInvoiceForm } from './schemas.ts';
const NOW = Date.UTC(2026,9,15,3); const TODAY = '2026-10-15';
let token: string;
beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'synthetic-test-password';
  getDb().exec('DELETE FROM invoices; DELETE FROM projects; DELETE FROM clients; DELETE FROM device_sessions; DELETE FROM idempotency_keys');
  token = createDeviceSession('Synthetic phone', NOW).token;
});
async function api(path: string, method = 'GET', body?: unknown, credential: string | null = token, extra: Record<string,string> = {}, now = NOW) {
  const headers: Record<string,string> = {...extra};
  if (credential) headers.authorization = `Bearer ${credential}`;
  if (body !== undefined) headers['content-type'] ??= 'application/json';
  const response = await handleMobileRequest(new Request(`https://example.test/api/v1/${path}`, {method, headers, body:body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)}), now);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return { status:response.status, body:await response.json(), headers:response.headers };
}
const client = (name: string) => repo.createClient({name,company:'',address:'',email:'',phone:''});
const project = (clientId: number, name: string) => projects.saveProject(null, {clientId,name,description:'',status:'in_progress',startDate:null,deadline:TODAY});
test('all reads and session revocations require device authorization, not a web cookie', async () => {
  for (const route of ['overview','projects','tasks','clients','invoices','sessions','invoices/1','invoices/1/print']) {
    assert.equal((await api(route,'GET',undefined,null)).status,401);
  }
  assert.equal((await api('sessions/1','DELETE',undefined,null)).status,401);
  assert.equal((await api('overview','POST',{})).status,405);
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
  assert.equal(response.headers.get('cache-control'),'private, no-store, no-transform');
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

const KEY = 'synthetic-key-0000000001';
const create = (body: unknown, key: string | null = KEY, credential: string | null = token, now = NOW) =>
  api('tasks','POST',body,credential,key === null ? {} : {'idempotency-key':key},now);
const taskCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM tasks').get() as {n:number}).n;
test('writes need a write-scope device session; read sessions get 403 and other resources stay read-only', async () => {
  const p = project(client('Studio'),'Design');
  const t = projects.saveTask(p,null,{title:'Review',dueDate:'',completed:false});
  for (const [path,method] of [['tasks','POST'],[`tasks/${t}`,'PATCH'],[`tasks/${t}`,'DELETE']]) {
    assert.equal((await api(path,method,{},null)).status,401,method);
  }
  const read = createDeviceSession('Old phone', NOW).token;
  getDb().prepare("UPDATE device_sessions SET scope = 'read' WHERE scope = 'write' AND device_name = 'Old phone'").run();
  const denied = await create({projectId:p,title:'New',dueDate:'',completed:false},KEY,read);
  assert.equal(denied.status,403); assert.match(denied.body.message,/Sign in again/);
  assert.equal((await api(`tasks/${t}`,'DELETE',undefined,read)).status,403);
  assert.equal((await api('tasks','GET',undefined,read)).status,200);
  assert.equal(taskCount(),1);
  assert.equal((await api('overview','POST',{})).status,405);
  assert.equal((await api('tasks','PUT',{})).status,405);
  assert.equal((await api(`tasks/${t}`,'POST',{})).status,405);
  const login = await api('sessions','POST',{password:process.env.ADMIN_PASSWORD,deviceName:'New phone'},null);
  assert.equal(login.body.scope,'write');
  const listed = (await api('sessions')).body.data as {deviceName:string;scope:string}[];
  assert.equal(listed.find(s => s.deviceName === 'Old phone')?.scope,'read');
});
test('task creates use strict JSON bodies and the shared parser for per-field errors', async () => {
  const p = project(client('Studio'),'Design');
  const valid = {projectId:p,title:'  Review copy  ',dueDate:'2026-10-20',completed:false};
  for (const [label,body,extra] of [
    ['unknown key',{...valid,notes:''},{}],['missing key',{projectId:p,title:'x',dueDate:''},{}],['wrong type',{...valid,completed:'no'},{}],
    ['bad project id',{...valid,projectId:-1},{}],['malformed JSON','{',{}],['not JSON',JSON.stringify(valid),{'content-type':'text/plain'}],
  ] as const) assert.equal((await api('tasks','POST',body,token,{'idempotency-key':KEY,...extra})).status,400,label);
  assert.equal((await api('tasks?x=1','POST',valid,token,{'idempotency-key':KEY})).status,400,'query string');
  assert.equal((await create(valid,null)).status,400,'missing key');
  assert.equal((await create(valid,'short')).status,400,'malformed key');
  assert.equal((await create({...valid,title:'x'.repeat(9000)})).status,413);
  for (const values of [{title:'   ',dueDate:'',completed:false},{title:'x'.repeat(301),dueDate:'',completed:false},{title:'Ok',dueDate:'2026-02-30',completed:false}]) {
    const invalid = await create({projectId:p,...values});
    const shared = parseTaskForm(values);
    assert.equal(invalid.status,422); assert.ok(!shared.ok); assert.deepEqual(invalid.body.errors,shared.errors);
  }
  assert.equal((await create({...valid,projectId:999999})).status,404);
  assert.equal(taskCount(),0);
  const created = await create(valid);
  assert.equal(created.status,201);
  assert.deepEqual({...created.body.data,id:0,updatedAt:''},{id:0,projectId:p,title:'Review copy',completed:false,dueDate:'2026-10-20',projectName:'Design',updatedAt:''});
  assert.deepEqual((await api(`tasks/${created.body.data.id}`)).body.data,created.body.data);
});
test('task edits replace fields only when updatedAt matches; deletes report records already gone', async () => {
  const p = project(client('Studio'),'Design');
  const id = projects.saveTask(p,null,{title:'Review',dueDate:'',completed:false});
  const seen = (await api(`tasks/${id}`)).body.data;
  assert.equal((await api(`tasks/${id}`,'PATCH',{title:'Review',dueDate:'',completed:true})).status,400,'updatedAt is required');
  assert.equal((await api(`tasks/${id}`,'PATCH',{projectId:p,title:'Review',dueDate:'',completed:true,updatedAt:seen.updatedAt})).status,400,'the project cannot move');
  const done = await api(`tasks/${id}`,'PATCH',{title:'Review',dueDate:'',completed:true,updatedAt:seen.updatedAt});
  assert.equal(done.status,200); assert.equal(done.body.data.completed,true); assert.equal(done.body.data.projectId,p);
  getDb().prepare("UPDATE tasks SET title = 'Renamed on the web', updated_at = '2026-10-15 04:00:00.000' WHERE id = ?").run(id);
  const stale = await api(`tasks/${id}`,'PATCH',{title:'Review',dueDate:'',completed:false,updatedAt:done.body.data.updatedAt});
  assert.equal(stale.status,409); assert.match(stale.body.message,/changed elsewhere/);
  assert.equal((await api(`tasks/${id}`)).body.data.title,'Renamed on the web');
  const invalid = await api(`tasks/${id}`,'PATCH',{title:'',dueDate:'',completed:false,updatedAt:'2026-10-15 04:00:00.000'});
  assert.equal(invalid.status,422); assert.equal(invalid.body.errors.title,'Enter a task title');
  assert.equal((await api('tasks/999999','PATCH',{title:'x',dueDate:'',completed:false,updatedAt:'x'})).status,404);
  assert.equal((await api(`tasks/${id}?x=1`,'DELETE')).status,400);
  assert.equal((await api(`tasks/${id}`,'DELETE')).status,200);
  assert.equal((await api(`tasks/${id}`,'DELETE')).status,404);
  assert.equal(taskCount(),0);
});
test('Idempotency-Key replays a create once per session and never stores failures', async () => {
  const p = project(client('Studio'),'Design');
  const body = {projectId:p,title:'Invoice follow-up',dueDate:'',completed:false};
  const first = await create(body);
  const again = await create(body);
  assert.equal(again.status,201); assert.equal(again.headers.get('idempotent-replayed'),'true');
  assert.deepEqual(again.body,first.body); assert.equal(taskCount(),1);
  const reused = await create({...body,title:'Something else'});
  assert.equal(reused.status,422); assert.equal(taskCount(),1);
  const other = createDeviceSession('Tablet',NOW).token;
  assert.equal((await create(body,KEY,other)).status,201); assert.equal(taskCount(),2);
  assert.equal((await create({...body,title:''},'synthetic-key-0000000002')).status,422);
  assert.equal((await create(body,'synthetic-key-0000000002')).status,201); assert.equal(taskCount(),3);
  const later = NOW + 25 * 3600_000;
  assert.equal((await create(body,'synthetic-key-0000000003',token,later)).status,201);
  const keys = (getDb().prepare('SELECT key FROM idempotency_keys ORDER BY key').all() as {key:string}[]).map(row => row.key);
  assert.deepEqual(keys,['synthetic-key-0000000003'],'keys older than a day are purged');
});
test('the write table leaves paths outside it as they were', async () => {
  const p = project(client('Studio'),'Design');
  const t = projects.saveTask(p,null,{title:'Review',dueDate:'',completed:false});
  for (const path of ['constructor','__proto__','overview',`clients/${p}`]) assert.equal((await api(path,'POST',{})).status,405,path);
  for (const [path,method] of [[`tasks/${t}/extra`,'POST'],[`tasks/${t}/extra`,'GET'],[`tasks/${t}/a/b`,'PATCH']]) assert.equal((await api(path,method,method === 'GET' ? undefined : {})).status,404,`${method} ${path}`);
  assert.equal((await api('tasks/abc','PATCH',{})).status,400);
  assert.equal((await api(`invoices/${p}/print`,'POST')).status,405);
  assert.equal((await api(`tasks/${t}`)).status,200);
});

const projectBody = (clientId: number | string, overrides: Record<string, unknown> = {}) =>
  ({clientId:String(clientId),name:'Brand refresh',description:'',status:'planned',startDate:'',deadline:'',...overrides});
const createProject = (body: unknown, key: string | null = KEY, credential: string | null = token) =>
  api('projects','POST',body,credential,key === null ? {} : {'idempotency-key':key});
const projectCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM projects').get() as {n:number}).n;
const invoiceFor = (clientId: number, projectId: number) => repo.saveInvoice(null,{clientId,projectId,billToName:'Synthetic',billToCompany:'',billToAddress:'',issueDate:'2026-10-01',dueDate:'2026-10-31',currency:'USD',taxRateBp:0,discountType:'amount',discountValue:0,downPaymentType:'amount',downPaymentValue:0,notes:'',items:[{description:'Design',qty:1,unitPrice:10000,notes:''}]});

test('project writes need a write-scope session, and other methods on their paths get 405', async () => {
  const c = client('Studio'); const p = project(c,'Design');
  const edit = {...projectBody(c),updatedAt:(await api(`projects/${p}`)).body.data.updatedAt};
  const routes = [['projects','POST',projectBody(c)],[`projects/${p}`,'PATCH',edit],[`projects/${p}/archive`,'POST',undefined],[`projects/${p}/restore`,'POST',undefined]] as const;
  for (const [path,method,body] of routes) assert.equal((await api(path,method,body,null)).status,401,`${method} ${path}`);
  const read = createDeviceSession('Old phone', NOW).token;
  getDb().prepare("UPDATE device_sessions SET scope = 'read' WHERE device_name = 'Old phone'").run();
  for (const [path,method,body] of routes) assert.equal((await api(path,method,body,read,{'idempotency-key':KEY})).status,403,`${method} ${path}`);
  assert.equal(projectCount(),1); assert.equal((await api(`projects/${p}`)).body.data.archivedAt,null);
  for (const [path,method] of [[`projects/${p}/archive`,'GET'],[`projects/${p}/restore`,'GET'],[`projects/${p}`,'DELETE'],['projects','PUT'],[`projects/${p}`,'POST'],[`projects/${p}/archive`,'PATCH']]) {
    assert.equal((await api(path,method)).status,405,`${method} ${path}`);
  }
  for (const path of [`projects/${p}/unknown`,`projects/${p}/archive/extra`]) assert.equal((await api(path,'POST')).status,404,path);
  assert.equal((await api('projects/abc/archive','POST')).status,400);
  assert.equal((await api(`projects/${p}/archive?x=1`,'POST')).status,400);
  assert.equal((await api(`projects/${p}`)).status,200);
});
test('project creates use strict string bodies, the shared parser, and the writer conflicts', async () => {
  const c = client('Studio');
  const valid = projectBody(c,{name:'  Brand refresh  ',startDate:'2026-10-20'});
  for (const [label,body] of [['unknown key',{...valid,notes:''}],['missing key',{...valid,deadline:undefined}],['numeric clientId',{...valid,clientId:c}],['null date',{...valid,deadline:null}]] as const) {
    assert.equal((await createProject(body)).status,400,label);
  }
  assert.equal((await api('projects?x=1','POST',valid,token,{'idempotency-key':KEY})).status,400,'query string');
  assert.equal((await createProject(valid,null)).status,400,'missing key');
  assert.equal((await createProject({...valid,description:'x'.repeat(9000)})).status,413);
  for (const values of [projectBody(c,{name:'   '}),projectBody(c,{clientId:''}),projectBody(c,{status:'bad'}),projectBody(c,{startDate:'2026-10-20',deadline:'2026-10-10'})]) {
    const invalid = await createProject(values); const shared = parseProjectForm(values);
    assert.equal(invalid.status,422); assert.ok(!shared.ok); assert.deepEqual(invalid.body.errors,shared.errors);
  }
  assert.deepEqual((await createProject(projectBody(c,{startDate:'2026-10-20',deadline:'2026-10-10'}))).body.errors,{deadline:'The deadline cannot be before the start date'});
  const missing = await createProject(projectBody(999999));
  assert.equal(missing.status,422); assert.deepEqual(missing.body.errors,{clientId:'Choose an existing client.'});
  assert.equal(projectCount(),0);
  const created = await createProject(valid);
  assert.equal(created.status,201);
  assert.equal(created.body.data.name,'Brand refresh'); assert.equal(created.body.data.startDate,'2026-10-20'); assert.equal(created.body.data.deadline,null);
  assert.deepEqual((await api(`projects/${created.body.data.id}`)).body.data,created.body.data);
  const largest = await createProject(projectBody(c,{name:'€'.repeat(200),description:'€'.repeat(2000)}),'synthetic-key-0000000009');
  assert.equal(largest.status,201,'the largest valid project fits under 8 KB');
});
test('project edits check updatedAt before the fields, then the shared parser and conflicts', async () => {
  const c = client('Studio'); const p = project(c,'Design');
  const edit = (updatedAt: string, overrides: Record<string, string> = {}) => ({...projectBody(c,{name:'Design',status:'in_progress',deadline:TODAY}),updatedAt,...overrides});
  assert.equal((await api(`projects/${p}`,'PATCH',projectBody(c))).status,400,'updatedAt is required');
  const V1 = '2026-10-15 04:00:00.000';
  getDb().prepare("UPDATE projects SET name = 'Renamed on the web', updated_at = ? WHERE id = ?").run(V1,p);
  const stale = await api(`projects/${p}`,'PATCH',edit('2026-10-15 03:00:00.000',{name:''}));
  assert.equal(stale.status,409,'the version is checked before the fields');
  assert.equal(stale.body.message,'This project changed elsewhere. Reload to see the latest version.');
  assert.equal((await api(`projects/${p}`)).body.data.name,'Renamed on the web');
  const invalid = await api(`projects/${p}`,'PATCH',edit(V1,{name:''}));
  assert.equal(invalid.status,422); assert.equal(invalid.body.errors.name,'Enter a project name');
  const saved = await api(`projects/${p}`,'PATCH',edit(V1,{name:'Design v2',deadline:''}));
  assert.equal(saved.status,200); assert.equal(saved.body.data.name,'Design v2');
  assert.equal(saved.body.data.deadline,null,'turning a date off clears it'); assert.notEqual(saved.body.data.updatedAt,V1);
  // A task write stamps the project, so a form opened before it is stale.
  const V2 = '2026-10-15 05:00:00.000';
  getDb().prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(V2,p);
  projects.saveTask(p,null,{title:'Review',dueDate:null,completed:false});
  assert.equal((await api(`projects/${p}`,'PATCH',edit(V2))).status,409);
  invoiceFor(c,p);
  const moved = await api(`projects/${p}`,'PATCH',edit((await api(`projects/${p}`)).body.data.updatedAt,{clientId:String(client('Other'))}));
  assert.equal(moved.status,422); assert.deepEqual(moved.body.errors,{clientId:'The client cannot change while invoices are linked.'});
  assert.equal((await api(`projects/${p}`)).body.data.clientId,c);
  projects.setProjectArchived(p,true);
  const archived = (await api(`projects/${p}`)).body.data;
  const kept = await api(`projects/${p}`,'PATCH',edit(archived.updatedAt,{name:'Archived edit'}));
  assert.equal(kept.status,200); assert.equal(kept.body.data.archivedAt,archived.archivedAt,'an edit keeps the project archived');
  assert.equal((await api('projects/999999','PATCH',edit('x'))).status,404);
});
test('archive and restore return the project, need no key or body, and report missing projects', async () => {
  const c = client('Studio'); const p = project(c,'Design');
  getDb().prepare("UPDATE projects SET updated_at = '2026-10-15 04:00:00.000' WHERE id = ?").run(p);
  const archived = await api(`projects/${p}/archive`,'POST');
  assert.equal(archived.status,200); assert.ok(archived.body.data.archivedAt);
  assert.notEqual(archived.body.data.updatedAt,'2026-10-15 04:00:00.000','archiving changes the version');
  assert.deepEqual((await api(`projects/${p}`)).body.data,archived.body.data);
  assert.equal((await api('projects')).body.pagination.total,0);
  assert.equal((await api('projects?archived=true')).body.data[0].id,p);
  const restored = await api(`projects/${p}/restore`,'POST');
  assert.equal(restored.status,200); assert.equal(restored.body.data.archivedAt,null);
  assert.equal((await api('projects')).body.pagination.total,1);
  for (const action of ['archive','restore']) assert.equal((await api(`projects/999999/${action}`,'POST')).status,404,action);
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM idempotency_keys').get() as {n:number}).n,0,'actions store no key');
});
test('project creates replay once per key, and a key is bound to its resource', async () => {
  const body = projectBody(client('Studio'));
  const first = await createProject(body); const again = await createProject(body);
  assert.equal(again.status,201); assert.equal(again.headers.get('idempotent-replayed'),'true');
  assert.deepEqual(again.body,first.body); assert.equal(projectCount(),1);
  assert.equal((await createProject({...body,name:'Something else'})).status,422); assert.equal(projectCount(),1);
  const task = {projectId:first.body.data.id,title:'Review',dueDate:'',completed:false};
  assert.equal((await api('tasks','POST',task,token,{'idempotency-key':KEY})).status,422);
});
const clientBody = (overrides: Record<string, unknown> = {}) => ({name:'Studio',company:'',address:'',email:'',phone:'',...overrides});
const createClient = (body: unknown, key: string | null = KEY, credential: string | null = token) =>
  api('clients','POST',body,credential,key === null ? {} : {'idempotency-key':key});
const clientCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM clients').get() as {n:number}).n;
const REFUSAL = 'This client has projects. Keep the client to preserve their project history.';

test('client writes need a write-scope session, and other methods on their paths get 405', async () => {
  const c = client('Studio');
  const edit = {...clientBody(),updatedAt:(await api(`clients/${c}`)).body.data.updatedAt};
  const routes = [['clients','POST',clientBody()],[`clients/${c}`,'PATCH',edit],[`clients/${c}`,'DELETE',undefined]] as const;
  for (const [path,method,body] of routes) assert.equal((await api(path,method,body,null)).status,401,`${method} ${path}`);
  const read = createDeviceSession('Old phone', NOW).token;
  getDb().prepare("UPDATE device_sessions SET scope = 'read' WHERE device_name = 'Old phone'").run();
  for (const [path,method,body] of routes) assert.equal((await api(path,method,body,read,{'idempotency-key':KEY})).status,403,`${method} ${path}`);
  assert.equal(clientCount(),1);
  for (const [path,method] of [['clients','PUT'],['clients','DELETE'],[`clients/${c}`,'POST']]) assert.equal((await api(path,method,{})).status,405,`${method} ${path}`);
  assert.equal((await api('clients/abc','PATCH',edit)).status,400);
});
test('client creates use strict string bodies and the shared parser', async () => {
  const valid = clientBody({name:'  Studio  '});
  for (const [label,body] of [['unknown key',{...valid,notes:''}],['missing key',{...valid,phone:undefined}],['numeric phone',{...valid,phone:5}],['null email',{...valid,email:null}]] as const) {
    assert.equal((await createClient(body)).status,400,label);
  }
  assert.equal((await api('clients?x=1','POST',valid,token,{'idempotency-key':KEY})).status,400,'query string');
  assert.equal((await createClient(valid,null)).status,400,'missing key');
  assert.equal((await createClient({...valid,address:'x'.repeat(9000)})).status,413);
  for (const values of [clientBody({name:'   '}),clientBody({email:'nope'})]) {
    const invalid = await createClient(values); const shared = parseClientForm(values);
    assert.equal(invalid.status,422); assert.ok(!shared.ok); assert.deepEqual(invalid.body.errors,shared.errors);
  }
  assert.equal(clientCount(),0);
  const created = await createClient(valid);
  assert.equal(created.status,201); assert.equal(created.body.data.name,'Studio'); assert.equal(typeof created.body.data.updatedAt,'string');
  assert.deepEqual((await api(`clients/${created.body.data.id}`)).body.data,created.body.data);
  const largest = await createClient(clientBody({name:'€'.repeat(200),company:'€'.repeat(200),address:'€'.repeat(500),phone:'€'.repeat(50)}),'synthetic-key-0000000009');
  assert.equal(largest.status,201,'the largest valid client fits under 8 KB');
});
test('client reads carry the version, and edits check it before the fields', async () => {
  const c = client('Studio');
  const OLD = '2026-10-15 04:00:00.000';
  getDb().prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(OLD,c);
  assert.equal((await api('clients')).body.data[0].updatedAt,OLD);
  repo.updateClient(c,{name:'Renamed on the web',company:'',address:'',email:'',phone:''});
  const seen = (await api(`clients/${c}`)).body.data.updatedAt;
  assert.notEqual(seen,OLD,'a web edit changes the version');
  assert.equal((await api(`clients/${c}`,'PATCH',clientBody())).status,400,'updatedAt is required');
  const stale = await api(`clients/${c}`,'PATCH',{...clientBody({name:''}),updatedAt:OLD});
  assert.equal(stale.status,409); assert.equal(stale.body.message,'This client changed elsewhere. Reload to see the latest version.');
  assert.equal((await api(`clients/${c}`)).body.data.name,'Renamed on the web');
  getDb().prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(OLD,c);
  const saved = await api(`clients/${c}`,'PATCH',{...clientBody({name:'  Studio v2  ',email:'a@example.test'}),updatedAt:OLD});
  assert.equal(saved.status,200); assert.equal(saved.body.data.name,'Studio v2'); assert.equal(saved.body.data.email,'a@example.test');
  assert.notEqual(saved.body.data.updatedAt,OLD);
  const invalid = await api(`clients/${c}`,'PATCH',{...clientBody({name:''}),updatedAt:saved.body.data.updatedAt});
  assert.equal(invalid.status,422); assert.deepEqual(invalid.body.errors,{name:'Enter a name'});
  const missing = await api('clients/999999','PATCH',{...clientBody(),updatedAt:OLD});
  assert.equal(missing.status,404); assert.equal(missing.body.message,'Client no longer exists.');
});
test('client deletes refuse clients with projects and keep their invoices', async () => {
  const withProject = client('Has project'); project(withProject,'Design');
  const refused = await api(`clients/${withProject}`,'DELETE');
  assert.equal(refused.status,422); assert.deepEqual(refused.body,{message:REFUSAL},'no errors key, so the app shows the sentence');
  assert.equal((await api(`clients/${withProject}`)).status,200);
  const billed = client('Billed');
  // No project: a client with only invoices can be deleted.
  const invoice = repo.saveInvoice(null,{clientId:billed,projectId:null,billToName:'Billed Co',billToCompany:'',billToAddress:'',issueDate:'2026-10-01',dueDate:'2026-10-31',currency:'USD',taxRateBp:0,discountType:'amount',discountValue:0,downPaymentType:'amount',downPaymentValue:0,notes:'',items:[{description:'Design',qty:1,unitPrice:10000,notes:''}]});
  const deleted = await api(`clients/${billed}`,'DELETE');
  assert.equal(deleted.status,200); assert.deepEqual(deleted.body,{ok:true});
  const kept = repo.getInvoice(invoice);
  assert.equal(kept?.clientId,null); assert.equal(kept?.billToName,'Billed Co');
  assert.equal((await api(`clients/${billed}`)).status,404);
  assert.equal((await api(`clients/${billed}`,'DELETE')).status,404);
});
test('client creates replay once per key', async () => {
  const first = await createClient(clientBody());
  const replay = await createClient(clientBody());
  assert.equal(replay.status,201); assert.equal(replay.headers.get('idempotent-replayed'),'true');
  assert.equal(replay.body.data.id,first.body.data.id); assert.equal(clientCount(),1);
  assert.equal((await createClient(clientBody({name:'Other'}))).status,422,'a key reused with another body');
});
const draft = () => repo.saveInvoice(null,{clientId:null,projectId:null,billToName:'Synthetic',billToCompany:'',billToAddress:'',issueDate:TODAY,dueDate:'2026-10-31',currency:'USD',taxRateBp:0,discountType:'amount',discountValue:0,downPaymentType:'amount',downPaymentValue:0,notes:'',items:[{description:'Design',qty:1,unitPrice:10000,notes:''}]});
test('invoice reads carry the version, and a suggested number only for unnumbered drafts', async () => {
  const id = draft();
  const read = (await api(`invoices/${id}`)).body.data;
  assert.equal(read.suggestedNumber,'INV-2026-001'); assert.equal(typeof read.updatedAt,'string');
  repo.markSent(id,'INV-2026-001');
  assert.equal((await api(`invoices/${id}`)).body.data.suggestedNumber,null);
  repo.revertToDraft(id);
  const reverted = (await api(`invoices/${id}`)).body.data;
  assert.equal(reverted.status,'draft'); assert.equal(reverted.number,'INV-2026-001'); assert.equal(reverted.suggestedNumber,null);
});
test('settings are readable by any session and stay read-only', async () => {
  const read = createDeviceSession('Old phone', NOW).token;
  getDb().prepare("UPDATE device_sessions SET scope = 'read' WHERE device_name = 'Old phone'").run();
  const settings = await api('settings','GET',undefined,read);
  assert.equal(settings.status,200); assert.deepEqual(settings.body.data,repo.getSettings());
  assert.equal((await api('settings',undefined,undefined,null)).status,401);
  assert.equal((await api('settings?x=1')).status,400);
  assert.equal((await api('settings','PATCH',{})).status,405);
  assert.equal((await api('settings/1')).status,404);
});

const line = (overrides: Record<string, string> = {}) => ({description:'Design',qty:'1',unitPrice:'100',notes:'',...overrides});
const invoiceBody = (overrides: Record<string, unknown> = {}) => ({clientId:'',projectId:'',billToName:'Synthetic',billToCompany:'',billToAddress:'',
  issueDate:TODAY,dueDate:'2026-10-31',currency:'USD',taxEnabled:false,taxRate:'11',discountEnabled:false,discountType:'percent',discount:'',
  downPaymentEnabled:false,downPaymentType:'percent',downPayment:'',notes:'',items:[line()],...overrides});
const createInvoice = (body: unknown, key: string | null = KEY, credential: string | null = token) =>
  api('invoices','POST',body,credential,key === null ? {} : {'idempotency-key':key});
const invoiceCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM invoices').get() as {n:number}).n;
const versionOf = async (id: number) => (await api(`invoices/${id}`)).body.data.updatedAt as string;
const GONE_INVOICE = 'Invoice no longer exists.';

test('invoice writes need a write-scope session, and other methods on their paths get 405', async () => {
  const id = draft(); const updatedAt = await versionOf(id);
  const routes = [['invoices','POST',invoiceBody()],[`invoices/${id}`,'PATCH',{...invoiceBody(),updatedAt}],[`invoices/${id}`,'DELETE',undefined],
    [`invoices/${id}/send`,'POST',{number:'INV-1',updatedAt}],[`invoices/${id}/revert`,'POST',undefined],[`invoices/${id}/duplicate`,'POST',undefined]] as const;
  for (const [path,method,body] of routes) assert.equal((await api(path,method,body,null)).status,401,`${method} ${path}`);
  const read = createDeviceSession('Old phone', NOW).token;
  getDb().prepare("UPDATE device_sessions SET scope = 'read' WHERE device_name = 'Old phone'").run();
  for (const [path,method,body] of routes) assert.equal((await api(path,method,body,read,{'idempotency-key':KEY})).status,403,`${method} ${path}`);
  assert.equal(invoiceCount(),1); assert.equal((await api(`invoices/${id}`)).body.data.status,'draft');
  for (const [path,method] of [['invoices','PUT'],[`invoices/${id}`,'POST'],[`invoices/${id}/send`,'PATCH'],[`invoices/${id}/send`,'GET'],[`invoices/${id}/duplicate`,'GET']]) {
    assert.equal((await api(path,method,method === 'GET' ? undefined : {})).status,405,`${method} ${path}`);
  }
});
test('invoice creates use strict bodies and the shared parser', async () => {
  const valid = invoiceBody();
  const noItems: Record<string, unknown> = {...valid}; delete noItems.items;
  for (const [label,body] of [['unknown key',{...valid,extra:''}],['unknown line key',{...valid,items:[{...line(),id:1}]}],['numeric qty',{...valid,items:[{...line(),qty:1}]}],
    ['string switch',{...valid,taxEnabled:'true'}],['missing items',noItems]] as const) assert.equal((await createInvoice(body)).status,400,label);
  assert.equal((await api('invoices?x=1','POST',valid,token,{'idempotency-key':KEY})).status,400,'query string');
  assert.equal((await createInvoice(valid,null)).status,400,'missing key');
  for (const values of [invoiceBody({items:[]}),invoiceBody({items:[line(),line({unitPrice:'1.505'})]}),invoiceBody({dueDate:'2026-10-01'})]) {
    const invalid = await createInvoice(values); const shared = parseInvoiceForm(values);
    assert.equal(invalid.status,422); assert.ok(!shared.ok); assert.deepEqual(invalid.body.errors,shared.errors);
  }
  assert.ok('items.1.unitPrice' in (await createInvoice(invoiceBody({items:[line(),line({unitPrice:'x'})]}))).body.errors);
  assert.equal(invoiceCount(),0);
  const created = await createInvoice(valid);
  assert.equal(created.status,201); assert.equal(created.body.data.total,10000); assert.equal(created.body.data.suggestedNumber,'INV-2026-001');
  assert.deepEqual((await api(`invoices/${created.body.data.id}`)).body.data,created.body.data);
});
test('the invoice body limit fits the largest valid invoice, and other bodies stay at 8 KB', async () => {
  const largest = invoiceBody({billToName:'€'.repeat(200),billToCompany:'€'.repeat(200),billToAddress:'€'.repeat(500),notes:'€'.repeat(2000),
    items:Array.from({length:200},()=>line({description:'€'.repeat(300),qty:'999',unitPrice:'1',notes:'€'.repeat(200)}))});
  assert.ok(JSON.stringify(largest).length > 8192);
  assert.equal((await createInvoice(largest)).status,201,'the largest valid invoice fits');
  assert.equal((await createInvoice(invoiceBody({notes:'x'.repeat(600_000)}),'synthetic-key-0000000002')).status,413);
  const id = draft();
  assert.equal((await api(`invoices/${id}/send`,'POST',{number:'x'.repeat(9000),updatedAt:''})).status,413);
  assert.equal((await api('sessions','POST',{password:'x'.repeat(9000),deviceName:'Phone'},null)).status,413);
});
test('invoice edits check updatedAt before the fields, then save every line in order', async () => {
  const id = draft();
  getDb().prepare("UPDATE invoices SET updated_at = '2026-10-15 04:00:00' WHERE id = ?").run(id);
  const seen = await versionOf(id);
  assert.equal((await api(`invoices/${id}`,'PATCH',invoiceBody())).status,400,'updatedAt is required');
  const stale = await api(`invoices/${id}`,'PATCH',{...invoiceBody({items:[]}),updatedAt:'2026-01-01 00:00:00.000'});
  assert.equal(stale.status,409); assert.equal(stale.body.message,'This invoice changed elsewhere. Reload to see the latest version.');
  const items = [line({description:'First'}),line({description:'Second',unitPrice:'50'})];
  const saved = await api(`invoices/${id}`,'PATCH',{...invoiceBody({items}),updatedAt:seen});
  assert.equal(saved.status,200); assert.notEqual(saved.body.data.updatedAt,seen);
  assert.deepEqual(saved.body.data.items.map((item: {description:string}) => item.description),['First','Second']); assert.equal(saved.body.data.total,15000);
  const missing = await api('invoices/99999','PATCH',{...invoiceBody(),updatedAt:seen});
  assert.equal(missing.status,404); assert.equal(missing.body.message,GONE_INVOICE);
});
test('invoice save conflicts answer 422 on their fields and write nothing', async () => {
  const owner = client('Owner'); const other = client('Other'); const p = project(owner,'Owned');
  const conflict = await createInvoice(invoiceBody({clientId:String(other),projectId:String(p)}));
  assert.equal(conflict.status,422); assert.equal(conflict.body.errors.projectId,'Choose a project belonging to the selected client.');
  const huge = await createInvoice(invoiceBody({items:[line({qty:'999999',unitPrice:'9999999999999'})]}),'synthetic-key-0000000003');
  assert.deepEqual(huge.body,{message:'The invoice total is too large to store.'}); assert.equal(huge.status,422);
  assert.equal(invoiceCount(),0);
  const id = draft(); repo.markSent(id,'INV-1');
  assert.deepEqual(repo.recordPayment(id,'USD',{paidOn:TODAY,amount:5000,note:'',writeOff:false}),{ok:true});
  const paid = await api(`invoices/${id}`,'PATCH',{...invoiceBody({currency:'IDR',items:[line({unitPrice:'1000'})]}),updatedAt:await versionOf(id)});
  assert.equal(paid.status,422); assert.equal(paid.body.errors.currency,'The currency cannot change once payments are recorded.');
  assert.equal((await api(`invoices/${id}`)).body.data.currency,'USD');
});
test('send, revert and delete follow the shared writers', async () => {
  const id = draft(); const other = draft();
  const send = async (invoice: number, number: string, updatedAt?: string) => api(`invoices/${invoice}/send`,'POST',{number,updatedAt:updatedAt ?? await versionOf(invoice)});
  assert.equal((await send(id,'INV-9','2026-01-01 00:00:00.000')).status,409);
  const bad = await send(id,'!'); assert.equal(bad.status,422); assert.equal(typeof bad.body.errors.number,'string');
  const sent = await send(id,'inv-9');
  assert.equal(sent.status,200); assert.equal(sent.body.data.number,'INV-9'); assert.equal(sent.body.data.status,'sent');
  assert.deepEqual((await send(id,'INV-10')).body,{message:'Only a draft can be marked sent.'});
  const used = await send(other,'INV-9'); assert.equal(used.status,422); assert.deepEqual(used.body,{message:'Number INV-9 is already used by another invoice.'});
  const reverted = await api(`invoices/${id}/revert`,'POST');
  assert.equal(reverted.status,200); assert.equal(reverted.body.data.status,'draft'); assert.equal(reverted.body.data.number,'INV-9');
  assert.deepEqual((await api(`invoices/${id}/revert`,'POST')).body,{message:'Only a sent invoice can go back to draft.'});
  await send(id,'ignored'); repo.recordPayment(id,'USD',{paidOn:TODAY,amount:100,note:'',writeOff:false});
  const refused = await api(`invoices/${id}/revert`,'POST');
  assert.equal(refused.status,422); assert.deepEqual(refused.body,{message:'Remove its payments before sending it back to draft.'});
  assert.equal((await api(`invoices/${id}`)).body.data.number,'INV-9');
  assert.deepEqual((await api(`invoices/${id}`,'DELETE')).body,{ok:true});
  assert.equal((await api(`invoices/${id}`)).status,404);
  for (const [path,method,body,extra] of [['invoices/99999/send','POST',{number:'X',updatedAt:''},{}],['invoices/99999/revert','POST',undefined,{}],
    ['invoices/99999/duplicate','POST',undefined,{'idempotency-key':KEY}],['invoices/99999','DELETE',undefined,{}]] as const) {
    const missing = await api(path,method,body,token,extra); assert.equal(missing.status,404,path); assert.equal(missing.body.message,GONE_INVOICE,path);
  }
});
test('duplicate makes one dated, unnumbered copy per key', async () => {
  const id = draft(); repo.markSent(id,'INV-1'); const second = draft();
  const duplicate = (source: number, key: string | null = KEY) => api(`invoices/${source}/duplicate`,'POST',undefined,token,key === null ? {} : {'idempotency-key':key},Date.UTC(2026,9,20,3));
  assert.equal((await duplicate(id,null)).status,400);
  const copy = await duplicate(id);
  assert.equal(copy.status,201); assert.equal(copy.body.data.number,null); assert.equal(copy.body.data.status,'draft'); assert.equal(copy.body.data.issueDate,'2026-10-20');
  const replay = await duplicate(id);
  assert.equal(replay.status,201); assert.equal(replay.headers.get('idempotent-replayed'),'true'); assert.equal(replay.body.data.id,copy.body.data.id);
  assert.equal((await duplicate(second)).status,422,'a key is bound to its source invoice');
  assert.equal(invoiceCount(),3);
});
