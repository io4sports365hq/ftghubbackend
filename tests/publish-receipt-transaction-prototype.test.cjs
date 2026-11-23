'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveReceipt}=require('../lib/publish-receipt-transaction-prototype.cjs');
const req={captureId:'capture-A',idempotencyKey:'key-A',payloadDigest:'a'.repeat(64),expectedRevision:0};
test('new slot only proposes write; never executes insert/update/delete',async()=>{
 const sql=[];
 const db={query:async(q)=>{sql.push(q);return {rows:[]}}};
 const result=await reserveReceipt(db,{eventId:1,gameNumber:'1',request:req});
 assert.equal(result.action,'insert');assert.equal(result.requiresAtomicWrite,true);
 assert.equal(sql.length,3);
 assert.equal(sql.some(s=>/^\s*(insert|update|delete)/i.test(s)),false);
});
test('conflicting capture rejected without mutation',async()=>{
 const sql=[];
 const db={query:async(q)=>{sql.push(q);return {rows:q.includes('FROM scorekeeper_publish_versions')?[{external_game_id:'capture-B',revision:1}]:[]}}};
 const result=await reserveReceipt(db,{eventId:1,gameNumber:'1',request:req});
 assert.equal(result.status,409);assert.equal(sql.length,3);
});
test('invalid event ID rejected before query',async()=>{
 let count=0;const db={query:async()=>{count++;return {rows:[]}}};
 await assert.rejects(reserveReceipt(db,{eventId:0,gameNumber:'1',request:req}),TypeError);
 assert.equal(count,0);
});
