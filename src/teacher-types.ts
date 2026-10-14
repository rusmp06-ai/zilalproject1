import type {Assignment,Course,Work} from './types';
export type TeacherCourse=Course&{group_name:string;can_grade:boolean;assignment_count:number|null;pending:number|null;drafts:number|null;students:number|null};
export type ReviewStatus='pending'|'draft'|'graded'|'returned'|'all';
export type ReviewRow={current_member?:boolean;id:string;assignment_id:string;student_id:string;student_name:string;status:string;attempt_no:number;submitted_at:string|null;is_late:boolean;review_version:number;score:number|null;released_at:string|null;assignment_title:string;max_score:number;course_id:string;course_title:string;group_name:string};
export type TeacherDetail={group_name?:string;assignment_snapshot?:boolean;work:Work&{review_version:number};assignment:Assignment;latest_id:string;can_review:boolean;history:{id:string;attempt_no:number;status:string;submitted_at:string|null}[];course_title:string};
export type RosterRow={student_id:string;student_name:string;work_id:string|null;status:string;attempt_no:number|null;submitted_at:string|null;is_late:boolean|null;score:number|null;released_at:string|null};
export type AssignmentInput={course:string;title:string;description:string;due:string|null;max:number;late:boolean;id:string|null;revision:number|null};
export const teacherStatus:Record<string,string>={not_submitted:'Не сдано',uploading:'Загрузка не завершена',deleting:'Удаление не завершено',submitted:'На проверке',returned:'На доработке',graded:'Оценка опубликована'};

export type ReviewEvent={id:string;actor_name:string;action:'draft'|'publish'|'return';score:number|null;previous_score:number|null;created_at:string};
