import {bishkekInput} from './board-time';
import type {BoardItem} from './types';
export const studyDate=(time:number)=>bishkekInput(new Date(time).toISOString()).slice(0,10);
export const lessonTime=(iso:string)=>new Date(iso).toLocaleTimeString('ru-RU',{timeZone:'Asia/Bishkek',hour:'2-digit',minute:'2-digit'});
export function lessonDay(events:BoardItem[],now:number){
 const sorted=events.filter(e=>e.starts_at&&e.ends_at&&Number.isFinite(Date.parse(e.starts_at))&&Date.parse(e.ends_at)>Date.parse(e.starts_at)).sort((a,b)=>Date.parse(a.starts_at!)-Date.parse(b.starts_at!)||a.id.localeCompare(b.id));
 const current=sorted.filter(e=>Date.parse(e.starts_at!)<=now&&Date.parse(e.ends_at!)>now),next=sorted.find(e=>Date.parse(e.starts_at!)>now)||null;
 const today=sorted.filter(e=>studyDate(Date.parse(e.starts_at!))===studyDate(now)||Date.parse(e.starts_at!)<now&&Date.parse(e.ends_at!)>now);
 return {current:current[0]||null,overlap:current.length>1,next,today,past:today.filter(e=>Date.parse(e.ends_at!)<=now),remaining:today.filter(e=>Date.parse(e.ends_at!)>now)};
}
export function lessonCountdown(e:BoardItem,now:number){
 const start=Date.parse(e.starts_at!),end=Date.parse(e.ends_at!);if(now>=end)return 'Пара завершена';
 if(now>=start){const minutes=Math.floor((now-start)/60000);return minutes?'Пара идёт '+duration(minutes):'Пара только началась';}
 const gap=start-now;if(gap<60000)return 'Начнётся меньше чем через минуту';return 'Начнётся через '+duration(Math.ceil(gap/60000));
}
function duration(minutes:number){const hours=Math.floor(minutes/60),rest=minutes%60;return hours?hours+' ч'+(rest?' '+rest+' мин':''):minutes+' мин';}
