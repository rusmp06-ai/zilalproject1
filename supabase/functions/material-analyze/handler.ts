import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';
import {geminiRequest,validateAnalysis,type Course} from './contract.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const reply=(status:number,message:string)=>new Response(JSON.stringify({error:message}),{status,headers:cors});
export function createMaterialHandler(config:{key?:string;model?:string;url:string;anonKey:string},fetcher:typeof fetch=fetch){return async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return reply(405,'Используйте POST.');
 const key=config.key;if(!key)return reply(503,'ИИ ещё не подключён. Владелец должен настроить Gemini на сервере.');
 const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))return reply(401,'Войдите в аккаунт.');
 const api=createClient(config.url,config.anonKey,{global:{headers:{Authorization:auth},fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:user,error:authError}=await api.auth.getUser(auth.slice(7));if(authError||!user.user)return reply(401,'Войдите в аккаунт заново.');
  const {data:context,error:contextError}=await api.rpc('material_intake_context');if(contextError)return reply(403,'Нет прав на добавление материалов или требуется SQL v0.30.');
  // Bound the actual streamed body; Content-Length is not trusted.
  const reader=req.body?.getReader();if(!reader)return reply(400,'Нет документа.');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>14500000){await reader.cancel();return reply(413,'Документ слишком большой для анализа.');}chunks.push(value);}
  const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}const input=JSON.parse(new TextDecoder().decode(body));
  if(typeof input.name!=='string'||input.name.length>240||typeof input.excerpted!=='boolean')return reply(400,'Неверный документ.');
  const supported=['application/pdf','image/jpeg','image/png','image/webp','text/plain'];if(!supported.includes(input.mime))return reply(400,'Формат анализа не поддерживается.');
  if(input.mime==='text/plain'){if(typeof input.text!=='string'||!input.text.trim()||input.text.length>100000||input.data)return reply(400,'Неверный текст.');}
  else{
   if(typeof input.data!=='string'||input.text||input.data.length>13981016||!input.data.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))return reply(400,'Неверный файл.');
   const bytes=Uint8Array.from(atob(input.data),c=>c.charCodeAt(0));if(bytes.length>10485760)return reply(413,'Файл больше 10 МБ.');
   if(input.mime==='application/pdf'){try{const pdf=await PDFDocument.load(bytes,{updateMetadata:false});if(pdf.getPageCount()>20)return reply(400,'Для анализа отправьте первые 20 страниц.');}catch{return reply(400,'PDF повреждён или защищён паролем.');}}
  }
  let courses:Course[]=context.courses;if(input.scopeCourse){const selected=courses.find(c=>c.id===input.scopeCourse);if(!selected)return reply(403,'Дисциплина недоступна.');courses=courses.filter(c=>c.group_id===selected.group_id);}
  if(input.scopeGroup){if(!courses.some(c=>c.group_id===input.scopeGroup)&&!context.groups.some((g:{id:string})=>g.id===input.scopeGroup))return reply(403,'Группа недоступна.');courses=courses.filter(c=>c.group_id===input.scopeGroup);}
  const {error:quotaError}=await api.rpc('begin_material_analysis');if(quotaError)return reply(429,'Дневной лимит анализа исчерпан. Заполните поля вручную или повторите завтра.');
  const model=config.model||'gemini-2.5-flash';if(!/^[a-zA-Z0-9.\-]+$/.test(model))return reply(503,'Неверная настройка модели.');
  const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(geminiRequest(input,courses,model)),signal:AbortSignal.any([req.signal,AbortSignal.timeout(45000)])});
  if(!response.ok)return reply(response.status===429?429:502,response.status===429?'Gemini временно исчерпал квоту. Повторите позже или заполните вручную.':'Gemini недоступен. Проверьте серверную настройку модели или заполните вручную.');
  const result=await response.json();const candidate=result.candidates?.[0];if(candidate?.finishReason!=='STOP')return reply(422,'ИИ не смог уверенно обработать документ. Заполните поля вручную.');
  const raw=candidate.content?.parts?.filter((p:{text?:string;thought?:boolean})=>p.text&&!p.thought).map((p:{text:string})=>p.text).join('');const analysis=validateAnalysis(JSON.parse(raw),courses,input.excerpted);
  return new Response(JSON.stringify(analysis),{headers:cors});
 }catch{return reply(422,'Не удалось безопасно проанализировать документ. Оригинал сохранён; поля можно заполнить вручную.');}
};}
