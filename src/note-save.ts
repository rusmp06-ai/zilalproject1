import type {Gateway,Note} from './types';
export type PendingNoteSave={title:string;body:string;id:string|null;version:number|null;knownIds:string[]};
async function candidates(api:Gateway,title:string){
 const notes:Note[]=[];
 for(let offset=0;offset<1000;offset+=50){const page=await api.notes(title.trim(),offset);notes.push(...page);if(page.length<50)break;}
 return notes;
}
const matches=(note:Note,request:PendingNoteSave)=>note.title===request.title.trim()&&note.body===request.body&&(request.id?note.id===request.id&&note.version===(request.version||0)+1:!request.knownIds.includes(note.id));

// If a response is lost, check the authorized catalog before issuing another write.
export async function saveNoteSafely(api:Gateway,input:Omit<PendingNoteSave,'knownIds'>,pending:PendingNoteSave|null,remember:(request:PendingNoteSave|null)=>void){
 let request=pending;
 if(request){
  const notes=await candidates(api,request.title);
  if(notes.some(note=>matches(note,request!))){remember(null);return;}
 }else{
  const notes=await candidates(api,input.title);
  request={...input,knownIds:notes.map(note=>note.id)};
 }
 remember(request);
 try{await api.saveNote(request.title,request.body,request.id,request.version);}
 catch(error){
  let notes:Note[];
  try{notes=await candidates(api,request.title);}catch{throw Error('Не удалось проверить сохранение заметки. Текст сохранён в черновике. Подключитесь к сети и нажмите «Проверить сохранение».');}
  if(!notes.some(note=>matches(note,request!))){remember(null);throw error;}
 }
 remember(null);
}
