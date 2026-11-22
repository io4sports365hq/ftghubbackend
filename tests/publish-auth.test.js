import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { timingSafeEqual } from 'node:crypto';

const dir=path.dirname(fileURLToPath(import.meta.url));
const source=readFileSync(path.join(dir,'../api/publish.js'),'utf8');
const isolated=source.replace(/^import .*;\s*$/gm, '').replace('export default async function handler','async function handler');
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

test('valid server credential reaches request validation without database access',async()=>{
 const secret='s'.repeat(40);
 const {res,calls}=await invoke({FTG_HUB_PUBLISH_SECRET:secret}, {'x-ftg-publish-token':secret}, {game:{}});
 assert.equal(res.code,400);
 assert.deepEqual(calls,[]);
});

test('authenticated malformed and oversized requests never touch database',async()=>{
 const secret='s'.repeat(40);
 const headers={'x-ftg-publish-token':secret};
 for(const body of [null,[],{game:{game_number:'1'},players:'invalid'},
   {game:{game_number:'1'},players:Array.from({length:201},()=>({}))},
   {game:{game_number:'1'},players:[],note:'x'.repeat(130*1024)}]){
  const {res,calls}=await invoke({FTG_HUB_PUBLISH_SECRET:secret},headers,body);
  assert.equal(res.code,400);
  assert.deepEqual(calls,[]);
 }
});

test('authenticated publish requires explicit well-formed event identity',async()=>{
 const secret='s'.repeat(40), headers={'x-ftg-publish-token':secret};
 const base={game:{game_number:'1',external_game_id:'g1'},players:[]};
 for(const event_slug of [undefined,'','../other','TEAM WITH SPACES','a'.repeat(81),42]){
  const {res,calls}=await invoke({FTG_HUB_PUBLISH_SECRET:secret},headers,{...base,event_slug});
  assert.equal(res.code,400);
  assert.deepEqual(calls,[]);
 }
});

test('same-event game publishing takes transaction lock before collision lookup and write',()=>{
 const begin=source.indexOf("await client.query('BEGIN')");
 const lock=source.indexOf('pg_advisory_xact_lock');
 const lookup=source.indexOf('select id, external_game_id');
 const write=source.indexOf('insert into ftg_games');
 assert.ok(begin>=0 && lock>begin && lookup>lock && write>lookup);
 assert.match(source,/pg_advisory_xact_lock\(hashtext\(\$1\), hashtext\(\$2\)\)/);
 assert.match(source,/\[String\(event\.id\), String\(game\.game_number\)\]/);
});

test('server-only publish endpoint never enables browser CORS or preflight publishing',()=>{
 assert.doesNotMatch(source,/\bcors\s*\(\s*res\s*\)/);
 assert.doesNotMatch(source,/Access-Control-Allow-Origin/i);
 assert.doesNotMatch(source,/req\.method\s*===\s*['"]OPTIONS['"]/);
});
