import {useEffect,useMemo,useRef,useState} from 'react';
import {ReaderPanel} from './ReaderPanel';
import {courseReading} from './course-reading';
import type {Gateway,CourseMaterial,LibraryItem} from './types';

// Course files and personal reading state use their own authorized APIs.
export function CourseReader({api,material,onClose}:{api:Gateway;material:CourseMaterial;onClose:()=>void}){
 const [user,setUser]=useState(''),[error,setError]=useState(''),[storageLimited,setStorageLimited]=useState(false),[local,setLocal]=useState(false);const dirty=useRef(false),dialog=useRef<HTMLElement>(null);
 const close=()=>{if(!dirty.current||window.confirm('В читалке есть несохранённая заметка. Закрыть документ?'))onClose();};
 useEffect(()=>{let alive=true;api.snapshot().then(s=>{if(alive)setUser(s.me.id);}).catch(()=>{if(alive)setError('Не удалось проверить аккаунт. Откройте документ заново.');});return()=>{alive=false;};},[api]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.fullscreenElement){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...dialog.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,[tabindex]')||[]].filter(n=>!n.hasAttribute('disabled')&&n.getAttribute('tabindex')!=='-1');if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus();};},[]);
 const bridge=useMemo(()=>{
  const item:LibraryItem={id:material.id,title:material.title,author_id:'',author_name:material.author_name,source_group_id:'',group_name:'',created_at:material.created_at,status:'published',storage_path:material.storage_path||'',original_name:material.original_name||'',mime_type:material.mime_type||'',size_bytes:material.size_bytes||0,can_manage:false};
  const reading=courseReading(api,user,material.id,limited=>{setLocal(true);setStorageLimited(limited);});
  const gateway:Gateway={...api,downloadLibrary:()=>api.downloadMaterial(material),readingState:()=>reading.read(),saveReading:next=>reading.save(next)};
  return {item,gateway};
 },[api,material,user]);
 return <section ref={dialog} className="preview-modal" role="dialog" aria-modal="true" aria-label={material.title}><div className="preview-content"><header><h2>{material.title}</h2><button autoFocus onClick={close}>Закрыть просмотр</button></header>{local&&!storageLimited&&<p role="status" className="notice">Сохранение в аккаунте ещё не включено: позиция и закладки пока остаются на этом устройстве.</p>}{storageLimited&&<p role="status" className="notice">На устройстве не удалось сохранить отметки. Они доступны до закрытия документа; личные заметки сохраняются отдельно в аккаунте.</p>}{error?<p role="alert" className="notice error">{error}</p>:user?<ReaderPanel api={bridge.gateway} item={bridge.item} onChanged={()=>{}} allowFavorite={false} notesLabel="Заметки к документу" storageHint={local?"Позиция и закладки пока на этом устройстве. Заметки — в аккаунте.":"Позиция, закладки и заметки сохраняются в вашем аккаунте. Оформление — на этом устройстве."} onDirtyChange={value=>{dirty.current=value;}}/>:<p role="status">Открываем документ…</p>}</div></section>;
}
