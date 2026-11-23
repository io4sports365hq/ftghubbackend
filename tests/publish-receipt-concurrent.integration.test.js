import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url);
const {decideReceipt}=require('../lib/publish-receipt-contract.cjs');
test('Hub competing capture transactions preserve first receipt and player',async t=>{
 const connectionString=process.env.TEST_DATABASE_URL;
 if(!connectionString || process.env.TEST_DATABASE_ISOLATED!=='YES'){t.skip('isolated DB unavailable');return;}
 const u=new URL(connectionString);
 if(!['localhost','127.0.0.1','::1'].includes(u.hostname) ||
    !/(_fixture|_test|_ci)$/.test(decodeURIComponent(u.pathname.slice(1))))
   throw Error('Refusing unsafe DB');
 const admin=new pg.Client({connectionString,ssl:false});
 const first=new pg.Client({connectionString,ssl:false});
 const second=new pg.Client({connectionString,ssl:false});
 const suffix=randomUUID().replaceAll('-','');
 const games='hub_games_'+suffix,players='hub_players_'+suffix,receipts='hub_receipts_'+suffix;
 await admin.connect();await first.connect();await second.connect();
 try {
  await admin.query(`CREATE TABLE "${games}"(slot text primary key,capture text not null,revision int not null,score int not null)`);
  await admin.query(`CREATE TABLE "${players}"(slot text,points int not null)`);
  await admin.query(`CREATE TABLE "${receipts}"(slot text,key text primary key,revision int not null)`);
  const lock=[57219,30418];
  await first.query('BEGIN');
  await first.query('SELECT pg_advisory_xact_lock($1,$2)',lock);
  const request={captureId:'capture-A',idempotencyKey:'key-A',payloadDigest:'a'.repeat(64),expectedRevision:0};
  assert.equal(decideReceipt({stored:null,request}).action,'insert');
  await first.query(`INSERT INTO "${games}" VALUES ('slot-1','capture-A',1,11)`);
  await first.query(`INSERT INTO "${players}" VALUES ('slot-1',11)`);
  await first.query(`INSERT INTO "${receipts}" VALUES ('slot-1','key-A',1)`);
  await second.query('BEGIN');
  assert.equal((await second.query('SELECT pg_try_advisory_xact_lock($1,$2) AS acquired',lock)).rows[0].acquired,false);
  await first.query('COMMIT');
  assert.equal((await second.query('SELECT pg_try_advisory_xact_lock($1,$2) AS acquired',lock)).rows[0].acquired,true);
  const row=(await second.query(`SELECT * FROM "${games}" WHERE slot='slot-1' FOR UPDATE`)).rows[0];
  assert.equal(decideReceipt({stored:{captureId:row.capture,revision:row.revision,receipts:[]},
    request:{captureId:'capture-B',idempotencyKey:'key-B',payloadDigest:'b'.repeat(64),expectedRevision:0}}).status,409);
  await second.query('ROLLBACK');
  assert.deepEqual((await admin.query(`SELECT capture,score FROM "${games}"`)).rows.map(r=>[r.capture,r.score]),[['capture-A',11]]);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM "${players}"`)).rows[0].n,1);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM "${receipts}"`)).rows[0].n,1);
 }finally{
  await first.query('ROLLBACK').catch(()=>{});await second.query('ROLLBACK').catch(()=>{});
  await admin.query(`DROP TABLE IF EXISTS "${receipts}","${players}","${games}"`).catch(()=>{});
  await Promise.all([first.end(),second.end(),admin.end()]);
 }
});
