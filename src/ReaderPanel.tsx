import {useEffect,useRef,useState} from 'react';
import type {Gateway,LibraryItem,ReadingState} from './types';
import type {PDFDocumentProxy,RenderTask} from 'pdfjs-dist';
import {textPages} from './reader-state';
export function ReaderPanel({api,item,onChanged}:{api:Gateway;item:LibraryItem;onChanged:()=>void}){
 const [reading,setReading]=useState<ReadingState|null>(null),[pages,setPages]=useState<string[]|null>(null),[pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[pageText,setPageText]=useState(''),[busy,setBusy]=useState(true),[rendering,setRendering]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let alive=true;let task:ReturnType<typeof import('./pdf-reader')['loadPdf']>|undefined;setBusy(true);
 void (async()=>{try{
  const [blob,saved]=await Promise.all([api.downloadLibrary(item),api.readingState(item.id)]);
  let total:number;
  if(item.mime_type==='text/plain'){const p=textPages(await blob.text());total=p.length;if(alive)setPages(p);}
  else{const {loadPdf}=await import('./pdf-reader');if(!alive)return;const bytes=await blob.arrayBuffer();if(!alive)return;task=loadPdf(new Uint8Array(bytes));const document=await task.promise;total=document.numPages;if(alive)setPdf(document);}
  if(!alive)return;
  const next={...saved,page:Math.max(1,Math.min(saved.page,total)),total_pages:total,bookmarks:saved.bookmarks.filter(n=>n<=total)};
  setReading(next);const updated=await api.saveReading(next);if(alive){setReading(updated);onChanged();}
 }catch(e){if(alive)setError(e instanceof Error?e.message:'Не удалось открыть документ.');}finally{if(alive)setBusy(false);}})();
 return()=>{alive=false;void task?.destroy();};},[api,item.id]);
 useEffect(()=>{if(!pdf||!reading||!canvas.current)return;let alive=true;let render:RenderTask|undefined;setRendering(true);setPageText('');
 void (async()=>{try{const p=await pdf.getPage(reading.page);if(!alive)return;const view=p.getViewport({scale:1}),scale=Math.min(1.6,900/view.width,1600/view.height),viewport=p.getViewport({scale}),c=canvas.current;if(!c)return;c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);render=p.render({canvas:c,viewport});await render.promise;const text=await p.getTextContent();if(alive)setPageText(text.items.map(i=>'str' in i?i.str:'').join(' '));}catch(e){if(alive)setError(e instanceof Error?e.message:'Страница не отображается.');}finally{if(alive)setRendering(false);}})();
 return()=>{alive=false;render?.cancel();};},[pdf,reading?.page]);
 async function change(next:ReadingState){setBusy(true);setError('');setNotice('');try{const updated=await api.saveReading(next);setReading(updated);setNotice('Отметки сохранены.');onChanged();}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить отметки.');}finally{setBusy(false);}}
 async function refresh(){setBusy(true);setError('');try{const saved=await api.readingState(item.id),total=pages?.length||pdf?.numPages||saved.total_pages;const normalized={...saved,page:Math.max(1,Math.min(saved.page,total)),total_pages:total,bookmarks:saved.bookmarks.filter(p=>p<=total)};setReading(saved.total_pages===total?normalized:await api.saveReading(normalized));setNotice('Отметки обновлены.');}catch(e){setError(e instanceof Error?e.message:'Не удалось обновить отметки.');}finally{setBusy(false);}}
 const locked=busy||rendering;
 return <section className="reader" aria-label="Читалка">{error&&<div className="notice error" role="alert">{error}{(pages||pdf)&&<button disabled={busy} onClick={()=>void refresh()}>Обновить отметки</button>}</div>}{notice&&<p role="status">{notice}</p>}
 {busy&&!reading&&<p role="status">Открываем документ…</p>}
 {reading&&<><div className="reader-toolbar"><button disabled={locked} aria-pressed={reading.favorite} onClick={()=>void change({...reading,favorite:!reading.favorite})}>{reading.favorite?'Убрать из избранного':'В избранное'}</button><button disabled={locked||(!reading.bookmarks.includes(reading.page)&&reading.bookmarks.length>=100)} onClick={()=>void change({...reading,bookmarks:reading.bookmarks.includes(reading.page)?reading.bookmarks.filter(p=>p!==reading.page):[...reading.bookmarks,reading.page]})}>{reading.bookmarks.includes(reading.page)?'Убрать закладку':'Добавить закладку'}</button></div>
 <p>Страница {reading.page} из {reading.total_pages} · Прогресс: {Math.round(reading.page/reading.total_pages*100)}%</p><progress aria-label="Прогресс чтения" max={reading.total_pages} value={reading.page}/>
 <div className="reader-navigation"><button disabled={locked||reading.page<=1} onClick={()=>void change({...reading,page:reading.page-1})}>Предыдущая страница</button><form className="reader-jump" onSubmit={e=>{e.preventDefault();const p=Number(new FormData(e.currentTarget).get("page"));if(Number.isInteger(p)&&p>=1&&p<=reading.total_pages)void change({...reading,page:p});}}><label>Страница<input key={reading.page} name="page" type="number" min={1} max={reading.total_pages} defaultValue={reading.page} required disabled={locked}/></label><button disabled={locked}>Перейти к странице</button></form><button disabled={locked||reading.page>=reading.total_pages} onClick={()=>void change({...reading,page:reading.page+1})}>Следующая страница</button></div>
 <div className="reader-bookmarks"><h3>Закладки</h3>{reading.bookmarks.length?reading.bookmarks.map(p=><button disabled={locked} key={p} onClick={()=>void change({...reading,page:p})}>К странице {p}</button>):<p>Закладок пока нет.</p>}</div>
 {pages?<pre aria-label="Текст страницы">{pages[reading.page-1]}</pre>:<><canvas ref={canvas} aria-label={'PDF · страница '+reading.page}/>{rendering&&<p role="status">Отображаем страницу…</p>}{pageText&&<details><summary>Текст PDF-страницы</summary><p>{pageText}</p></details>}</>}
 </>}
 </section>;
}
