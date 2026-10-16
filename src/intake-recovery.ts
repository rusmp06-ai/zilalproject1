import type {Gateway} from './types';
import type {IntakePublication} from './material-intake-types';
import {validateFile} from './files';
export type PendingIntake={schema:1;publication:IntakePublication;name:string;size:number;mime:string;hash:string;deleting:boolean};
const key=(api:Gateway,user:string)=>'studyhub-upload-v1:'+(api.demo?'demo:':'live:')+user;
export function pendingIntake(api:Gateway,user:string):PendingIntake|null{
 const raw=localStorage.getItem(key(api,user));if(!raw)return null;
 try{const p=JSON.parse(raw) as PendingIntake;if(!p||typeof p!=='object'||p.schema!==1||!p.publication||typeof p.publication.request!=='string'||typeof p.publication.title!=='string'||p.publication.title.length>200||typeof p.publication.description!=='string'||p.publication.description.length>50000||!['lecture','presentation','material','assignment','book'].includes(p.publication.kind)||typeof p.publication.late!=='boolean'||!Number.isInteger(p.publication.max)||p.publication.max<1||p.publication.max>1000||p.publication.due!==null&&!Number.isFinite(Date.parse(p.publication.due))||typeof p.name!=='string'||!Number.isInteger(p.size)||p.size<=0||p.size>10*1024*1024||!/^[a-f0-9]{64}$/.test(p.hash)||typeof p.mime!=='string'||typeof p.deleting!=='boolean')throw Error();return p;}catch{throw Error('Запись незавершённой публикации повреждена. Не начинайте повторную загрузку: проверьте незавершённые материалы в управлении.');}
}
export function forgetIntake(api:Gateway,user:string,request:string){try{if(pendingIntake(api,user)?.publication.request===request)localStorage.removeItem(key(api,user));}catch{/* The server status prevents a duplicate retry. */}}
export function markDeleting(api:Gateway,user:string,p:PendingIntake){localStorage.setItem(key(api,user),JSON.stringify(p));}
const payload=(p:IntakePublication)=>JSON.stringify({...p,request:''});
export async function publicationLock<T>(api:Gateway,user:string,work:()=>Promise<T>):Promise<T>{
 if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(key(api,user),{ifAvailable:true},lock=>{if(!lock)throw Error('Публикация обрабатывается в другой вкладке. Дождитесь завершения.');return work();});
 return work();
}
export async function publishRecoverable(api:Gateway,publication:IntakePublication,file:File,user?:string){
 const owner=user||(await api.snapshot()).me.id;
 return publicationLock(api,owner,()=>runPublication(api,publication,file,owner));
}
async function runPublication(api:Gateway,publication:IntakePublication,file:File,owner:string){
 const mime=validateFile(file),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
 let old:PendingIntake|null;
 try{old=pendingIntake(api,owner);}catch(e){throw e;}
 if(old&&(old.deleting||old.hash!==hash||old.name!==file.name||old.size!==file.size||old.mime!==mime||payload(old.publication)!==payload(publication)))throw Error('Есть незавершённая публикация. Откройте «Добавить документ с ИИ», чтобы продолжить или отменить её.');
 const prepared=old||{schema:1 as const,publication,name:file.name,size:file.size,mime,hash,deleting:false};
 try{localStorage.setItem(key(api,owner),JSON.stringify(prepared));}catch{throw Object.assign(Error('Браузер не сохранил данные для повтора. Разрешите хранение данных сайта и попробуйте снова; загрузка ещё не началась.'),{canEdit:true});}
 try{const id=await api.publishIntake(prepared.publication,file);forgetIntake(api,owner,prepared.publication.request);return id;}catch(e){if((e as {canEdit?:boolean}).canEdit)forgetIntake(api,owner,prepared.publication.request);throw e;}
}
export async function matchesIntake(p:PendingIntake,file:File){if(file.name!==p.name||file.size!==p.size||validateFile(file)!==p.mime)return false;const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');return hash===p.hash;}
