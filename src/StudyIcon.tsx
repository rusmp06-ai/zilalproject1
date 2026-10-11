import type {ReactNode} from 'react';
/** Rounded, decorative icons; the adjacent text supplies the accessible name. */
export function StudyIcon({name,className=''}:{name:string;className?:string}){
 const paths:Record<string,ReactNode>={
  book:<><path d="M12 7c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V6c-3-1-6-1-9 1Z"/><path d="M12 7v13M6 10h3m6 0h3"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h1m6 0h1"/></>,
  note:<><rect x="4" y="3" width="16" height="18" rx="4"/><path d="M8 8h8m-8 5h8m-8 5h4"/></>,
  sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v1m0 18v1M2 12h1m18 0h1M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>,
  course:<><path d="m3 9 9-5 9 5-9 5-9-5Zm3 3v5c4 3 8 3 12 0v-5m3-3v8"/></>,
  next:<path d="M5 12h14m-5-5 5 5-5 5"/>,
  back:<path d="M19 12H5m5-5-5 5 5 5"/>,
  plus:<path d="M12 5v14M5 12h14"/>,
 };
 return <svg className={'study-icon '+className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]||paths.note}</svg>;
}
