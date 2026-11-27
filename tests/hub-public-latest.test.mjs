import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicLatestHandler} from '../lib/hub-public-latest.proposed.js';
async function invoke(handler,method){const result={headers:{}};await handler({method},{setHeader(k,v){result.headers[k]=v;},status(n){result.status=n;return this;},json(v){result.body=v;return this;},end(){return this;}});return result;}
test('public readback permits read methods only and never acquires a connection for OPTIONS/POST',async()=>{
 let calls=0;const handler=createPublicLatestHandler({connect:async()=>{calls++;throw Error('unexpected');}});
 assert.equal((await invoke(handler,'OPTIONS')).status,204);assert.equal((await invoke(handler,'POST')).status,405);assert.equal(calls,0);
});
test('public readback redacts connection and query errors, rolls back and releases',async()=>{
 const failed=createPublicLatestHandler({connect:async()=>{throw Error('fixture private error');}});
 const response=await invoke(failed,'GET');assert.equal(response.status,503);assert.equal(response.body.error,'Hub latest game unavailable');assert.equal(response.headers['Cache-Control'],'no-store');
 const calls=[];let released=0;const handler=createPublicLatestHandler({connect:async()=>({async query(sql){calls.push(sql);if(sql.includes('SELECT'))throw Error('fixture query error');return {rows:[]};},release(){released++;}})});
 const result=await invoke(handler,'GET');assert.equal(result.status,503);assert.equal(released,1);assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-1),'ROLLBACK');
});
