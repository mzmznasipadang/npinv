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
import { pageOf, readClients, readClient, readTasks, readTask } from './mobile-read.ts';
import { displayStatus, isValidDate, printVersions, today } from './rules.ts';
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
const bodies = {
  createTask:z.object({projectId:z.int().positive(),...taskValues}).strict(),
  editTask:z.object({...taskValues,updatedAt:z.string().max(40)}).strict(),
};
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
/** Runs a create once per session and key: a retry with the same request gets the stored response instead of a second record. */
function idempotent(session:DeviceSession,key:string|null,request:string,now:number,write:()=>{status:number;data:unknown}):Response {
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
    const {status,data}=write();
    db.prepare('DELETE FROM idempotency_keys WHERE created_at <= ?').run(now-KEY_HOURS*3600_000);
    db.prepare('INSERT INTO idempotency_keys(session_id,key,request_hash,status,body,created_at) VALUES(?,?,?,?,?,?)').run(session.id,key,hash,status,JSON.stringify({data}),now);
    return json({data},status);
  });
}
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
async function jsonBody(request:Request) {
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new HTTPError(400,'Send a JSON request.');
  const reader=request.body?.getReader(); if(!reader) throw new HTTPError(400,'A JSON body is required.');
  let size=0; const chunks:Uint8Array[]=[];
  try {
    while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new HTTPError(413,'The request is too large.');}chunks.push(value);}
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
    if(resource==='tasks' && method!=='GET') {
      if(idText ? method!=='PATCH' && method!=='DELETE' : method!=='POST') throw new HTTPError(405,'Method not allowed.');
      requireWrite(current);
      parse(z.object({}).strict(),parameters(url));
      if(!idText) {
        const raw=await jsonBody(request); const {projectId,...values}=parse(bodies.createTask,raw);
        return idempotent(current,request.headers.get('idempotency-key'),`POST tasks ${JSON.stringify(raw)}`,now,() => {
          const result=writes.saveTask(projectId,null,values);
          return result.ok ? {status:201,data:readTask(result.id)} : invalid(result.errors);
        });
      }
      const id=parse(positive,idText);
      if(method==='DELETE') {
        const task=readTask(id) as TaskRecord|null;
        if(!task || !projects.deleteTask(task.projectId,id)) throw new HTTPError(404,'Task no longer exists.');
        return json({ok:true});
      }
      const {updatedAt,...values}=parse(bodies.editTask,await jsonBody(request));
      // The version check and the write share a transaction, so nothing can change in between.
      return json({data:transaction(() => {
        const task=readTask(id) as TaskRecord|null;
        if(!task) throw new HTTPError(404,'Task no longer exists.');
        if(task.updatedAt!==updatedAt) throw new HTTPError(409,'This task changed elsewhere. Reload to see the latest version.');
        const result=writes.saveTask(task.projectId,id,values);
        return result.ok ? readTask(id) : invalid(result.errors);
      })});
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
      if(resource==='invoices') {const invoice=repo.getInvoice(id);data=invoice?{...invoice,display:displayStatus(invoice.status,invoice.dueDate,todayDate,invoice.paid),printVersions:printVersions(invoice.payments.length>0,invoice.downPaymentValue>0,undefined).versions}:null;}
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
    if(error instanceof repo.ProjectConflictError) return json({message:'Check the highlighted fields.',errors:{[error.field]:error.message}},422);
    return json({message:'Unable to load data. Try again.'},500);
  }
}
