import JSZip from 'jszip';
import {textPages} from './reader-state';
export async function loadDocx(data:ArrayBuffer){
 const zip=await JSZip.loadAsync(data);
 const entries=Object.values(zip.files);
 const expanded=entries.reduce((sum,f)=>sum+((f as unknown as {_data?:{uncompressedSize:number}})._data?.uncompressedSize||0),0);
 if(entries.length>2000||expanded>40*1024*1024)throw Error('DOCX слишком большой для встроенной читалки. Скачайте его для открытия на устройстве.');
 if(!zip.file('word/document.xml'))throw Error('Этот файл не является документом DOCX.');
 const {default:mammoth}=await import('mammoth/mammoth.browser');
 const result=await mammoth.extractRawText({arrayBuffer:data});
 if(result.value.length>2000000)throw Error('В документе слишком много текста для встроенной читалки.');
 return textPages(result.value);
}
