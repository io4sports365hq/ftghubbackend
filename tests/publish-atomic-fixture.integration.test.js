import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url);
const {commitAtomicPublish}=require('../lib/publish-atomic-fixture.cjs');
test('fixture commits game/player/receipt together and replays without mutation',async t=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url || process.env.TEST_DATABASE_ISOLATED!=='YES'){t.skip('isolated DB unavailable');return;}
 const u=new URL(url);
 if(!['localhost','127.0.0.1','::1'].includes(u.hostname)|| !/(_fixture|_test|_ci)$/.test(decodeURIComponent(u.pathname.slice(1))))throw Error('unsafe DB');
 const db=new pg.Client({connectionString:url,ssl:false});await db.connect();
 const receiptId='11111111-1111-4111-8111-111111111111';
 const args={eventId:1,gameNumber:'1',captureId:'capture-A',expectedRevision:0,idempotencyKey:'key-A',payloadDigest:'a'.repeat(64),score:11,points:11,receiptId};
 try{
  await db.query('BEGIN');
  await db.query('CREATE SCHEMA sk_atomic_fixture');
  await db.query('SET search_path TO sk_atomic_fixture');
  await db.query('COMMIT');
  await db.query('CREATE TABLE scorekeeper_publish_versions(event_id bigint,game_number text,external_game_id text,revision bigint,payload_digest text,updated_at timestamptz default now(),primary key(event_id,game_number))');
  await db.query('CREATE TABLE scorekeeper_publish_receipts(receipt_id uuid primary key,event_id bigint,game_number text,external_game_id text,idempotency_key text,payload_digest text,expected_revision bigint,committed_revision bigint,unique(event_id,game_number,idempotency_key))');
  await db.query('CREATE TABLE scorekeeper_fixture_scores(event_id bigint,game_number text,score int,primary key(event_id,game_number))');
  await db.query('CREATE TABLE scorekeeper_fixture_players(event_id bigint,game_number text,points int)');
  assert.equal((await commitAtomicPublish(db,args)).action,'committed');
  assert.deepEqual(await commitAtomicPublish(db,args),{status:200,action:'replay',receiptId,revision:1});
  assert.equal((await commitAtomicPublish(db,{...args,payloadDigest:'b'.repeat(64),score:99,points:99})).status,409);
  assert.equal((await commitAtomicPublish(db,{...args,idempotencyKey:'key-B',captureId:'capture-B'})).status,409);
  assert.equal((await db.query('SELECT score FROM scorekeeper_fixture_scores')).rows[0].score,11);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM scorekeeper_fixture_players')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM scorekeeper_publish_receipts')).rows[0].n,1);
 }finally{await db.query('DROP SCHEMA IF EXISTS sk_atomic_fixture CASCADE').catch(()=>{});await db.end();}
});
