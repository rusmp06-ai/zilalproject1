import OptimizerWorker from './pdf-optimize.worker?worker&inline';
import {loadPdf,type PDFDocumentProxy} from './pdf-reader';
function equalBytes(a:Uint8ClampedArray,b:Uint8ClampedArray){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
export type Optimization={file:File;optimized:boolean;message:string};
function cancelled(signal:AbortSignal){if(signal.aborted)throw new DOMException('Cancelled','AbortError');}
async function repack(bytes:Uint8Array,signal:AbortSignal){return new Promise<Uint8Array>((resolve,reject)=>{
 const worker=new OptimizerWorker();const stop=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
 const abort=()=>{stop();reject(new DOMException('Cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});
 worker.onmessage=e=>{stop();if(e.data.error)reject(Error(e.data.error));else resolve(e.data.bytes);};worker.onerror=()=>{stop();reject(Error('invalid'));};
 if(signal.aborted){abort();return;}worker.postMessage(bytes,[bytes.buffer]);
});}
async function verify(original:Uint8Array,output:Uint8Array,signal:AbortSignal,onProgress:(text:string)=>void){
 const tasks=[loadPdf(original),loadPdf(output)];let docs:PDFDocumentProxy[]=[];
 const abort=()=>{for(const t of tasks)void t.destroy().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  docs=await Promise.all(tasks.map(t=>t.promise));cancelled(signal);const [a,b]=docs;
  if(a.numPages!==b.numPages||a.numPages>40)throw Error('verification');
  if(await a.getAttachments()||await b.getAttachments())throw Error('interactive');
  if(JSON.stringify(await a.getOutline())!==JSON.stringify(await b.getOutline()))throw Error('verification');
  let pixels=0;
  for(let i=1;i<=a.numPages;i++){
   cancelled(signal);onProgress(`Проверяем страницу ${i} из ${a.numPages}…`);
   const pages=await Promise.all([a.getPage(i),b.getPage(i)]);const views=pages.map(p=>p.getViewport({scale:1}));
   if(views[0].width!==views[1].width||views[0].height!==views[1].height)throw Error('verification');
   const w=Math.ceil(views[0].width),h=Math.ceil(views[0].height);pixels+=w*h;
   if(w*h>4000000||pixels>40000000)throw Error('limit');
   const texts=await Promise.all(pages.map(p=>p.getTextContent()));const normalize=(t:typeof texts[0])=>t.items.map(item=>'str' in item?{str:item.str,dir:item.dir,width:item.width,height:item.height,transform:item.transform,hasEOL:item.hasEOL,font:t.styles[item.fontName]}:item);if(JSON.stringify(normalize(texts[0]))!==JSON.stringify(normalize(texts[1])))throw Error('verification');
   const images=[];
   for(let j=0;j<2;j++){
    cancelled(signal);const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('verification');
    const render=pages[j].render({canvas,canvasContext:context,viewport:views[j]});const cancelRender=()=>render.cancel();signal.addEventListener('abort',cancelRender,{once:true});
    try{await render.promise;images.push(context.getImageData(0,0,w,h).data);}finally{signal.removeEventListener('abort',cancelRender);canvas.width=0;canvas.height=0;}
   }
   if(!equalBytes(images[0],images[1]))throw Error('verification');pages.forEach(p=>p.cleanup());
  }
 }finally{signal.removeEventListener('abort',abort);await Promise.allSettled(tasks.map(t=>t.destroy()));}
}
export async function optimizePdf(file:File,signal:AbortSignal,onProgress:(text:string)=>void):Promise<Optimization>{
 const original=(message:string):Optimization=>({file,optimized:false,message});
 if(!/\.pdf$/i.test(file.name))return original('Этот формат уже упакован или пока не поддерживает безопасную оптимизацию.');
 if(!file.size||file.size>20*1024*1024)return original('Для локальной оптимизации нужен PDF до 20 МБ.');
 const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},60000);
 try{
  cancelled(controller.signal);onProgress('Оптимизируем упаковку PDF…');const bytes=new Uint8Array(await file.arrayBuffer());cancelled(controller.signal);
  const output=await repack(bytes.slice(),controller.signal);cancelled(controller.signal);
  if(output.length>=file.size)return original('Файл уже хорошо сжат. Для загрузки выбран оригинал.');
  await verify(bytes,output.slice(),controller.signal,onProgress);cancelled(controller.signal);
  return {file:new File([new Uint8Array(output)],file.name,{type:'application/pdf',lastModified:file.lastModified}),optimized:true,message:'Текст и отображение страниц проверены. Изображения сохранены без изменения качества.'};
 }catch(e){
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  if(timedOut)return original('Проверка заняла слишком много времени. Для загрузки выбран оригинал.');
  const reason=e instanceof Error?e.message:'';
  return original(reason==='interactive'||reason==='protected'||/encrypt|password/i.test(reason)?'Защищённые и интерактивные PDF сохраняем без изменений.':reason==='limit'?'Документ слишком сложный для безопасной проверки на этом устройстве. Выбран оригинал.':'Безопасную оптимизацию подтвердить не удалось. Для загрузки выбран оригинал.');
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
