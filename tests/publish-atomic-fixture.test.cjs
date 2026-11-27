'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {commitAtomicPublish}=require('../lib/publish-atomic-fixture.cjs');
const valid={eventId:1,gameNumber:'1',captureId:'capture-A',expectedRevision:0,
 idempotencyKey:'key-A',payloadDigest:'a'.repeat(64),score:10,points:10,
 receiptId:'11111111-1111-4111-8111-111111111111'};
test('invalid inputs never start a database transaction',async()=>{
 const calls=[];const client={query:async(...args)=>{calls.push(args);throw Error('must not query');}};
 for(const change of [
  {eventId:0},{gameNumber:'1; DROP TABLE games'},{captureId:'bad capture'},
  {idempotencyKey:'bad key'},{payloadDigest:'not-a-digest'},
  {expectedRevision:-1},{score:-1},{points:1.5},{receiptId:'invalid'},{receiptId:'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'},
  {receiptId:'11111111-1111-1111-1111-111111111111'}
 ]){
  await assert.rejects(commitAtomicPublish(client,{...valid,...change}),TypeError);
 }
 assert.equal(calls.length,0);
});
test('database failures are propagated after rollback attempt',async()=>{
 const calls=[];const client={query:async(sql)=>{
  calls.push(sql);
  if(sql.startsWith('SELECT pg_advisory'))throw Error('database unavailable');
  return {rows:[]};
 }};
 await assert.rejects(commitAtomicPublish(client,valid),/database unavailable/);
 assert.deepEqual(calls,['BEGIN','SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))','ROLLBACK']);
});
