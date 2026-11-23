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
  const first=await commitHubPublish(db,args);
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
