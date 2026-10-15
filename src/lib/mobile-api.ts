import { z } from 'zod';
import { checkPassword } from './auth.ts';
import { createDeviceSession, listDeviceSessions, revokeDeviceSession, verifyDeviceSession } from './mobile-sessions.ts';
import * as repo from './repo.ts';
import * as projects from './projects.ts';
import { pageOf, readClients, readClient, readTasks, readTask } from './mobile-read.ts';
import { displayStatus, isValidDate, today } from './rules.ts';

class HTTPError extends Error { status:number; constructor(status:number,message:string) {super(message);this.status=status;} }
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
function json(data:unknown,status=200) {
  return Response.json(data,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}
async function loginBody(request:Request) {
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new HTTPError(400,'Send a JSON request.');
  const reader=request.body?.getReader(); if(!reader) throw new HTTPError(400,'A login body is required.');
  let size=0; const chunks:Uint8Array[]=[];
  try {
    while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new HTTPError(413,'Login request is too large.');}chunks.push(value);}
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
      const body=parse(z.object({password:z.string().min(1).max(1024),deviceName:z.string().trim().min(1).max(100)}).strict(),await loginBody(request));
      if(!checkPassword(body.password)) {await new Promise(resolve=>setTimeout(resolve,800));throw new HTTPError(401,'Unable to sign in. Check the password.');}
      return json(createDeviceSession(body.deviceName,now),201);
    }
    const authorization=request.headers.get('authorization');
    const current=verifyDeviceSession(authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],now);
    if(!current) throw new HTTPError(401,'Your device session expired or was revoked. Sign in again.');
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
      if(resource==='invoices') {const invoice=repo.getInvoice(id);data=invoice?{...invoice,display:displayStatus(invoice.status,invoice.dueDate,todayDate,invoice.paid)}:null;}
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
    if(error instanceof HTTPError) return json({message:error.message},error.status);
    return json({message:'Unable to load data. Try again.'},500);
  }
}
