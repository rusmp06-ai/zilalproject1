import {createMaterialHandler} from './handler.ts';
const assert=(ok:unknown,message='assertion failed')=>{if(!ok)throw Error(message);};
const course={id:'allowed-course',title:'Economics',group_id:'g',group_name:'Group',kinds:['lecture']};
const config={url:'https://test.supabase.co',anonKey:'test-anon',key:'test-gemini-key'};
const good={kind:'lecture',title:'Demand',course_id:course.id,topic:'Demand',description:'Study supply and demand',confidence:'high',reason:'Lecture heading',evidence:['Lecture 1']};
function harness(options:{auth?:boolean;quota?:boolean;provider?:number;model?:unknown;finish?:string;context?:boolean}={}){
 let calls=0,charges=0;const fetcher:typeof fetch=async(url,init)=>{
  const address=String(url);if(address.includes('/auth/v1/user'))return Response.json(options.auth===false?{message:'Invalid token'}:{id:'teacher',aud:'authenticated',email:'test@example.test'}, {status:options.auth===false?401:200});
  if(address.includes('/rest/v1/rpc/material_intake_context'))return Response.json(options.context===false?{message:'Publisher required'}:{courses:[course],groups:[{id:'g',name:'Group'}]},{status:options.context===false?403:200});
  if(address.includes('/rest/v1/rpc/begin_material_analysis')){charges++;return Response.json(options.quota===false?{message:'quota'}:null,{status:options.quota===false?400:200});}
  if(address.includes('generativelanguage.googleapis.com')){calls++;assert(new Headers(init?.headers).get('x-goog-api-key')===config.key);assert(!address.includes(config.key));const body=JSON.parse(String(init?.body));assert(body.systemInstruction.parts[0].text.includes('недоверенные'));assert(body.generationConfig.responseMimeType==='application/json');return Response.json({candidates:[{finishReason:options.finish||'STOP',content:{parts:[{text:JSON.stringify(options.model||good)}]}}]},{status:options.provider||200});}
  throw Error('Unexpected network '+address);
 };
 return {handle:createMaterialHandler(config,fetcher),counts:()=>({calls,charges})};
}
function request(overrides:Record<string,unknown>={},token=true){return new Request('https://example.test/material-analyze',{method:'POST',headers:token?{authorization:'Bearer test-token'}:{},body:JSON.stringify({name:'lecture.txt',mime:'text/plain',text:'Lecture 1. Demand',excerpted:false,scopeCourse:null,scopeGroup:null,...overrides})});}
Deno.test('authenticated classification returns bounded suggestion without publishing',async()=>{const h=harness();const r=await h.handle(request());assert(r.status===200);const a=await r.json();assert(a.title==='Demand'&&a.course_id===course.id);assert(h.counts().calls===1&&h.counts().charges===1);assert(r.headers.get('Cache-Control')==='no-store');});
Deno.test('missing authentication, student scope and malformed payload never call Gemini',async()=>{for(const [options,req,status] of [[{},request({},false),401],[{auth:false},request(),401],[{context:false},request(),403],[{},request({text:'x'.repeat(100001)}),400],[{},request({scopeCourse:'forbidden'}),403]] as const){const h=harness(options);assert((await h.handle(req)).status===status);assert(h.counts().calls===0);}});
Deno.test('server quota and provider outage are explicit and do not expose keys',async()=>{for(const o of [{quota:false},{provider:429},{provider:503}]){const h=harness(o);const r=await h.handle(request());assert(r.status===429||r.status===502);assert(!(await r.text()).includes(config.key));if(o.quota===false)assert(h.counts().calls===0);}});
Deno.test('invented course ids cannot become publication targets',async()=>{const h=harness({model:{...good,course_id:'forbidden'}});const r=await h.handle(request());assert(r.status===200);assert((await r.json()).course_id===null);});
Deno.test('invalid model output or incomplete response is rejected',async()=>{for(const o of [{model:{...good,title:'x'.repeat(201)}},{model:{...good,kind:'execute_sql'}},{finish:'MAX_TOKENS'}]){const h=harness(o);assert((await h.handle(request())).status===422);}});
Deno.test('missing server key leaves a clear setup message',async()=>{const handle=createMaterialHandler({...config,key:undefined});const r=await handle(request());assert(r.status===503);assert((await r.json()).error.includes('настроить Gemini'));});
