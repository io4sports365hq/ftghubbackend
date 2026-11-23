'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {dispatchAuthorizedFixture}=require('../lib/scorekeeper-adapter-dispatch-fixture.cjs');
const session={operatorId:'op-1',verified:true,revoked:false,expiresAtMs:2000};
const assignment={operatorId:'op-1',verified:true,revoked:false,active:true,expiresAtMs:2000,eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'};
const binding={eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'};
test('every authorization failure prevents outbound fixture calls',async()=>{
 let outbound=0;
 const base={nowMs:1000,loadSession:async()=>session,loadAssignment:async()=>assignment,
  sendFixture:async()=>{outbound++;return {status:200};}};
 for(const request of [
  {method:'GET',csrfVerified:true,binding},
  {method:'POST',csrfVerified:false,binding},
  {method:'POST',csrfVerified:true,binding:{...binding,eventSlug:'other'}},
  {method:'POST',csrfVerified:true,binding:{...binding,captureId:'other'}}
 ]){
  const result=await dispatchAuthorizedFixture({...base,request});
  assert.notEqual(result.status,200);
 }
 const expired=await dispatchAuthorizedFixture({...base,
  request:{method:'POST',csrfVerified:true,binding},
  loadSession:async()=>({...session,expiresAtMs:1000})});
 assert.equal(expired.status,401);
 assert.equal(outbound,0);
});
test('only the trusted binding is sent after authorization',async()=>{
 const sent=[];
 const result=await dispatchAuthorizedFixture({
  request:{method:'POST',csrfVerified:true,binding},
  nowMs:1000,loadSession:async()=>session,loadAssignment:async()=>assignment,
  sendFixture:async b=>{sent.push(b);return {status:202};}
 });
 assert.deepEqual(result,{status:202});
 assert.deepEqual(sent,[binding]);
 assert.equal(Object.isFrozen(sent[0]),true);
});

test('identity store failures and revoked assignments cause zero outbound calls',async()=>{
 let outbound=0;
 const request={method:'POST',csrfVerified:true,binding};
 const sendFixture=async()=>{outbound++;return {status:200};};
 const cases=[
  {loadSession:async()=>{throw Error('offline');},loadAssignment:async()=>assignment},
  {loadSession:async()=>session,loadAssignment:async()=>{throw Error('offline');}},
  {loadSession:async()=>session,loadAssignment:async()=>({...assignment,revoked:true})},
  {loadSession:async()=>session,loadAssignment:async()=>({...assignment,verified:false})}
 ];
 for(const deps of cases){
  const result=await dispatchAuthorizedFixture({request,nowMs:1000,sendFixture,...deps});
  assert.notEqual(result.status,200);
 }
 assert.equal(outbound,0);
});
