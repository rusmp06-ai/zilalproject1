export const weekdays=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
export const weekdayShort=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
export type WeeklySlot={id:string;course_id:string;start_time:string;end_time:string;location:string};
export type WeeklyDay={items:WeeklySlot[];version:number};
export type ScheduleException={slot:string;date:string;cancelled:boolean;course:string;start:string;end:string;location:string;version:number};
export function validateSlots(items:WeeklySlot[]){
 if(items.length>24)throw Error('В одном дне может быть не больше 24 пар.');
 const sorted=[...items].sort((a,b)=>a.start_time.localeCompare(b.start_time));
 for(let i=0;i<sorted.length;i++){const s=sorted[i];if(!s.course_id||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end_time)||s.end_time<=s.start_time)throw Error('Выберите дисциплину и укажите начало раньше окончания.');if(s.location.length>200)throw Error('Сократите название аудитории до 200 символов.');if(i&&sorted[i-1].end_time>s.start_time)throw Error('Время пар пересекается. Исправьте начало или окончание.');}
 if(new Set(items.map(s=>s.id)).size!==items.length)throw Error('Повторяющаяся пара. Обновите расписание.');return sorted;
}
