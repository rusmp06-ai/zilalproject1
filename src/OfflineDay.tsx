import {useEffect,useRef,useState} from 'react';
import {savedSchedules} from './schedule-cache';
import {studyDate} from './lesson-day';
import {LessonNow} from './LessonNow';
import {LessonTimeline} from './LessonTimeline';
import {boardInstant} from './board-time';
export function OfflineDay({user}:{user:string}){
 const [now,setNow]=useState(Date.now),[group,setGroup]=useState(''),[revision,setRevision]=useState(0);const today=useRef<HTMLElement>(null);
 useEffect(()=>{const tick=()=>setNow(Date.now()),timer=setInterval(tick,15000);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[]);
 const day=studyDate(now),from=boardInstant(day+'T00:00'),to=new Date(Date.parse(from)+86400000).toISOString();
 const copies=savedSchedules(user).filter(c=>Date.parse(c.from)<=Date.parse(from)&&Date.parse(c.to)>=Date.parse(to)).sort((a,b)=>Date.parse(b.savedAt)-Date.parse(a.savedAt)),copy=copies.find(c=>c.groupId===group)||copies[0];
 return <section className="offline-day" aria-label="Сохранённое расписание"><h3>Расписание без интернета</h3><p>Только сохранённая копия этого аккаунта. Изменения и права доступа сейчас не проверены.</p>{copies.length>1&&<label>Сохранённая группа<select value={copy?.groupId||''} onChange={e=>setGroup(e.target.value)}>{copies.map(c=><option key={c.groupId} value={c.groupId}>{c.groupName}</option>)}</select></label>}{copy?<><p className="group-context">{copy.groupName}</p><LessonNow events={copy.events} now={now} status="saved" savedAt={copy.savedAt} onToday={()=>today.current?.scrollIntoView({behavior:'smooth',block:'start'})}/><section ref={today}><h3>Расписание сегодня</h3><LessonTimeline events={copy.events} now={now}/></section></>:<p>На сегодня нет сохранённого расписания. Откройте «Главная» с интернетом, чтобы сохранить его.</p>}<button onClick={()=>{setNow(Date.now());setRevision(revision+1);}}>Перечитать сохранённую копию</button></section>;
}
