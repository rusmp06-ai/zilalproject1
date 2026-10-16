import {useEffect,useSyncExternalStore} from 'react';
import {registerSubmissionGuard} from './drafts';
export type DraftFile={name:string;size:number;type:string;lastModified:number};
type Value={schema:1;text:string;file:DraftFile|null;version:string;updatedAt:string};
type Snapshot={text:string;attachment:DraftFile|null;file:File|null;status:'empty'|'saving'|'saved'|'error'|'conflict';error:string;savedAt:string|null;sent:boolean};
const prefix='studyhub-submission-v1:';
const records=new Map<string,RecordState>();
let listening=false;
const metadata=(f:File):DraftFile=>({name:f.name,size:f.size,type:f.type,lastModified:f.lastModified});
function decode(raw:string|null):Value|null{
 if(raw===null)return null;const v=JSON.parse(raw);
 if(v?.schema!==1||typeof v.text!=='string'||v.text.length>50000||typeof v.version!=='string'||typeof v.updatedAt!=='string'||!Number.isFinite(Date.parse(v.updatedAt)))throw Error('Invalid draft');
 if(v.file!==null&&(!v.file||typeof v.file.name!=='string'||v.file.name.length>240||typeof v.file.size!=='number'||v.file.size<=0||v.file.size>10485760||typeof v.file.type!=='string'||typeof v.file.lastModified!=='number'))throw Error('Invalid attachment');
 return v;
}
class RecordState{
 snapshot:Snapshot={text:'',attachment:null,file:null,status:'empty',error:'',savedAt:null,sent:false};
 raw:string|null=null;invalid=false;pending=false;timer:ReturnType<typeof setTimeout>|null=null;listeners=new Set<()=>void>();
 constructor(readonly key:string){try{this.snapshot.sent=!!localStorage.getItem(key+':sent');this.raw=localStorage.getItem(key);const v=decode(this.raw);if(v)this.snapshot={...this.snapshot,text:v.text,attachment:v.file,status:'saved',savedAt:v.updatedAt};}catch{this.invalid=true;this.snapshot={...this.snapshot,status:'error',error:'Не удалось прочитать черновик на устройстве. Автоматическая перезапись остановлена.'};}}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 getSnapshot=()=>this.snapshot;
 emit(next:Partial<Snapshot>){this.snapshot={...this.snapshot,...next};for(const listener of this.listeners)listener();}
 edit(text:string,file:File|null,attachment:DraftFile|null){this.pending=true;this.emit({text,attachment,file,status:this.snapshot.status==='conflict'?'conflict':'saving',error:this.snapshot.status==='conflict'?this.snapshot.error:''});if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),300);}
 setText=(text:string)=>this.edit(text,this.snapshot.file,this.snapshot.attachment);
 setFile=(file:File|null)=>{this.edit(this.snapshot.text,file,file?metadata(file):null);if(file)limitFileMemory(this);};
 flush=(force=false):boolean=>{
  if(this.timer){clearTimeout(this.timer);this.timer=null;}if(!this.pending)return this.snapshot.status!=='error'&&this.snapshot.status!=='conflict';
  try{
   const actual=localStorage.getItem(this.key);
   if(!force&&(this.invalid||actual!==this.raw)){this.emit({status:'conflict',error:'Черновик изменён в другой вкладке или не прочитан. Ваш текст оставлен здесь и не перезаписывает другую версию.'});return false;}
   const empty=!this.snapshot.text&&!this.snapshot.attachment;const at=new Date().toISOString();const raw=empty?null:JSON.stringify({schema:1,text:this.snapshot.text,file:this.snapshot.attachment,version:crypto.randomUUID(),updatedAt:at} satisfies Value);
   if(raw===null)localStorage.removeItem(this.key);else localStorage.setItem(this.key,raw);
   this.raw=raw;this.invalid=false;this.pending=false;this.emit({status:empty?'empty':'saved',error:'',savedAt:empty?null:at});return true;
  }catch{this.emit({status:'error',error:'Не удалось сохранить черновик на устройстве. Не закрывайте вкладку: текст пока находится только в памяти.'});return false;}
 };
 remote(){
  try{const actual=localStorage.getItem(this.key);if(actual===this.raw)return;const value=decode(actual);
   if(!this.pending&&!this.snapshot.text&&!this.snapshot.attachment){this.raw=actual;this.invalid=false;this.emit({text:value?.text||'',attachment:value?.file||null,file:null,status:value?'saved':'empty',savedAt:value?.updatedAt||null,error:''});}
   else this.emit({status:'conflict',error:'В другой вкладке этот черновик изменён или удалён. Выберите, какую версию сохранить.'});
  }catch{this.emit({status:'error',error:'Не удалось прочитать обновление черновика. Ваш текст остаётся в этой вкладке.'});}
 }
 acceptRemote=()=>{try{const actual=localStorage.getItem(this.key),v=decode(actual);if(this.timer)clearTimeout(this.timer);this.timer=null;this.raw=actual;this.invalid=false;this.pending=false;this.emit({text:v?.text||'',attachment:v?.file||null,file:null,status:v?'saved':'empty',error:'',savedAt:v?.updatedAt||null});}catch{this.emit({status:'error',error:'Не удалось открыть другую версию. Ваш текст оставлен здесь.'});}};
 overwrite=()=>{this.pending=true;return this.flush(true);};
 markRemoteSent(){try{if(localStorage.getItem(this.key+':sent'))this.emit({sent:true});}catch{}}
 clear=()=>{if(this.timer)clearTimeout(this.timer);this.timer=null;this.pending=false;let removed=true;try{if(localStorage.getItem(this.key)===this.raw)localStorage.removeItem(this.key);}catch{removed=false;}try{localStorage.setItem(this.key+':sent',new Date().toISOString());}catch{removed=false;}this.raw=null;this.invalid=false;this.emit({text:'',attachment:null,file:null,status:'empty',error:'',savedAt:null,sent:true});return removed;};
}
function limitFileMemory(current:RecordState){let count=0;for(const record of [current,...[...records.values()].reverse().filter(r=>r!==current)])if(record.snapshot.file&&++count>5)record.emit({file:null});}
export function submissionDraftKey(mode:'demo'|'live',user:string,assignment:string,attempt:number){return prefix+[mode,user,assignment,String(attempt)].map(encodeURIComponent).join(':');}
function recordFor(key:string){
 if(!listening&&typeof window!=='undefined'){listening=true;window.addEventListener('storage',e=>{if(e.key===null)for(const record of records.values())record.remote();else if(e.key.endsWith(':sent'))records.get(e.key.slice(0,-5))?.markRemoteSent();else records.get(e.key)?.remote();});}
 let record=records.get(key);if(!record){record=new RecordState(key);records.set(key,record);}return record;
}
export function useSubmissionDraft(key:string,sending:boolean){
 const record=recordFor(key);const value=useSyncExternalStore(record.subscribe,record.getSnapshot);
 useEffect(()=>{
  const unregister=registerSubmissionGuard(key,{flush:record.flush,sending:()=>sending});
  const before=(e:BeforeUnloadEvent)=>{const saved=record.flush();if(!saved||record.snapshot.file||sending){e.preventDefault();e.returnValue='';}};
  const hide=()=>{record.flush();};const hidden=()=>{if(document.visibilityState==='hidden')record.flush();};document.addEventListener('visibilitychange',hidden);window.addEventListener('beforeunload',before);window.addEventListener('pagehide',hide);
  return()=>{record.flush();unregister();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('beforeunload',before);window.removeEventListener('pagehide',hide);};
 },[record,sending,key]);
 return {...value,read:record.getSnapshot,setText:record.setText,setFile:record.setFile,save:record.flush,acceptRemote:record.acceptRemote,overwrite:record.overwrite,clear:record.clear};
}
