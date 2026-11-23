import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/publish.js';

// Real handler boundary tests; deliberately no DATABASE_URL or live database.
// Only pre-connect rejection paths are exercised. No publishing is attempted.
function response(){
 return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},
 json(v){this.body=v;return this;}};
}
async function invoke(req){
 const res=response();await handler(req,res);return res;
}
test('live handler rejects unsafe methods and unconfigured credentials without DB',async()=>{
 const oldSecret=process.env.FTG_HUB_PUBLISH_SECRET;
 const oldDb=process.env.DATABASE_URL;
 try{
  delete process.env.DATABASE_URL;
  delete process.env.FTG_HUB_PUBLISH_SECRET;
  assert.equal((await invoke({method:'GET'})).statusCode,405);
  assert.equal((await invoke({method:'POST',headers:{},body:{}})).statusCode,503);
  process.env.FTG_HUB_PUBLISH_SECRET='s'.repeat(31);
  assert.equal((await invoke({method:'POST',headers:{'x-ftg-publish-token':'s'.repeat(31)},body:{}})).statusCode,503);
  process.env.FTG_HUB_PUBLISH_SECRET='';
  assert.equal((await invoke({method:'POST',headers:{},body:{}})).statusCode,503);
  process.env.FTG_HUB_PUBLISH_SECRET='s'.repeat(40);
  assert.equal((await invoke({method:'POST',headers:{},body:{}})).statusCode,401);
  assert.equal((await invoke({method:'POST',headers:{'x-ftg-publish-token':'wrong'},body:{}})).statusCode,401);
  assert.equal((await invoke({method:'POST',headers:{'x-ftg-publish-token':'t'.repeat(40)},body:{}})).statusCode,401);
  assert.equal((await invoke({method:'POST',headers:{'x-ftg-publish-token':['s'.repeat(40)]},body:{}})).statusCode,401);
  const headers={'x-ftg-publish-token':process.env.FTG_HUB_PUBLISH_SECRET};
  const base={event_slug:'event-one',game:{game_number:1,external_game_id:'capture-one'},players:[]};
  for(const body of [
   null,[],{}, {...base,event_slug:'ftg-demo-event!'},
   {...base,game:{...base.game,game_number:'0'}},
   {...base,game:{...base.game,external_game_id:'bad capture'}},
   {...base,players:new Array(201).fill({})},
   {...base,event_name:'x'.repeat(129*1024)},
   {...base,game:null},
   {...base,game:{...base.game,game_number:'1;DROP TABLE ftg_games'}},
   {...base,game:{...base.game,external_game_id:'x'.repeat(129)}}
  ]){
   const result=await invoke({method:'POST',headers,body});
   assert.equal(result.statusCode,400,JSON.stringify(body)?.slice(0,100));
  }
 }finally{
  if(oldSecret===undefined)delete process.env.FTG_HUB_PUBLISH_SECRET;
  else process.env.FTG_HUB_PUBLISH_SECRET=oldSecret;
  if(oldDb===undefined)delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL=oldDb;
 }
});
