import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';

export function validDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1900||Number(value.slice(0,4))>2200)return false;
 const time=Date.parse(value+'T12:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
export const shortText=(value:string)=>value.length<=200;
export const oneOf=(...values:string[])=>(value:string)=>values.includes(value);

// Only display choices belong in the address: never drafts, file bytes or signed URLs.
// Replace avoids adding a history entry for every typed character.
export function useViewState<T extends string>(scope:string,key:string,fallback:T,valid:(value:string)=>boolean):[T,Dispatch<SetStateAction<T>>]{
 const read=()=>{
  const query=new URLSearchParams(location.search),values=query.getAll('ui_'+key);
  return (query.get('view')===scope&&values.length===1&&valid(values[0])?values[0]:fallback) as T;
 };
 const [value,setValue]=useState<T>(read),current=useRef(value);
 current.current=value;
 useEffect(()=>{
  const pop=()=>{const next=read();current.current=next;setValue(next);};
  window.addEventListener('popstate',pop);
  return()=>window.removeEventListener('popstate',pop);
 },[scope,key,fallback]);
 const update:Dispatch<SetStateAction<T>>=next=>{
  const value=typeof next==='function'?next(current.current):next;
  current.current=value;setValue(value);
  const url=new URL(location.href);
  if(url.searchParams.get('view')!==scope)return;
  if(value===fallback)url.searchParams.delete('ui_'+key);else url.searchParams.set('ui_'+key,value);
  if(url.href===location.href)return;
  history.replaceState(history.state,'',url);
  window.dispatchEvent(new window.Event('studyhub:view-state'));
 };
 return [value,update];
}
