import type {Note} from './types';
export type ReaderPreferences={theme:'light'|'sepia'|'dark';fontSize:number;lineHeight:number;zoom:number};
export const defaultPreferences:ReaderPreferences={theme:'light',fontSize:20,lineHeight:1.8,zoom:100};
export function readerPreferences(value:unknown):ReaderPreferences{
 const v=value&&typeof value==='object'?value as Partial<ReaderPreferences>:{};
 const number=(n:unknown,min:number,max:number,fallback:number)=>typeof n==='number'&&Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
 return {theme:v.theme==='sepia'||v.theme==='dark'?v.theme:'light',fontSize:number(v.fontSize,16,32,20),lineHeight:number(v.lineHeight,1.4,2.2,1.8),zoom:number(v.zoom,50,200,100)};
}
export type ReaderNote={sourceId:string;sourceTitle:string;page:number;quote:string;text:string};
export function encodeReaderNote(note:ReaderNote){return JSON.stringify({studyhub_reader_note:1,...note});}
export function decodeReaderNote(body:string):ReaderNote|null{
 try{const v=JSON.parse(body);if(v.studyhub_reader_note!==1||typeof v.sourceId!=='string'||!v.sourceId||typeof v.sourceTitle!=='string'||!Number.isInteger(v.page)||v.page<1||typeof v.quote!=='string'||typeof v.text!=='string')return null;
 return {sourceId:v.sourceId,sourceTitle:v.sourceTitle,page:v.page,quote:v.quote,text:v.text};}catch{return null;}
}
export function noteText(note:Note){return decodeReaderNote(note.body)?.text??note.body;}
export type ReaderHeading={title:string;page:number;level:number};
export function textOutline(pages:string[]):ReaderHeading[]{
 const entries:ReaderHeading[]=[];
 pages.forEach((text,i)=>{for(const line of text.split('\n')){const title=line.trim();if(title.length>2&&title.length<=120&&/^(#{1,3}\s|(?:глава|раздел|часть|лекция|тема)\s|\d+(?:\.\d+){0,2}[.)]?\s+\p{L})/iu.test(title))entries.push({title:title.replace(/^#+\s*/,''),page:i+1,level:title.startsWith('##')?2:1});}});
 return entries.slice(0,300);
}
export function findText(pages:string[],query:string){const q=query.trim().toLocaleLowerCase();if(!q)return [];
 const result:{page:number;snippet:string}[]=[];
 for(let i=0;i<pages.length;i++){const lower=pages[i].toLocaleLowerCase(),at=lower.indexOf(q);if(at>=0)result.push({page:i+1,snippet:pages[i].slice(Math.max(0,at-55),at+q.length+100)});if(result.length===100)break;}
 return result;
}
export const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const canReadDocument=(mime:string)=>['application/pdf','text/plain',DOCX_MIME].includes(mime);

export function highlightedText(text:string,query:string){
 const q=query.trim().toLocaleLowerCase();if(!q)return [{text,match:false}];
 const lower=text.toLocaleLowerCase(),parts:{text:string;match:boolean}[]=[];let start=0,count=0,at=lower.indexOf(q);
 while(at>=0&&count<200){if(at>start)parts.push({text:text.slice(start,at),match:false});parts.push({text:text.slice(at,at+q.length),match:true});start=at+q.length;count++;at=lower.indexOf(q,start);}
 if(start<text.length)parts.push({text:text.slice(start),match:false});return parts;
}
