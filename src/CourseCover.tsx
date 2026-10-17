import {StudyIcon} from './StudyIcon';
import type {Course} from './types';
export function CourseCover({course,groupName,teacher,busy,onRefresh}:{course:Course;groupName:string;teacher:boolean;busy:boolean;onRefresh:()=>void}){
 const theme=['ocean','slate','copper'][[...course.id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%3];
 return <header className={'course-hero course-cover cover-'+theme}>
 <div className="course-cover-copy"><div className="eyebrow">ДИСЦИПЛИНА{groupName?' · '+groupName:''}</div><h2>{course.title}</h2><p>{teacher?'Ваше пространство для занятий с группой':'Ваше пространство для изучения предмета'}</p><span className="course-cover-signature"><StudyIcon name="book"/>Материалы · Практика · Знания</span></div>
 <svg className="course-cover-art" viewBox="0 0 250 180" fill="none" aria-hidden="true"><circle cx="143" cy="85" r="72" fill="currentColor" opacity=".07"/><circle cx="143" cy="85" r="51" stroke="currentColor" opacity=".14"/><path d="M30 147h191" stroke="currentColor" strokeWidth="2" opacity=".2"/><rect x="58" y="52" width="46" height="94" rx="7" fill="currentColor" opacity=".85"/><path d="M68 67h25M68 74h17M68 129h25" stroke="white" strokeWidth="2" opacity=".65"/><rect x="110" y="32" width="37" height="114" rx="7" fill="currentColor" opacity=".48"/><path d="M119 47h19M119 53h19M119 130h19" stroke="white" strokeWidth="2" opacity=".8"/><g transform="rotate(-13 179 145)"><rect x="155" y="65" width="38" height="82" rx="7" fill="currentColor" opacity=".25"/><path d="M165 78h18M165 84h12M165 133h18" stroke="currentColor" strokeWidth="2" opacity=".45"/></g><circle cx="47" cy="39" r="5" fill="currentColor" opacity=".2"/><path d="M205 35v14m-7-7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".3"/></svg>
 <button className="course-refresh" aria-label="Обновить дисциплину" title="Обновить дисциплину" disabled={busy} onClick={onRefresh}><StudyIcon name="refresh"/><span>Обновить</span></button>
 </header>;
}
