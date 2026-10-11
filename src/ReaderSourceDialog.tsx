import {useEffect,useRef} from 'react';
import {ReaderPanel} from './ReaderPanel';
import {CourseReader} from './CourseReader';
import type {Gateway,ReaderSource} from './types';
export function ReaderSourceDialog({api,source,page,onClose,localOnly=false}:{api:Gateway;source:ReaderSource;page:number;onClose:()=>void;localOnly?:boolean}){
 const dirty=useRef(false),dialog=useRef<HTMLElement>(null);
 const close=()=>{if(!dirty.current||window.confirm('В читалке есть несохранённая заметка. Закрыть документ?'))onClose();};
 useEffect(()=>{if(source.kind==='course')return;const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.fullscreenElement){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...dialog.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,[tabindex]')||[]].filter(n=>!n.hasAttribute('disabled')&&n.getAttribute('tabindex')!=='-1');if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus();};},[source.kind]);
 if(source.kind==='course')return <CourseReader api={api} material={source.item} initialPage={page} onClose={onClose}/>;
 return <section ref={dialog} className="preview-modal" role="dialog" aria-modal="true" aria-label={source.item.title}><div className="preview-content"><header><h2>{source.item.title}</h2><button autoFocus onClick={close}>Закрыть просмотр</button></header><ReaderPanel allowNotes={!localOnly} allowFavorite={!localOnly} storageHint={localOnly?'Позиция и закладки этой копии сохраняются только на устройстве, без синхронизации с аккаунтом.':undefined} api={api} item={source.item} initialPage={page} onChanged={()=>{}} onDirtyChange={value=>{dirty.current=value;}}/></div></section>;
}
