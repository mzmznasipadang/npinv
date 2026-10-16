// Run after `npm run build -- --webpack`; uses only a disposable local database.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'npinv-mobile-smoke-'));
process.env.DATABASE_PATH = join(directory, 'synthetic.db');
process.env.ADMIN_PASSWORD = 'synthetic-mobile-smoke-only';
const { createClient, saveInvoice, markSent, recordPayment } = await import('../src/lib/repo.ts');
const { saveProject, saveTask } = await import('../src/lib/projects.ts');
const { createSession } = await import('../src/lib/auth.ts');
const { getDb } = await import('../src/lib/db.ts');
const client = createClient({ name:'Synthetic mobile client', company:'', address:'', email:'', phone:'' });
const project = saveProject(null,{clientId:client,name:'Synthetic project',description:'',status:'in_progress',startDate:null,deadline:null});
saveTask(project,null,{title:'Synthetic task',dueDate:null,completed:false});
const invoice = saveInvoice(null,{clientId:client,projectId:project,billToName:'Synthetic mobile client',billToCompany:'',billToAddress:'',issueDate:'2026-10-01',dueDate:'2026-10-10',currency:'USD',taxRateBp:0,discountType:'amount',discountValue:0,downPaymentType:'amount',downPaymentValue:0,notes:'',items:[{description:'Design',qty:1,unitPrice:10000,notes:''}]});
markSent(invoice,'SYNTHETIC-001');
recordPayment(invoice,'USD',{paidOn:'2026-10-15',amount:2500,note:'',writeOff:false},10000);

const reservation = createServer();
reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
const port = reservation.address().port;
await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
let output='';
for (const stream of [server.stdout,server.stderr]) stream.on('data',chunk=>{output=(output+chunk).slice(-8000);});
const stopped = once(server,'exit');
try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++) {
    if(server.exitCode !== null) throw new Error(output);
    try { await fetch(base+'/login'); ready=true; break; } catch { await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  assert.ok(ready,'Local verification server did not become ready.');
  assert.equal((await fetch(base+'/api/v1/clients')).status,401);
  assert.equal((await fetch(base+'/invoices',{redirect:'manual'})).status,307);
  const login=await fetch(base+'/api/v1/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD,deviceName:'Synthetic phone'})});
  assert.equal(login.status,201); const credential=await login.json();
  const headers={authorization:`Bearer ${credential.token}`};
  for(const path of ['overview','projects','tasks','clients','invoices']) {
    const response=await fetch(base+'/api/v1/'+path,{headers});
    assert.equal(response.status,200,path); assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  for(const query of ['__proto__=x','__proto__=x&__proto__=y','page=1&page=2','wat=x','constructor=x','pageSize=101']) {
    assert.equal((await fetch(base+'/api/v1/clients?'+query,{headers})).status,400,query);
  }
  const detail=await (await fetch(base+`/api/v1/invoices/${invoice}`,{headers})).json();
  assert.equal(detail.data.balance,7500); assert.equal(detail.data.paid,2500); assert.ok(Number.isInteger(detail.data.items[0].id));
  const writing={...headers,'content-type':'application/json'};
  const fields={clientId:String(client),name:'Smoke project',description:'',status:'planned',startDate:'',deadline:''};
  const createProject=()=>fetch(base+'/api/v1/projects',{method:'POST',headers:{...writing,'idempotency-key':'synthetic-smoke-key-0001'},body:JSON.stringify(fields)});
  const created=await createProject(); assert.equal(created.status,201); const made=(await created.json()).data;
  const replay=await createProject(); assert.equal(replay.status,201); assert.equal(replay.headers.get('idempotent-replayed'),'true');
  assert.equal((await replay.json()).data.id,made.id);
  const edit=updatedAt=>fetch(base+`/api/v1/projects/${made.id}`,{method:'PATCH',headers:writing,body:JSON.stringify({...fields,name:'Smoke project v2',updatedAt})});
  assert.equal((await edit(made.updatedAt)).status,200);
  assert.equal((await edit(made.updatedAt)).status,409);
  const action=(name,method='POST')=>fetch(base+`/api/v1/projects/${made.id}/${name}`,{method,headers});
  const archived=await action('archive'); assert.equal(archived.status,200); assert.ok((await archived.json()).data.archivedAt);
  const restored=await action('restore'); assert.equal(restored.status,200); assert.equal((await restored.json()).data.archivedAt,null);
  assert.equal((await action('archive','GET')).status,405);
  const settings=await fetch(base+'/settings',{headers:{cookie:`npinv_session=${createSession()}`}});
  assert.equal(settings.status,200); const html=await settings.text();
  assert.ok(html.includes('Synthetic phone')); assert.ok(html.includes('Mobile devices')); assert.ok(!html.includes(credential.token));
  assert.equal((await fetch(base+`/api/v1/sessions/${credential.id}`,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(base+'/api/v1/clients',{headers})).status,401);
  console.log('Mobile HTTP smoke passed: auth, five reads, strict raw queries, balances, project writes (create, replay, edit, conflict, archive, restore, 405), web device list, and revocation.');
} finally {
  if(server.exitCode===null) server.kill('SIGTERM');
  await stopped;
  getDb().close();
  await rm(directory,{recursive:true,force:true});
}
