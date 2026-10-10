import {useEffect,useMemo,useRef,useState} from 'react';
import {ReaderPanel} from './ReaderPanel';
import {emptyReading,validateReading} from './reader-state';
import type {Gateway,CourseMaterial,LibraryItem,ReadingState} from './types';

// Documents remain protected by the course Storage API; course position is device-local.
export function CourseReader({api,material,onClose}:{api:Gateway;material:CourseMaterial;onClose:()=>void}){
 const [user,setUser]=useState(''),[error,setError]=useState(''),[storageLimited,setStorageLimited]=useState(false);const dirty=useRef(false),dialog=useRef<HTMLElement>(null);
 const close=()=>{if(!dirty.current||window.confirm('В читалке есть несохранённая заметка. Закрыть документ?'))onClose();};
 useEffect(()=>{let alive=true;api.snapshot().then(s=>{if(alive)setUser(s.me.id);}).catch(()=>{if(alive)setError('Не удалось проверить аккаунт. Откройте документ заново.');});return()=>{alive=false;};},[api]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.fullscreenElement){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...dialog.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,[tabindex]')||[]].filter(n=>!n.hasAttribute('disabled')&&n.getAttribute('tabindex')!=='-1');if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus();};},[]);
 const bridge=useMemo(()=>{
  const item:LibraryItem={id:material.id,title:material.title,author_id:'',author_name:material.author_name,source_group_id:'',group_name:'',created_at:material.created_at,status:'published',storage_path:material.storage_path||'',original_name:material.original_name||'',mime_type:material.mime_type||'',size_bytes:material.size_bytes||0,can_manage:false};
  const key='studyhub-course-reading-v1:'+user+':'+material.id;
  let memory=emptyReading(material.id),memoryOnly=false;
  const read=()=>{try{const raw=memoryOnly?null:localStorage.getItem(key);if(raw){const value=JSON.parse(raw) as ReadingState;validateReading(value);if(value.item_id===material.id)memory=value;}}catch{/* Ignore invalid local metadata. */}return {...memory,bookmarks:[...memory.bookmarks]};};
  const gateway:Gateway={...api,downloadLibrary:()=>api.downloadMaterial(material),readingState:async()=>read(),saveReading:async next=>{validateReading(next);const current=read();if(current.version!==next.version)throw Error('Позиция изменилась в другой вкладке. Обновите отметки.');memory={...next,version:current.version+1,bookmarks:[...new Set(next.bookmarks)].sort((a,b)=>a-b)};try{localStorage.setItem(key,JSON.stringify(memory));}catch{memoryOnly=true;setStorageLimited(true);/* Retain progress for this reading session. */}return read();}};
  return {item,gateway};
 },[api,material,user]);
 return <section ref={dialog} className="preview-modal" role="dialog" aria-modal="true" aria-label={material.title}><div className="preview-content"><header><h2>{material.title}</h2><button autoFocus onClick={close}>Закрыть просмотр</button></header>{storageLimited&&<p role="status" className="notice">На устройстве не удалось сохранить отметки. Они доступны до закрытия документа; личные заметки сохраняются отдельно в аккаунте.</p>}{error?<p role="alert" className="notice error">{error}</p>:user?<ReaderPanel api={bridge.gateway} item={bridge.item} onChanged={()=>{}} allowFavorite={false} notesLabel="Заметки к документу" storageHint="Позиция и закладки курса сохраняются на этом устройстве. Заметки — в вашем аккаунте." onDirtyChange={value=>{dirty.current=value;}}/>:<p role="status">Открываем документ…</p>}</div></section>;
}
