export type IntakeKind='lecture'|'presentation'|'material'|'assignment'|'book';
export type IntakeCourse={id:string;title:string;group_id:string;group_name:string;kinds:IntakeKind[]};
export type IntakeContext={courses:IntakeCourse[];groups:{id:string;name:string}[]};
export type AnalysisInput={name:string;mime:string;data?:string;text?:string;excerpted:boolean;scopeCourse:string|null;scopeGroup:string|null};
export type MaterialAnalysis={kind:IntakeKind|'unknown';title:string;course_id:string|null;topic:string;description:string;confidence:'high'|'medium'|'low';reason:string;evidence:string[];excerpted:boolean;demo?:boolean};
export type IntakePublication={request:string;kind:IntakeKind;course:string|null;group:string|null;title:string;description:string;due:string|null;max:number;late:boolean};
export type IntakeReservation={item_id:string;path:string;bucket:'studyhub-library'|'studyhub-courses';published:boolean;result_id:string|null};
