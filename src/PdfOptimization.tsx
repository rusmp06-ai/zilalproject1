import {useEffect,useRef,useState} from 'react';
import {sizeLabel} from './files';
export function PdfOptimization({file,onChange,onBusy,disabled=false}:{file:File|null;onChange:(file:File)=>void;onBusy:(busy:boolean)=>void;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[original,setOriginal]=useState<File|null>(null),[saved,setSaved]=useState(0);const controller=useRef<AbortController|null>(null),own=useRef<File|null>(null),busyCallback=useRef(onBusy);busyCallback.current=onBusy;
 useEffect(()=>{if(file===own.current)return;controller.current?.abort();controller.current=null;setBusy(false);busyCallback.current(false);setMessage('');setOriginal(null);setSaved(0);own.current=null;},[file]);
 useEffect(()=>()=>{controller.current?.abort();busyCallback.current(false);},[]);
 async function optimize(){if(!file||busy)return;const control=new AbortController();controller.current=control;setBusy(true);onBusy(true);setMessage('Подготовка…');
  try{const {optimizePdf}=await import('./pdf-optimize');if(control.signal.aborted)return;const result=await optimizePdf(file,control.signal,text=>{if(controller.current===control)setMessage(text);});if(controller.current!==control||control.signal.aborted)return;
   setMessage(result.message);if(result.optimized){setOriginal(file);setSaved(file.size-result.file.size);own.current=result.file;onChange(result.file);}
  }catch{if(controller.current===control&&!control.signal.aborted)setMessage('Оптимизация недоступна. Для загрузки выбран оригинал.');}
  finally{if(controller.current===control){controller.current=null;setBusy(false);busyCallback.current(false);}}
 }
 if(!file||!/\.pdf$/i.test(file.name))return null;
 return <div className="pdf-optimization"><p>{original?`Было ${sizeLabel(original.size)} → стало ${sizeLabel(file.size)}. Экономия ${Math.round(saved/original.size*100)}%.`:`PDF · ${sizeLabel(file.size)}`}</p><div className="card-actions">{!original&&!busy&&<button type="button" disabled={disabled} onClick={()=>void optimize()}>Оптимизировать без потери качества</button>}{busy&&<button type="button" onClick={()=>{controller.current?.abort();controller.current=null;setBusy(false);onBusy(false);setMessage('Оптимизация отменена. Выбран оригинал.');}}>Отменить оптимизацию</button>}{original&&<button type="button" disabled={disabled} onClick={()=>{own.current=null;onChange(original);}}>Вернуть оригинал</button>}</div><p className="helper" role="status" aria-live="polite">{message||'Обработка на вашем устройстве. Оригинал остаётся у вас; некоторые PDF не уменьшатся.'}</p></div>;
}
