'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {authorizeAssignedCapture}=require('../lib/scorekeeper-assignment-contract.cjs');
const valid={nowMs:1000,session:{operatorId:'op-1',verified:true,expiresAtMs:2000,revoked:false},
 assignment:{operatorId:'op-1',active:true,verified:true,revoked:false,expiresAtMs:2000,eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'},
 request:{eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'}};
test('server-side assignment permits only exact binding',()=>{
 assert.deepEqual(authorizeAssignedCapture(valid),{allowed:true,binding:{eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'}});
});
test('missing, expired, revoked, or mismatched records fail closed',()=>{
 const cases=[
  {session:null},{assignment:null},{request:null},
  {session:{...valid.session,expiresAtMs:1000}},
  {session:{...valid.session,revoked:true}},
  {assignment:{...valid.assignment,expiresAtMs:1000}},
  {assignment:{...valid.assignment,revoked:true}},
  {assignment:{...valid.assignment,active:false}},
  {assignment:{...valid.assignment,operatorId:'other'}},
  {request:{...valid.request,eventSlug:'other'}},
  {request:{...valid.request,gameNumber:'8'}},
  {request:{...valid.request,captureId:'capture-B'}},
  {session:{...valid.session,operatorId:''}},
  {session:{...valid.session,revoked:undefined}},
  {session:{...valid.session,verified:undefined}},
  {assignment:{...valid.assignment,verified:undefined}},
  {session:{...valid.session,verified:false}},
  {assignment:{...valid.assignment,revoked:undefined}},
  {session:{...valid.session,expiresAtMs:undefined}},
  {session:{...valid.session,expiresAtMs:-1}},
  {assignment:{...valid.assignment,expiresAtMs:-1}},
  {assignment:{...valid.assignment,eventSlug:'UPPERCASE'}},
  {assignment:{...valid.assignment,gameNumber:'07'}},
  {assignment:{...valid.assignment,captureId:'bad capture'}},
  {request:{...valid.request,gameNumber:'07'}},
  {assignment:{...valid.assignment,expiresAtMs:undefined}},
 ];
 for(const change of cases)assert.equal(authorizeAssignedCapture({...valid,...change}).allowed,false);
});
test('invalid clock throws instead of allowing access',()=>{
 assert.throws(()=>authorizeAssignedCapture({...valid,nowMs:NaN}),TypeError);
});
