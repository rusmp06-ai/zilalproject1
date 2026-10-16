import {useState} from 'react';
import {canReadDocument} from './reader-tools';
import {CourseReader} from './CourseReader';
import type {Gateway,CourseMaterial} from './types';
export function AssignmentSource({api,id}:{api:Gateway;id?:string|null}){
 const [item,setItem]=useState<CourseMaterial|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!id)return null;
 return <div className="assignment-source"><button type="button" disabled={busy} onClick={()=>void(async()=>{setBusy(true);setError('');try{const source=await api.readerSource(id);if(source.kind!=='course')throw Error('Исходный файл недоступен.');if(canReadDocument(source.item.mime_type||''))setItem(source.item);else{const blob=await api.downloadMaterial(source.item);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=source.item.original_name||'document';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(e){setError((e as Error).message);}finally{setBusy(false);}})()}>{busy?'Открываем…':'Открыть исходный документ задания'}</button>{error&&<p role="alert">{error}</p>}{item&&<CourseReader api={api} material={item} onClose={()=>setItem(null)}/>}</div>;
}
