'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {authorizeAdapterRequest}=require('../lib/scorekeeper-adapter-gate.cjs');
const session={operatorId:'op-1',verified:true,revoked:false,expiresAtMs:2000};
const assignment={operatorId:'op-1',verified:true,revoked:false,active:true,expiresAtMs:2000,eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'};
const request={method:'POST',csrfVerified:true,binding:{eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'}};
test('adapter gate loads trusted identity and returns immutable binding',async()=>{
 const calls=[];
 const result=await authorizeAdapterRequest({request,nowMs:1000,
  loadSession:async()=>{calls.push('session');return session;},
  loadAssignment:async id=>{calls.push(id);return assignment;}});
 assert.deepEqual(calls,['session','op-1']);
 assert.deepEqual(result,{status:200,binding:{eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'}});
 assert.equal(Object.isFrozen(result.binding),true);
});
test('method and CSRF failures perform zero identity lookups',async()=>{
 let calls=0;
 const deps={nowMs:1000,loadSession:async()=>{calls++;return session;},
  loadAssignment:async()=>{calls++;return assignment;}};
 assert.equal((await authorizeAdapterRequest({...deps,request:{...request,method:'GET'}})).status,405);
 assert.equal((await authorizeAdapterRequest({...deps,request:{...request,csrfVerified:false}})).status,403);
 assert.equal(calls,0);
});
test('expired or unverified sessions never fetch assignments',async()=>{
 let calls=0;
 for(const s of [{...session,expiresAtMs:1000},{...session,verified:false},null]){
  const result=await authorizeAdapterRequest({request,nowMs:1000,
   loadSession:async()=>s,loadAssignment:async()=>{calls++;return assignment;}});
  assert.equal(result.status,401);
 }
 assert.equal(calls,0);
});
test('unavailable identity stores fail closed without allowing publish',async()=>{
 const fail=async()=>{throw Error('storage offline');};
 assert.equal((await authorizeAdapterRequest({request,nowMs:1000,loadSession:fail,loadAssignment:async()=>assignment})).status,503);
 assert.equal((await authorizeAdapterRequest({request,nowMs:1000,loadSession:async()=>session,loadAssignment:fail})).status,503);
});
test('wrong capture is denied after authoritative assignment lookup',async()=>{
 const result=await authorizeAdapterRequest({request:{...request,binding:{...request.binding,captureId:'capture-B'}},
 nowMs:1000,loadSession:async()=>session,loadAssignment:async()=>assignment});
 assert.deepEqual(result,{status:403,reason:'capture_mismatch'});
});

test('invalid clock rejects before any identity store access',async()=>{
 let calls=0;
 for(const nowMs of [undefined,NaN,-1,1.5]){
  const result=await authorizeAdapterRequest({request,nowMs,
   loadSession:async()=>{calls++;return session;},
   loadAssignment:async()=>{calls++;return assignment;}});
  assert.deepEqual(result,{status:503,reason:'clock_unavailable'});
 }
 assert.equal(calls,0);
});

test('revoked and malformed sessions never query assignments',async()=>{
 let assignmentCalls=0;
 for(const s of [
  {...session,revoked:true},
  {...session,revoked:undefined},
  {...session,expiresAtMs:undefined},
  {...session,expiresAtMs:-1},
  {...session,operatorId:''}
 ]){
  const result=await authorizeAdapterRequest({request,nowMs:1000,
   loadSession:async()=>s,
   loadAssignment:async()=>{assignmentCalls++;return assignment;}});
  assert.notEqual(result.status,200);
 }
 assert.equal(assignmentCalls,0);
});

test('assignment failures cannot authorize a different event or game',async()=>{
 for(const binding of [
  {...request.binding,eventSlug:'event-two'},
  {...request.binding,gameNumber:'8'},
  {...request.binding,captureId:'capture-B'}
 ]){
  const result=await authorizeAdapterRequest({request:{...request,binding},nowMs:1000,
   loadSession:async()=>session,loadAssignment:async()=>assignment});
  assert.deepEqual(result,{status:403,reason:'capture_mismatch'});
 }
});
test('unverified and revoked assignments fail closed',async()=>{
 for(const a of [
  {...assignment,verified:false},
  {...assignment,revoked:true},
  {...assignment,active:false},
  {...assignment,expiresAtMs:1000}
 ]){
  const result=await authorizeAdapterRequest({request,nowMs:1000,
   loadSession:async()=>session,loadAssignment:async()=>a});
  assert.equal(result.status,403);
 }
});

test('authorization requires trusted provider functions, never browser identity',async()=>{
 const request={method:'POST',csrfVerified:true,binding:{eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'}};
 await assert.rejects(authorizeAdapterRequest({request,nowMs:1000,
  loadSession:null,loadAssignment:async()=>assignment}),TypeError);
 await assert.rejects(authorizeAdapterRequest({request,nowMs:1000,
  loadSession:async()=>session,loadAssignment:null}),TypeError);
});

test('authorization provider errors do not reveal internal exception text',async()=>{
 const request={method:'POST',csrfVerified:true,binding:{eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'}};
 const secretError=async()=>{throw Error('database secret token=PRIVATE');};
 const failures=[
  {loadSession:secretError,loadAssignment:async()=>assignment},
  {loadSession:async()=>session,loadAssignment:secretError}
 ];
 for(const providers of failures){
  const result=await authorizeAdapterRequest({request,nowMs:1000,...providers});
  assert.equal(result.status,503);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 }
});
