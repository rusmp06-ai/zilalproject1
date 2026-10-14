import {PDFDocument,PDFDict,PDFName,PDFRawStream} from 'pdf-lib';
export async function repackPdf(bytes:Uint8Array):Promise<Uint8Array>{
 const doc=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
 if(doc.isEncrypted)throw Error('protected');
 if(doc.getPageCount()>40)throw Error('limit');
 const unsupported=['AcroForm','ByteRange','Sig','JavaScript','JS','EmbeddedFiles','Collection','StructTreeRoot','OCProperties'];
 for(const [,object] of doc.context.enumerateIndirectObjects()){
  const dict=object instanceof PDFDict?object:object instanceof PDFRawStream?object.dict:null;
  if(dict&&(unsupported.some(k=>dict.has(PDFName.of(k)))||dict.get(PDFName.of('Type'))?.toString()==='/Sig'||dict.get(PDFName.of('FT'))?.toString()==='/Sig'))throw Error('interactive');
 }
 if(doc.getPages().some(p=>p.node.Annots()?.size()))throw Error('interactive');
 const next=await doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false});
 const check=await PDFDocument.load(next,{updateMetadata:false,throwOnInvalidObject:true});
 // Stream bytes include original images, fonts, page commands and metadata. Never recompress them.
 for(const [ref,object] of doc.context.enumerateIndirectObjects()){
  const other=check.context.lookup(ref);
  if(object instanceof PDFRawStream){
   if(!(other instanceof PDFRawStream)||object.dict.toString()!==other.dict.toString()||!equalBytes(object.contents,other.contents))throw Error('verification');
  }else if(!other||object.toString()!==other.toString())throw Error('verification');
 }
 return next;
}
export function equalBytes(a:Uint8Array|Uint8ClampedArray,b:Uint8Array|Uint8ClampedArray){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
