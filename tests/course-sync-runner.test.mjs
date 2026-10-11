import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {checkCourseSync} from '../scripts/check-course-sync.mjs';

async function fixture(acceptStale=false){
 const user={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',email:'fixture@example.test',created_at:new Date().toISOString()},tokens=new Set();
 let reading=null,file=null,logouts=0,session=0,removed=false;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture'),chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),body=bytes.length&&req.headers['content-type']?.includes('json')?JSON.parse(bytes):{};
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/auth/v1/token'){
   const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
   const payload=Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,session_id:String(++session)})).toString('base64url');const token=header+'.'+payload+'.signature';tokens.add('Bearer '+token);
   return json({access_token:token,refresh_token:'fixture-refresh-'+session,expires_in:3600,token_type:'bearer',user});
  }
  if(!tokens.has(req.headers.authorization))return json({message:'Unauthorized'},401);
  if(url.pathname==='/auth/v1/user')return json(user);
  if(url.pathname==='/auth/v1/logout'){assert.equal(url.searchParams.get('scope'),'local');logouts++;res.writeHead(204);return res.end();}
  if(url.pathname==='/rest/v1/profiles')return json([{id:user.id}]);
  if(url.pathname==='/rest/v1/courses')return json([{id:'course',title:'Fixture course'}]);
  if(url.pathname==='/rest/v1/course_reader_states')return json(reading?[reading]:[]);
  if(url.pathname.includes('/storage/v1/object/')){
   if(req.method==='POST'){file=bytes;return json({Key:'fixture'});}
   if(req.method==='DELETE'){file=null;return json([]);}
   if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end(file);}
  }
  const rpc=url.pathname.split('/').at(-1);
  if(rpc==='manage_course_material')return json(true);
  if(rpc==='reserve_course_upload')return json([{item_id:'item',storage_path:'fixture/sync-check'}]);
  if(rpc==='publish_course_upload')return json(null);
  if(rpc==='course_reader_state')return json(reading?[reading]:[]);
  if(rpc==='save_course_reader_state'){
   if(!acceptStale&&body.p_version!==(reading?.version||0))return json({code:'P0001',message:'Reading state changed. Refresh before saving'},400);
   reading={item_id:'item',page:body.p_page,total_pages:body.p_total,favorite:false,bookmarks:body.p_bookmarks,version:(reading?.version||0)+1};return json(reading);
  }
  if(rpc==='begin_course_delete')return json('fixture/sync-check');
  if(rpc==='finish_course_delete'){assert.equal(file,null);reading=null;removed=true;return json(null);}
  return json({message:'Unexpected fixture request'},500);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {settings:{url:'http://127.0.0.1:'+server.address().port,key:'fixture-key',email:'fixture@example.test',password:'fixture-only'},state:()=>({removed,file,reading,logouts,session}),close:()=>new Promise(resolve=>server.close(resolve))};
}

test('live sync runner uses distinct sessions, transfers bytes/marks, rejects stale writes and removes fixture',async()=>{
 const f=await fixture();try{await checkCourseSync(f.settings,()=>{});assert.deepEqual(f.state(),{removed:true,file:null,reading:null,logouts:2,session:2});}finally{await f.close();}
});
test('live sync runner detects a server accepting stale writes and still cleans up only its test fixture',async()=>{
 const f=await fixture(true);try{await assert.rejects(()=>checkCourseSync(f.settings,()=>{}),/конфликт устаревшей версии/);assert.equal(f.state().removed,true);assert.equal(f.state().logouts,2);}finally{await f.close();}
});
