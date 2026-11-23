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

test('browser-supplied identity overrides never reach fixture transport',async()=>{
 const sent=[];
 const forged={method:'POST',csrfVerified:true,binding,
  operatorId:'attacker',eventSlug:'other-event',gameNumber:'99',captureId:'other-capture',
  hubPublishToken:'browser-secret'};
 const result=await dispatchAuthorizedFixture({
  request:forged,nowMs:1000,
  loadSession:async()=>session,loadAssignment:async()=>assignment,
  sendFixture:async authorized=>{sent.push(authorized);return {status:202};}
 });
 assert.equal(result.status,202);
 assert.deepEqual(sent,[binding]);
 for(const key of ['operatorId','hubPublishToken'])assert.equal(Object.hasOwn(sent[0],key),false);
});
test('missing binding never dispatches outbound publishing',async()=>{
 let outbound=0;
 const result=await dispatchAuthorizedFixture({
  request:{method:'POST',csrfVerified:true},nowMs:1000,
  loadSession:async()=>session,loadAssignment:async()=>assignment,
  sendFixture:async()=>{outbound++;return {status:200};}
 });
 assert.equal(result.status,403);
 assert.equal(outbound,0);
});

test('upstream transport errors are redacted and never imply successful publish',async()=>{
 const request={method:'POST',csrfVerified:true,binding};
 for(const error of [new Error('token=SECRET private payload'),new Error('connection timed out')]){
  const result=await dispatchAuthorizedFixture({request,nowMs:1000,
   loadSession:async()=>session,loadAssignment:async()=>assignment,
   sendFixture:async()=>{throw error;}});
  assert.deepEqual(result,{status:503,reason:'publish_transport_unavailable'});
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
 }
});

test('missing transport is rejected only after authorization, with no fallback',async()=>{
 const request={method:'POST',csrfVerified:true,binding};
 await assert.rejects(dispatchAuthorizedFixture({
  request,nowMs:1000,loadSession:async()=>session,loadAssignment:async()=>assignment
 }),TypeError);
 const rejected=await dispatchAuthorizedFixture({
  request:{...request,csrfVerified:false},nowMs:1000,
  loadSession:async()=>{throw Error('must not load');},
  loadAssignment:async()=>{throw Error('must not load');}
 });
 assert.equal(rejected.status,403);
});

test('failed authorization never resolves or executes the outbound transport',async()=>{
 let invoked=0;
 const sendFixture=async()=>{invoked++;return {status:200};};
 for(const request of [
  {method:'POST',csrfVerified:false,binding},
  {method:'DELETE',csrfVerified:true,binding},
  {method:'POST',csrfVerified:true,binding:{...binding,gameNumber:'8'}}
 ]){
  const result=await dispatchAuthorizedFixture({request,nowMs:1000,
   loadSession:async()=>session,loadAssignment:async()=>assignment,sendFixture});
  assert.notEqual(result.status,200);
 }
 assert.equal(invoked,0);
});

test('session expiry at exact boundary blocks outbound publishing',async()=>{
 let outbound=0;
 for(const nowMs of [2000,2001]){
  const result=await dispatchAuthorizedFixture({
   request:{method:'POST',csrfVerified:true,binding},nowMs,
   loadSession:async()=>session,loadAssignment:async()=>assignment,
   sendFixture:async()=>{outbound++;return {status:200};}
  });
  assert.equal(result.status,401);
 }
 assert.equal(outbound,0);
});
test('missing CSRF verification blocks outbound publishing',async()=>{
 let outbound=0;
 const result=await dispatchAuthorizedFixture({
  request:{method:'POST',binding},nowMs:1000,
  loadSession:async()=>session,loadAssignment:async()=>assignment,
  sendFixture:async()=>{outbound++;return {status:200};}
 });
 assert.deepEqual(result,{status:403,reason:'csrf'});
 assert.equal(outbound,0);
});
