import type {ReactNode} from 'react';
/** Consistent interface icons; the adjacent text supplies the accessible name. */
export function StudyIcon({name,className=''}:{name:string;className?:string}){
 const paths:Record<string,ReactNode>={
  book:<><path d="M12 7c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V6c-3-1-6-1-9 1Z"/><path d="M12 7v13M6 10h3m6 0h3"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h1m6 0h1"/></>,
  note:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 5h8m-8 5h4"/></>,
  sun:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  course:<><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="8" y="4" width="5" height="16" rx="1.5"/><path d="m15 5 4-1 3 15-4 1-3-15ZM3 8h10M3 16h10"/></>,
  next:<path d="M5 12h14m-5-5 5 5-5 5"/>,
  back:<path d="M19 12H5m5-5-5 5 5 5"/>,
  plus:<path d="M12 5v14M5 12h14"/>,
 };
 return <svg className={'study-icon '+className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]||paths.note}</svg>;
}
