import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { checkPassword } from './auth.ts';
import { createDeviceSession, listDeviceSessions, revokeDeviceSession, verifyDeviceSession } from './mobile-sessions.ts';
import type { DeviceSession } from './mobile-sessions.ts';
import { getDb, transaction } from './db.ts';
import * as writes from './writes.ts';
import * as repo from './repo.ts';
import * as projects from './projects.ts';
import { pageOf, readClients, readClient, readInvoice, readTasks, readTask } from './mobile-read.ts';
import { isValidDate, printVersions, today } from './rules.ts';
import { invoicePrintDocument } from './invoice-print.ts';
import type { PrintFonts, PrintImages } from './invoice-print.ts';

class HTTPError extends Error { status:number; errors?:Record<string,string>; constructor(status:number,message:string,errors?:Record<string,string>) {super(message);this.status=status;this.errors=errors;} }
const positive = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).refine(Number.isSafeInteger);
const boolean = z.enum(['true','false']).transform(s=>s==='true');
const date = z.string().refine(isValidDate);
const search = {q:z.string().trim().max(100).optional()};
const pagination = {page:positive.pipe(z.number().max(1_000_000)).default(1),pageSize:positive.pipe(z.number().max(100)).default(25)};
const filters = {
  clients:z.object({...pagination,...search}).strict(),
  projects:z.object({...pagination,...search,clientId:positive.optional(),status:z.enum(projects.PROJECT_STATUSES).optional(),archived:boolean.optional(),attention:z.enum(['overdue','upcoming','tasks']).optional(),sort:z.enum(['deadline','updated']).optional()}).strict(),
  tasks:z.object({...pagination,...search,projectId:positive.optional(),clientId:positive.optional(),completed:boolean.optional(),archived:boolean.optional(),dueFrom:date.optional(),dueTo:date.optional(),attention:z.literal('due').optional()}).strict().refine(f=>!f.dueFrom || !f.dueTo || f.dueFrom<=f.dueTo),
  invoices:z.object({...pagination,...search,projectId:positive.optional(),clientId:positive.optional(),currency:z.enum(['IDR','USD']).optional(),status:z.enum(['all','draft','sent','paid','overdue']).optional(),outstanding:boolean.optional()}).strict(),
};
// Write bodies check only shape. The values are the web form's own, so the shared write function validates them.
const taskValues = {title:z.string(),dueDate:z.string(),completed:z.boolean()};
const projectValues = {clientId:z.string(),name:z.string(),description:z.string(),status:z.string(),startDate:z.string(),deadline:z.string()};
const clientValues = {name:z.string(),company:z.string(),address:z.string(),email:z.string(),phone:z.string()};
const bodies = {
  createTask:z.object({projectId:z.int().positive(),...taskValues}).strict(),
  editTask:z.object({...taskValues,updatedAt:z.string().max(40)}).strict(),
  createProject:z.object(projectValues).strict(),
  editProject:z.object({...projectValues,updatedAt:z.string().max(40)}).strict(),
  createClient:z.object(clientValues).strict(),
  editClient:z.object({...clientValues,updatedAt:z.string().max(40)}).strict(),
};
const BODY_LIMIT = 8192;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;
const KEY_HOURS = 24;
function parameters(url:URL): Record<string,string> {
  const values:Record<string,string>=Object.create(null);
  for(const [key,value] of url.searchParams) {
    if(Object.hasOwn(values,key)) throw new HTTPError(400,'Repeated query parameters are not supported.');
    values[key]=value;
  }
  return values;
}
function parse<T>(schema:z.ZodType<T>,value:unknown):T {
  const parsed=schema.safeParse(value);
  if(!parsed.success) throw new HTTPError(400,'Invalid request fields or filters.');
  return parsed.data;
}
function json(data:unknown,status=200,headers:Record<string,string>={}) {
  return Response.json(data,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff',...headers}});
}
function requireWrite(session:DeviceSession) {
  if(session.scope!=='write') throw new HTTPError(403,'This device signed in before editing was available. Sign in again to make changes.');
}
function invalid(errors:Record<string,string>):never { throw new HTTPError(422,'Check the highlighted fields.',errors); }
type TaskRecord = {projectId:number;updatedAt:string};
/** Runs a create once per session and key: a retry with the same request gets the stored 201 response instead of a second record. */
function idempotent(session:DeviceSession,key:string|null,request:string,now:number,write:()=>object):Response {
  if(!key || !IDEMPOTENCY_KEY.test(key)) throw new HTTPError(400,'Send an Idempotency-Key header of 16 to 100 letters, digits, dashes, or underscores.');
  const hash=createHash('sha256').update(request).digest('hex');
  // One transaction for the lookup, the write, and the stored response, so a concurrent retry cannot write twice.
  return transaction(() => {
    const db=getDb();
    const stored=db.prepare('SELECT request_hash AS hash, status, body FROM idempotency_keys WHERE session_id = ? AND key = ?').get(session.id,key) as {hash:string;status:number;body:string}|undefined;
    if(stored) {
      if(stored.hash!==hash) throw new HTTPError(422,'This Idempotency-Key was already used for a different request.');
      return json(JSON.parse(stored.body),stored.status,{'idempotent-replayed':'true'});
    }
    const body=write();
    db.prepare('DELETE FROM idempotency_keys WHERE created_at <= ?').run(now-KEY_HOURS*3600_000);
    db.prepare('INSERT INTO idempotency_keys(session_id,key,request_hash,status,body,created_at) VALUES(?,?,?,?,?,?)').run(session.id,key,hash,201,JSON.stringify(body),now);
    return json(body,201);
  });
}
/** One write endpoint. `key` marks a create (Idempotency-Key, 201); `body` says whether it reads a JSON body, of at most `limit` bytes. */
type WriteRoute = {key:boolean;body:boolean;limit:number;prepare:(id:number,raw:unknown,now:number)=>()=>object};
// The body is parsed before any transaction opens, so a malformed one is a 400 that never reaches the write.
function route<T>(options:{key?:true;body?:z.ZodType<T>;limit?:number},write:(id:number,values:T,now:number)=>object):WriteRoute {
  const {key,body,limit=BODY_LIMIT}=options;
  return {key:!!key,body:!!body,limit,prepare:(id,raw,now)=>{const values=(body?parse(body,raw):undefined) as T;return ()=>write(id,values,now);}};
}
// Keyed by path, with the record ID as `:id`, then by method. A Map, so paths such as `constructor` match nothing.
// Each write runs synchronously in one transaction and returns the JSON response body.
const writeRoutes=new Map<string,Partial<Record<string,WriteRoute>>>([
  ['tasks',{POST:route({key:true,body:bodies.createTask},(_,{projectId,...values})=>{
    const result=writes.saveTask(projectId,null,values);
    return result.ok ? {data:readTask(result.id)} : invalid(result.errors);
  })}],
  ['tasks/:id',{
    PATCH:route({body:bodies.editTask},(id,{updatedAt,...values})=>{
      const task=readTask(id) as TaskRecord|null;
      if(!task) throw new HTTPError(404,'Task no longer exists.');
      // The version check and the write share the route's transaction, so nothing can change in between.
      if(task.updatedAt!==updatedAt) throw new HTTPError(409,'This task changed elsewhere. Reload to see the latest version.');
      const result=writes.saveTask(task.projectId,id,values);
      return result.ok ? {data:readTask(id)} : invalid(result.errors);
    }),
    DELETE:route({},id=>{
      const task=readTask(id) as TaskRecord|null;
      if(!task || !projects.deleteTask(task.projectId,id)) throw new HTTPError(404,'Task no longer exists.');
      return {ok:true};
    }),
  }],
  ['projects',{POST:route({key:true,body:bodies.createProject},(_,values)=>{
    const result=writes.saveProject(null,values);
    return result.ok ? {data:projects.getProject(result.id)} : invalid(result.errors);
  })}],
  ['projects/:id',{PATCH:route({body:bodies.editProject},(id,{updatedAt,...values})=>{
    const project=projects.getProject(id);
    if(!project) throw new HTTPError(404,'Project no longer exists.');
    if(project.updatedAt!==updatedAt) throw new HTTPError(409,'This project changed elsewhere. Reload to see the latest version.');
    const result=writes.saveProject(id,values);
    return result.ok ? {data:projects.getProject(id)} : invalid(result.errors);
  })}],
  // Archive and restore check no version, as on the web: each one is undone by the other.
  ['projects/:id/archive',{POST:route({},id=>{projects.setProjectArchived(id,true);return {data:projects.getProject(id)};})}],
  ['projects/:id/restore',{POST:route({},id=>{projects.setProjectArchived(id,false);return {data:projects.getProject(id)};})}],
  ['clients',{POST:route({key:true,body:bodies.createClient},(_,values)=>{
    const result=writes.saveClient(null,values);
    return result.ok ? {data:readClient(result.id)} : invalid(result.errors);
  })}],
  ['clients/:id',{
    PATCH:route({body:bodies.editClient},(id,{updatedAt,...values})=>{
      const client=readClient(id) as {updatedAt:string}|null;
      if(!client) throw new HTTPError(404,'Client no longer exists.');
      if(client.updatedAt!==updatedAt) throw new HTTPError(409,'This client changed elsewhere. Reload to see the latest version.');
      const result=writes.saveClient(id,values);
      return result.ok ? {data:readClient(id)} : invalid(result.errors);
    }),
    DELETE:route({},id=>{
      let deleted:boolean;
      // The refusal carries no errors, so the app shows the writer's sentence rather than "Check the highlighted fields."
      try {deleted=repo.deleteClient(id);} catch(error) {if(error instanceof repo.ProjectConflictError) throw new HTTPError(422,error.message);throw error;}
      if(!deleted) throw new HTTPError(404,'Client no longer exists.');
      return {ok:true};
    }),
  }],
]);
// The app renders this document offline, so it may load nothing: images and fonts arrive inline and scripts never run.
const PRINT_CSP="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";
// no-transform keeps proxies from rewriting the document: Cloudflare's email obfuscation swaps addresses for
// "[email protected]" and relies on a script to restore them, and this document never runs scripts.
function html(body:string) {
  return new Response(body,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store, no-transform','x-content-type-options':'nosniff','content-security-policy':PRINT_CSP}});
}
// /public is behind the web login, so the document carries its images and fonts as data URIs. Read once, retried after a failure.
let printAssets:Promise<{images:PrintImages;fonts:PrintFonts}>|undefined;
function loadPrintAssets() {
  const read=(path:string,type:string)=>readFile(join(process.cwd(),'public',path)).then(data=>`data:${type};base64,${data.toString('base64')}`);
  printAssets??=Promise.all([read('brand/icon.png','image/png'),read('brand/logo-navy.png','image/png'),
    read('fonts/montserrat-latin.woff2','font/woff2'),read('fonts/montserrat-latin-ext.woff2','font/woff2')])
    .then(([icon,logo,latin,latinExt])=>({images:{icon,logo},fonts:{latin,latinExt}}));
  return printAssets.catch(error=>{printAssets=undefined;throw error;});
}
async function jsonBody(request:Request,limit=BODY_LIMIT) {
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new HTTPError(400,'Send a JSON request.');
  const reader=request.body?.getReader(); if(!reader) throw new HTTPError(400,'A JSON body is required.');
  let size=0; const chunks:Uint8Array[]=[];
  try {
    while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HTTPError(413,'The request is too large.');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size); let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {return JSON.parse(new TextDecoder().decode(bytes));} catch {throw new HTTPError(400,'Invalid JSON.');}
}
export async function handleMobileRequest(request:Request,now=Date.now()):Promise<Response> {
  try {
    const url=new URL(request.url); const parts=url.pathname.replace(/^\/api\/v1\/?/,'').split('/');
    const [resource,idText,...extra]=parts; const method=request.method;
    if(resource==='sessions' && !idText && extra.length===0 && method==='POST') {
      parse(z.object({}).strict(),parameters(url));
      const body=parse(z.object({password:z.string().min(1).max(1024),deviceName:z.string().trim().min(1).max(100)}).strict(),await jsonBody(request));
      if(!checkPassword(body.password)) {await new Promise(resolve=>setTimeout(resolve,800));throw new HTTPError(401,'Unable to sign in. Check the password.');}
      return json(createDeviceSession(body.deviceName,now),201);
    }
    const authorization=request.headers.get('authorization');
    const current=verifyDeviceSession(authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],now);
    if(!current) throw new HTTPError(401,'Your device session expired or was revoked. Sign in again.');
    if(resource==='invoices' && idText && extra.length===1 && extra[0]==='print') {
      if(method!=='GET') throw new HTTPError(405,'This API is read-only.');
      const {version:asked}=parse(z.object({version:z.enum(['full','payments','dp']).optional()}).strict(),parameters(url));
      const invoice=repo.getInvoice(parse(positive,idText));
      if(!invoice) throw new HTTPError(404,'Record no longer exists.');
      // Same choice as the web print page: an unavailable version falls back to the invoice's default one.
      const {version}=printVersions(invoice.payments.length>0,invoice.downPaymentValue>0,asked);
      const {images,fonts}=await loadPrintAssets();
      return html(invoicePrintDocument(invoice,repo.getSettings(),version,images,fonts));
    }
    const routes=writeRoutes.get([resource,...(idText?[':id']:[]),...extra].join('/'));
    // Every non-GET on a table path, and GET only on an action path: GET /projects/:id stays a read.
    if(routes && (method!=='GET' || extra.length)) {
      const row=routes[method]; if(!row) throw new HTTPError(405,'Method not allowed.');
      requireWrite(current);
      parse(z.object({}).strict(),parameters(url));
      const id=idText?parse(positive,idText):0;
      // Read and parse the body first: transaction() is synchronous, so the write itself can't await.
      const raw=row.body?await jsonBody(request,row.limit):undefined;
      const write=row.prepare(id,raw,now);
      // The hash covers the whole path, so one key can't replay a duplicate of a different invoice.
      const path=[resource,idText,...extra].filter(Boolean).join('/');
      return row.key ? idempotent(current,request.headers.get('idempotency-key'),`${method} ${path} ${JSON.stringify(raw)}`,now,write) : json(transaction(write));
    }
    if(extra.length || !resource) throw new HTTPError(404,'Not found.');
    if(resource==='sessions') {
      parse(z.object({}).strict(),parameters(url));
      if(method==='GET' && !idText) return json({data:listDeviceSessions(now).map(s=>({...s,current:s.id===current.id}))});
      if(method==='DELETE' && idText) {
        const id=parse(positive,idText);
        if(!revokeDeviceSession(id,now)) throw new HTTPError(404,'Session no longer exists.');
        return json({ok:true});
      }
      throw new HTTPError(405,'Method not allowed.');
    }
    if(resource==='settings' && !idText) {
      if(method!=='GET') throw new HTTPError(405,'Method not allowed.');
      parse(z.object({}).strict(),parameters(url));
      return json({data:repo.getSettings()});
    }
    if(method!=='GET') throw new HTTPError(405,'This API is read-only.');
    const todayDate=today(new Date(now));
    if(resource==='overview' && !idText) {
      parse(z.object({}).strict(),parameters(url));
      return json({data:{today:todayDate,financial:repo.dashboard(todayDate),work:projects.workSummary(todayDate,5)}});
    }
    if(!Object.hasOwn(filters,resource)) throw new HTTPError(404,'Not found.');
    if(idText) {
      parse(z.object({}).strict(),parameters(url));const id=parse(positive,idText);
      let data:unknown=null;
      if(resource==='clients') data=readClient(id);
      if(resource==='tasks') data=readTask(id);
      if(resource==='projects') data=projects.getProject(id);
      if(resource==='invoices') data=readInvoice(id,todayDate);
      if(!data) throw new HTTPError(404,'Record no longer exists.');
      return json({data});
    }
    const params=parameters(url);
    if(resource==='clients') {const {page,pageSize,...filter}=parse(filters.clients,params);return json(readClients(filter,page,pageSize));}
    if(resource==='tasks') {const {page,pageSize,...filter}=parse(filters.tasks,params);return json(readTasks(filter,page,pageSize,todayDate));}
    if(resource==='projects') {const {page,pageSize,...filter}=parse(filters.projects,params);return json(pageOf(projects.listProjects(filter,todayDate,pageSize,(page-1)*pageSize),projects.countProjects(filter,todayDate),page,pageSize));}
    const {page,pageSize,...filter}=parse(filters.invoices,params);
    return json(pageOf(repo.listInvoices(filter,todayDate,pageSize,(page-1)*pageSize),repo.countInvoices(filter,todayDate),page,pageSize));
  } catch(error) {
    if(error instanceof HTTPError) return json({message:error.message,...(error.errors && {errors:error.errors})},error.status);
    if(error instanceof repo.NotFoundError) return json({message:error.message},404);
    if(error instanceof repo.ProjectConflictError || error instanceof repo.PaymentConflictError) return json({message:'Check the highlighted fields.',errors:{[error.field]:error.message}},422);
    return json({message:'Unable to load data. Try again.'},500);
  }
}
