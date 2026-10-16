import {useEffect,useRef,useState} from 'react';
import {mayLeaveDrafts} from './drafts';
export const views=['overview','groups','library','schedule','calendar','search','offline','tasks','announcements','notes','profile','teaching','admin','journal'] as const;
export const courseSections=['overview','topics','materials','assignment','notes','announcements'] as const;
export type CourseSection=typeof courseSections[number];
export type Route={tab:string;course?:string;section?:CourseSection;task?:string;book?:string;invalid?:boolean};
const keys=['view','course','section','task','book'];
const validId=(v:string|null)=>!v||/^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function readRoute(url:URL):Route{
 const q=url.searchParams,tab=q.get('view')||'overview',course=q.get('course')||undefined,section=q.get('section')||undefined,task=q.get('task')||undefined,book=q.get('book')||undefined;
 const invalid=!views.includes(tab as any)||[course,task,book].some(v=>!validId(v||null))||!!section&&!courseSections.includes(section as any)||!!course&&tab!=='groups'||!!section&&!course||!!task&&(!course||section!=='assignment')||!!book&&tab!=='library'||keys.some(k=>q.getAll(k).length>1);
 return {tab,course,section:section as CourseSection|undefined,task,book,invalid};
}
export function routeURL(route:Route,url:URL){
 const next=new URL(url);for(const key of keys)next.searchParams.delete(key);
 if(route.tab!=='overview')next.searchParams.set('view',route.tab);
 if(route.course){next.searchParams.set('course',route.course);if(route.section&&route.section!=='overview')next.searchParams.set('section',route.section);if(route.task)next.searchParams.set('task',route.task);}
 if(route.book)next.searchParams.set('book',route.book);
 return next;
}
export function useAppRoute(){
 const [route,setRoute]=useState(()=>readRoute(new URL(location.href)));
 const current=useRef({url:location.href,index:Number.isInteger(history.state?.studyhubIndex)?history.state.studyhubIndex:0});
 const restoring=useRef(false);
 useEffect(()=>{
  history.replaceState({...history.state,studyhubIndex:current.current.index},'',location.href);
  const pop=()=>{
   if(restoring.current){restoring.current=false;return;}
   const next=Number.isInteger(history.state?.studyhubIndex)?history.state.studyhubIndex:null;
   if(!mayLeaveDrafts()){
    if(next!==null&&next!==current.current.index){restoring.current=true;history.go(current.current.index-next);}
    else history.pushState({studyhubIndex:current.current.index},'',current.current.url);
    return;
   }
   current.current={url:location.href,index:next??current.current.index+1};
   setRoute(readRoute(new URL(location.href)));
  };
  window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);
 },[]);
 // Callers run their draft guard before a programmatic transition; popstate guards itself.
 function go(next:Route,replace=false){
  if(restoring.current)return;
  const url=routeURL(next,new URL(location.href)).href;
  if(url===current.current.url)return;
  const index=current.current.index+(replace?0:1);
  history[replace?'replaceState':'pushState']({studyhubIndex:index},'',url);
  current.current={url,index};setRoute(readRoute(new URL(url)));
 }
 return {route,go};
}
