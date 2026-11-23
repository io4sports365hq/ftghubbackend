import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {commitHubPublish} from '../lib/hub-atomic-publish.proposed.js';
test('draft real-table coordinator commits, replays and rolls back',async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(process.env.TEST_DATABASE_ISOLATED!=='YES'||!url)throw Error('isolated DB required');
 const u=new URL(url);
 if(u.hostname!=='127.0.0.1'||u.pathname!=='/hub_receipt_fixture')throw Error('unsafe database');
 const db=new pg.Client({connectionString:url,ssl:false});await db.connect();
 try{
  await db.query('CREATE SCHEMA hub_real_fixture');
  await db.query('SET search_path TO hub_real_fixture');
  await db.query(`CREATE TABLE ftg_events(id bigint primary key);
  INSERT INTO ftg_events VALUES(1);
  CREATE TABLE ftg_games(id bigserial primary key,event_id bigint references ftg_events(id),external_game_id text,game_number text,game_date text,game_time text,court text,division text,grade text,format text,period text,status text,home_team text,away_team text,home_score int,away_score int,home_fouls int,away_fouls int,published_at timestamptz,updated_at timestamptz,unique(event_id,game_number));
  CREATE TABLE ftg_game_players(game_id bigint references ftg_games(id),side text,player_number text,player_name text,pts int check(pts<=20),reb int,ast int,stl int,blk int,turnovers int,fouls int,ftm int,ftx int);`);
  await db.query(await readFile(new URL('../docs/sql/scorekeeper-publish-receipts.proposed.sql',import.meta.url),'utf8'));
  const args={eventId:1,gameNumber:'1',captureId:'capture-A',expectedRevision:0,idempotencyKey:'first',game:{home_score:11,away_score:5},players:[{player_name:'Fixture Player',pts:11}]};
  const {createDraftPublishHandler}=await import('../lib/hub-publish-handler.proposed.js');
  let connections=0,releases=0;
  const handler=createDraftPublishHandler({
   authorize:async req=>req.fixtureAuthorized===true?{eventId:1,gameNumber:'1',captureId:'capture-A'}:null,
   connect:async()=>{connections++;return {query:db.query.bind(db),release(){releases++;}};}
  });
  const invoke=async(body,fixtureAuthorized=true)=>{
   const res={statusCode:0,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
   await handler({method:'POST',body,fixtureAuthorized},res);return res;
  };
  assert.equal((await invoke(args,false)).statusCode,403);
  assert.equal((await invoke({...args,players:null})).statusCode,400);
  assert.equal(connections,0);
  const published=await invoke(args);
  assert.equal(published.statusCode,200);
  const {ok,...first}=published.body;
  assert.equal(ok,true);
  assert.equal(releases,1);
  const replay=await invoke(args);
  assert.deepEqual(replay.body,{ok:true,...first,action:'replay'});
  assert.equal((await invoke({...args,game:{home_score:12}})).statusCode,409);
  const failed=await invoke({...args,expectedRevision:1,idempotencyKey:'handler-failure',players:[{player_name:'Fixture Player',pts:99}]});
  assert.equal(failed.statusCode,503);
  assert.equal(connections,releases);
  const {createAssignedPublishHandler}=await import('../lib/hub-assigned-publish-handler.proposed.js');
  const binding={eventSlug:'fixture-event',gameNumber:'1',captureId:'capture-A'};
  const session={operatorId:'op-1',verified:true,revoked:false,expiresAtMs:2000};
  const assigned=createAssignedPublishHandler({
   verifyCsrf:async req=>req.fixtureCsrf===true,
   loadSession:async()=>session,
   loadAssignment:async()=>({...session,...binding,active:true}),
   resolveEvent:async slug=>slug===binding.eventSlug?{id:1,slug}:null,
   connect:async()=>{connections++;return {query:db.query.bind(db),release(){releases++;}};},
   clock:()=>1000
  });
  const callAssigned=async(body,fixtureCsrf=true)=>{
   const res={statusCode:0,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
   await assigned({method:'POST',body,fixtureCsrf},res);return res;
  };
  const before=connections;
  assert.equal((await callAssigned({...args,binding},false)).statusCode,403);
  assert.equal((await callAssigned({...args,binding:{...binding,captureId:'wrong'}})).statusCode,403);
  assert.equal(connections,before);
  assert.deepEqual((await callAssigned({...args,binding})).body,{ok:true,...first,action:'replay'});
  assert.equal(connections,releases);

  assert.equal(first.action,'committed');
  assert.deepEqual(await commitHubPublish(db,args),{...first,action:'replay'});
  assert.deepEqual(await commitHubPublish(db,{...args,game:{away_score:5,home_score:11},players:[{pts:11,player_name:'Fixture Player'}]}),{...first,action:'replay'});
  assert.equal((await commitHubPublish(db,{...args,players:[{pts:12,player_name:'Fixture Player'}]})).status,409);
  assert.equal((await commitHubPublish(db,{...args,game:{home_score:12}})).status,409);
  await assert.rejects(commitHubPublish(db,{...args,expectedRevision:1,idempotencyKey:'failure',game:{home_score:99},players:[{player_name:'Fixture Player',pts:99}]}),/check constraint/);
  assert.equal((await db.query('SELECT home_score FROM ftg_games')).rows[0].home_score,11);
  assert.equal((await db.query('SELECT pts FROM ftg_game_players')).rows[0].pts,11);
  assert.equal(Number((await db.query('SELECT revision FROM scorekeeper_publish_versions')).rows[0].revision),1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM scorekeeper_publish_receipts')).rows[0].n,1);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.query('DROP SCHEMA IF EXISTS hub_real_fixture CASCADE');await db.end();}
});
