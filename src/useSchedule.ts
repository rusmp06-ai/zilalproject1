import {useEffect,useState} from 'react';
import type {Gateway,BoardItem} from './types';
import {loadSchedule} from './study-data';
import {saveSchedule,scheduleCopy,forgetSchedule} from './schedule-cache';
import type {ScheduleStatus} from './LessonNow';

const changeKey='studyhub-schedule-changed';
type State={events:BoardItem[];scheduleStatus:ScheduleStatus;scheduleSavedAt:string|null;scheduleStored:boolean;scheduleAllowed:boolean};
const initial=(group:string):State=>({events:[],scheduleStatus:group?'loading':'denied',scheduleSavedAt:null,scheduleStored:false,scheduleAllowed:!!group});

// Local edits notify mounted readers. Other devices are checked by polling/focus.
export function scheduleChanged(){
 window.dispatchEvent(new window.Event(changeKey));
 try{localStorage.setItem(changeKey,crypto.randomUUID());}catch{/* Storage is optional. */}
}

export function useSchedule(api:Gateway,user:string,group:string,name:string,from:string,to:string,revision:number,fallbackTo=to){
 const [signal,setSignal]=useState(0),[state,setState]=useState<State>(()=>initial(group));
 useEffect(()=>{
  if(!group)return;
  let queued=false,active=true;
  const refresh=()=>{
   if(document.visibilityState==='hidden'||queued)return;
   queued=true;
   queueMicrotask(()=>{queued=false;if(active)setSignal(n=>n+1);});
  };
  const network=()=>setSignal(n=>n+1);
  const storage=(e:StorageEvent)=>{if(e.key===changeKey)refresh();};
  const timer=setInterval(refresh,60000);
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('online',network);
  window.addEventListener('offline',network);
  window.addEventListener(changeKey,network);
  window.addEventListener('storage',storage);
  return()=>{
   active=false;clearInterval(timer);
   window.removeEventListener('focus',refresh);
   document.removeEventListener('visibilitychange',refresh);
   window.removeEventListener('online',network);
   window.removeEventListener('offline',network);
   window.removeEventListener(changeKey,network);
   window.removeEventListener('storage',storage);
  };
 },[group]);
 useEffect(()=>{
  let active=true;
  setState(initial(group));
  if(!group)return;
  void(async()=>{
   try{
    if(!navigator.onLine)throw Error('Offline');
    const p=await loadSchedule(api,group,from,to);
    if(!active)return;
    if(!p.canRead){
     forgetSchedule(user,group);
     setState({...initial(''),scheduleStatus:'denied'});
     return;
    }
    const savedAt=new Date().toISOString();
    const stored=saveSchedule(user,{groupId:group,groupName:name,from,to,savedAt,events:p.items});
    setState({events:p.items,scheduleStatus:'fresh',scheduleSavedAt:savedAt,scheduleStored:stored,scheduleAllowed:true});
   }catch{
    if(!active)return;
    const copy=scheduleCopy(user,group,from,fallbackTo);
    setState({events:copy?.events.filter(e=>e.ends_at!>from&&e.starts_at!<to)||[],scheduleStatus:copy?'saved':'error',scheduleSavedAt:copy?.savedAt||null,scheduleStored:!!copy,scheduleAllowed:true});
   }
  })();
  // A superseded group/date/request must not replace a newer result or cache.
  return()=>{active=false;};
 },[api,user,group,name,from,to,fallbackTo,revision,signal]);
 return state;
}
