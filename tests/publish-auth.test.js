import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { timingSafeEqual } from 'node:crypto';

const dir=path.dirname(fileURLToPath(import.meta.url));
const source=readFileSync(path.join(dir,'../api/publish.js'),'utf8');
const isolated=source.replace(/^import \{ db, cors \} from '\.\/_db\.js';\s*/, '').replace('export default async function handler','async function handler');
async function invoke(env,headers,body){
 const calls=[];
 const res={code:0,status(n){this.code=n;return this},json(v){this.body=v;return this},end(){return this}};
 const ctx={process:{env},Buffer,console,timingSafeEqual,db:()=>{calls.push('db');throw Error('unexpected database connection')},cors:()=>{}};
 const handler=vm.runInNewContext(isolated+'\nhandler',ctx);
 await handler({method:'POST',headers,body},res);
 return {res,calls};
}
test('no configured publisher secret fails closed before touching database',async()=>{
 const {res,calls}=await invoke({}, {}, {game:{game_number:'1'}});
 assert.equal(res.code,503);
 assert.deepEqual(calls,[]);
});
test('missing publisher token fails closed before touching database',async()=>{
 const {res,calls}=await invoke({FTG_HUB_PUBLISH_SECRET:'x'.repeat(40)}, {}, {game:{game_number:'1'}});
 assert.equal(res.code,401);
 assert.deepEqual(calls,[]);
});
test('invalid publisher token fails closed before touching database',async()=>{
 const {res,calls}=await invoke({FTG_HUB_PUBLISH_SECRET:'x'.repeat(40)}, {'x-ftg-publish-token':'nope'}, {game:{game_number:'1'}});
 assert.equal(res.code,401);
 assert.deepEqual(calls,[]);
});
