import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoute,routeURL} from '../src/navigation';

test('course, assignment and book routes round trip without titles or user data',()=>{
 const base=new URL('https://study.example/?demo=1');
 for(const route of [{tab:'library',book:'book-123'},{tab:'groups',course:'g0c0',section:'assignment' as const,task:'task-123'},{tab:'groups',course:'g0c0',section:'notes' as const},{tab:'schedule'}]){
  const url=routeURL(route,base),read=readRoute(url);assert.equal(read.invalid,false);for(const [k,v] of Object.entries(route))assert.equal((read as any)[k],v);
 }
});

test('navigation preserves invitation and auth fragments, demo mode and unrelated parameters',()=>{
 for(const hash of ['#invite=opaque-token','#access_token=opaque-token&type=recovery']){
  const base=new URL('https://study.example/?demo=1&lang=ru'+hash),url=routeURL({tab:'notes'},base);
  assert.equal(url.hash,hash);assert.equal(url.searchParams.get('demo'),'1');assert.equal(url.searchParams.get('lang'),'ru');assert.equal(url.searchParams.get('view'),'notes');assert.equal(url.pathname,'/');
 }
});

test('malformed and ambiguous routes are unavailable rather than interpreted as another resource',()=>{
 for(const query of ['view=unknown','view=groups&course=../private','view=groups&course=g0c0&section=invalid','view=library&task=task','view=groups&course=g0c0&task=task','view=notes&book=book','view=library&view=groups','view=groups&course=g0c0&course=g1c1','section=notes','view=groups&course='+('x'.repeat(129))])assert.equal(readRoute(new URL('https://study.example/?'+query)).invalid,true,query);
});

test('returning to home clears only route fields',()=>{
 const url=routeURL({tab:'overview'},new URL('https://study.example/?demo=1&view=groups&course=g0c0&section=assignment&task=task#invite=token'));
 assert.equal(url.search,'?demo=1');assert.equal(url.hash,'#invite=token');assert.deepEqual(readRoute(url),{tab:'overview',course:undefined,section:undefined,task:undefined,book:undefined,invalid:false});
});
