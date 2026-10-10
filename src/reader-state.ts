import type {ReadingState} from './types';
export function emptyReading(item:string):ReadingState{return {item_id:item,page:1,total_pages:0,favorite:false,bookmarks:[],version:0};}
export function validateReading(s:ReadingState){
 if(!Number.isInteger(s.page)||s.page<1||s.page>100000||!Number.isInteger(s.total_pages)||s.total_pages<0||s.total_pages>100000||(!s.total_pages&&s.page!==1)||(s.total_pages>0&&s.page>s.total_pages)||typeof s.favorite!=='boolean'||!Number.isInteger(s.version)||s.version<0||!Array.isArray(s.bookmarks)||s.bookmarks.length>100||s.bookmarks.some(p=>!Number.isInteger(p)||p<1||p>s.total_pages))throw Error('Проверьте страницу и закладки.');
}
// Stable 4000-code-point pages preserve Unicode characters and exact text.
export function textPages(text:string){const chars=Array.from(text),pages:string[]=[];for(let i=0;i<chars.length;i+=4000)pages.push(chars.slice(i,i+4000).join(''));return pages.length?pages:[''];}
