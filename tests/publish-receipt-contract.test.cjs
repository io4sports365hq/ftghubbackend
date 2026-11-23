'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {decideReceipt:d}=require('../lib/publish-receipt-contract.cjs');
const request={captureId:'capture-A',idempotencyKey:'key-A',payloadDigest:'a'.repeat(64),expectedRevision:0};
test('first write requires zero revision',()=>{
 assert.equal(d({stored:null,request}).action,'insert');
 assert.equal(d({stored:null,request:{...request,expectedRevision:1}}).status,409);
});
test('different capture and legacy identity fail closed',()=>{
 assert.equal(d({stored:{captureId:'capture-B',revision:1,receipts:[]},request}).status,409);
 assert.equal(d({stored:{captureId:'',revision:1,receipts:[]},request}).action,'legacy_conflict');
});
test('identical replay returns original receipt without writes',()=>{
 const stored={captureId:'capture-A',revision:3,receipts:[{idempotencyKey:'key-A',payloadDigest:'a'.repeat(64),expectedRevision:0,committedRevision:1,receiptId:'receipt-A'}]};
 assert.deepEqual(d({stored,request}),{status:200,action:'replay',receiptId:'receipt-A',committedRevision:1});
 assert.equal(d({stored,request:{...request,payloadDigest:'b'.repeat(64)}}).status,409);
});
test('stale write rejected, current revision advances',()=>{
 const stored={captureId:'capture-A',revision:2,receipts:[]};
 assert.equal(d({stored,request:{...request,idempotencyKey:'key-B',expectedRevision:1}}).status,409);
 assert.equal(d({stored,request:{...request,idempotencyKey:'key-B',expectedRevision:2}}).nextRevision,3);
});
test('incomplete receipts fail closed',()=>{
 const stored={captureId:'capture-A',revision:2,receipts:[{idempotencyKey:'key-A',payloadDigest:request.payloadDigest,expectedRevision:0}]};
 assert.equal(d({stored,request}).status,409);
});
