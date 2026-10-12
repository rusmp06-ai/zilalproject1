import {useEffect,useState} from 'react';
import type {Gateway} from './types';
export type NotificationCounts={user_id:string;announcements:number;overdue:number};
export const notificationEvent='studyhub-notifications-changed';
export function notifyChanged(){if(typeof window!=='undefined')window.dispatchEvent(new window.Event(notificationEvent));}
export function isOverdue(due:string|null,status:string|undefined,now:number){return !!due&&Number.isFinite(Date.parse(due))&&Date.parse(due)<now&&['not_submitted','returned','uploading','deleting'].includes(status||'');}
export function NotificationBell({count,title}:{count:number;title:string}){if(count<=0)return null;return <span className="notification-bell" aria-hidden="true" title={title}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" focusable="false"><path d="M12 2a2 2 0 0 1 2 2v.3a6 6 0 0 1 4 5.7v4l1.8 3a1.3 1.3 0 0 1-1.1 2H5.3a1.3 1.3 0 0 1-1.1-2L6 14v-4a6 6 0 0 1 4-5.7V4a2 2 0 0 1 2-2Zm-2.7 19h5.4a3 3 0 0 1-5.4 0Z"/></svg><b>{count>99?'99+':count}</b></span>;}
export function useNotifications(api:Gateway,user:string|null,section:string){
 const [value,setValue]=useState<NotificationCounts|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true,running=false,again=false;setValue(null);setError('');if(!user)return;
 async function load(){if(!active||document.visibilityState==='hidden')return;if(!navigator.onLine){setValue(null);setError('');return;}if(running){again=true;return;}running=true;try{const next=await api.notificationCounts();if(active&&navigator.onLine&&next.user_id===user){setValue(next);setError('');}}catch(e){if(active&&navigator.onLine){setValue(null);setError((e as {code?:string}).code==='PGRST202'?'Уведомления станут доступны после обновления базы v0.27.':'Не удалось обновить уведомления.');}}finally{running=false;if(again&&active){again=false;void load();}}}
 const offline=()=>{setValue(null);setError('');};void load();const timer=window.setInterval(()=>void load(),60000);const refresh=()=>void load();for(const event of [notificationEvent,'focus','online'])window.addEventListener(event,refresh);window.addEventListener('offline',offline);document.addEventListener('visibilitychange',refresh);return()=>{active=false;window.clearInterval(timer);for(const event of [notificationEvent,'focus','online'])window.removeEventListener(event,refresh);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',refresh);};
 },[api,user,section]);return {counts:value?.user_id===user?value:null,error};
}
