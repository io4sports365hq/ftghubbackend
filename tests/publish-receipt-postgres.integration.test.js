import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url);
const {decideReceipt}=require('../lib/publish-receipt-contract.cjs');

// Disposable-only integration fixture. NOT the real Hub handler.
// Refuses remote hosts and databases lacking an explicit test suffix.
test('Hub receipt fixture preserves original receipt and rolls back failed write',async t=>{
 const connectionString=process.env.TEST_DATABASE_URL;
 if(!connectionString || process.env.TEST_DATABASE_ISOLATED!=='YES'){
   t.skip('explicit disposable PostgreSQL not configured');return;
 }
 const target=new URL(connectionString);
 if(!['localhost','127.0.0.1','::1'].includes(target.hostname) ||
    !/(_fixture|_test|_ci)$/.test(decodeURIComponent(target.pathname.slice(1))))
   throw Error('Refusing nonlocal or non-disposable database');
 const client=new pg.Client({connectionString,ssl:false});
 await client.connect();
 try {
  await client.query('BEGIN');
  await client.query('CREATE TEMP TABLE receipt_games(slot text primary key,capture text not null,revision int not null,score int not null)');
  await client.query('CREATE TEMP TABLE receipt_players(slot text,points int not null)');
  await client.query('CREATE TEMP TABLE receipt_log(slot text,key text primary key,digest text,expected int,committed int,receipt text)');
  const request={captureId:'capture-1',idempotencyKey:'key-1',payloadDigest:'a'.repeat(64),expectedRevision:0};
  assert.equal(decideReceipt({stored:null,request}).action,'insert');
  await client.query('INSERT INTO receipt_games VALUES ($1,$2,$3,$4)',['slot-1','capture-1',1,11]);
  await client.query('INSERT INTO receipt_players VALUES ($1,$2)',['slot-1',11]);
  await client.query('INSERT INTO receipt_log VALUES ($1,$2,$3,$4,$5,$6)',['slot-1','key-1',request.payloadDigest,0,1,'receipt-1']);
  const g=(await client.query('SELECT * FROM receipt_games WHERE slot=$1 FOR UPDATE',['slot-1'])).rows[0];
  const receipts=(await client.query('SELECT * FROM receipt_log WHERE slot=$1',['slot-1'])).rows.map(r=>({
   idempotencyKey:r.key,payloadDigest:r.digest,expectedRevision:r.expected,
   committedRevision:r.committed,receiptId:r.receipt
  }));
  const stored={captureId:g.capture,revision:g.revision,receipts};
  assert.deepEqual(decideReceipt({stored,request}),{status:200,action:'replay',receiptId:'receipt-1',committedRevision:1});
  assert.equal(decideReceipt({stored,request:{...request,payloadDigest:'b'.repeat(64)}}).status,409);
  assert.equal(decideReceipt({stored,request:{...request,idempotencyKey:'key-2',expectedRevision:0}}).status,409);
  await client.query('SAVEPOINT failed_publish');
  await client.query('UPDATE receipt_games SET revision=2,score=99 WHERE slot=$1',['slot-1']);
  await client.query('INSERT INTO receipt_players VALUES ($1,$2)',['slot-1',99]);
  await assert.rejects(client.query('INSERT INTO receipt_log VALUES ($1,$2,$3,$4,$5,$6)',['slot-1','key-1','b'.repeat(64),1,2,'receipt-2']),/duplicate key/);
  await client.query('ROLLBACK TO SAVEPOINT failed_publish');
  assert.equal((await client.query('SELECT revision FROM receipt_games')).rows[0].revision,1);
  assert.equal((await client.query('SELECT score FROM receipt_games')).rows[0].score,11);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM receipt_players')).rows[0].n,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM receipt_log')).rows[0].n,1);
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
});
