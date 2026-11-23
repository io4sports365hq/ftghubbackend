'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {authorizeAssignedCapture}=require('../lib/scorekeeper-assignment-contract.cjs');
const valid={nowMs:1000,session:{operatorId:'op-1',expiresAtMs:2000},
 assignment:{operatorId:'op-1',active:true,expiresAtMs:2000,eventSlug:'event-one',gameNumber:'7',captureId:'capture-A'},
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
 ];
 for(const change of cases)assert.equal(authorizeAssignedCapture({...valid,...change}).allowed,false);
});
test('invalid clock throws instead of allowing access',()=>{
 assert.throws(()=>authorizeAssignedCapture({...valid,nowMs:NaN}),TypeError);
});
