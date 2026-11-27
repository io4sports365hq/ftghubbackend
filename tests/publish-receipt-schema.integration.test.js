import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import pg from 'pg';
const root=path.dirname(fileURLToPath(import.meta.url));
const ddl=readFileSync(path.join(root,'../docs/sql/scorekeeper-publish-receipts.proposed.sql'),'utf8');
test('proposed schema enforces immutable receipt uniqueness in rollback-only disposable DB',async t=>{
 const connectionString=process.env.TEST_DATABASE_URL;
 if(!connectionString || process.env.TEST_DATABASE_ISOLATED!=='YES'){t.skip('disposable DB unavailable');return;}
 const u=new URL(connectionString);
 if(!['localhost','127.0.0.1','::1'].includes(u.hostname) ||
    !/(_fixture|_test|_ci)$/.test(decodeURIComponent(u.pathname.slice(1))))
  throw Error('Refusing unsafe database');
 const db=new pg.Client({connectionString,ssl:false});
 await db.connect();
 try {
  // DDL contains its own transaction. A dedicated temporary schema prevents
  // interference with any existing objects in this disposable database.
  await db.query('BEGIN');
  await db.query('CREATE SCHEMA sk_receipt_ddl_fixture');
  await db.query('SET LOCAL search_path TO sk_receipt_ddl_fixture');
  const sql=ddl.replace(/^BEGIN;\s*/m,'').replace(/\s*COMMIT;\s*$/m,'');
  await db.query(sql);
  await db.query("INSERT INTO scorekeeper_publish_versions(event_id,game_number,external_game_id,revision,payload_digest) VALUES(1,'1','capture-A',1,$1)",['a'.repeat(64)]);
  const receipt='11111111-1111-4111-8111-111111111111';
  const insert="INSERT INTO scorekeeper_publish_receipts(receipt_id,event_id,game_number,external_game_id,idempotency_key,payload_digest,expected_revision,committed_revision) VALUES($1,1,'1','capture-A','key-A',$2,0,1)";
  await db.query(insert,[receipt,'a'.repeat(64)]);
  await db.query('SAVEPOINT duplicate_receipt');
  await assert.rejects(db.query(insert,['22222222-2222-4222-8222-222222222222','a'.repeat(64)]),/duplicate key/);
  await db.query('ROLLBACK TO SAVEPOINT duplicate_receipt');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM scorekeeper_publish_receipts')).rows[0].n,1);
  await db.query('SAVEPOINT invalid_reference');
  await assert.rejects(db.query("INSERT INTO scorekeeper_publish_receipts(receipt_id,event_id,game_number,external_game_id,idempotency_key,payload_digest,expected_revision,committed_revision) VALUES('33333333-3333-4333-8333-333333333333',9,'1','capture-Z','key-Z',$1,0,1)",['b'.repeat(64)]),/foreign key/);
  await db.query('ROLLBACK TO SAVEPOINT invalid_reference');
  await db.query('SAVEPOINT wrong_capture');
  await assert.rejects(db.query("INSERT INTO scorekeeper_publish_receipts(receipt_id,event_id,game_number,external_game_id,idempotency_key,payload_digest,expected_revision,committed_revision) VALUES('44444444-4444-4444-8444-444444444444',1,'1','capture-B','key-B',$1,0,1)",['b'.repeat(64)]),/foreign key/);
  await db.query('ROLLBACK TO SAVEPOINT wrong_capture');
  await db.query('SAVEPOINT mutate_receipt');
  await assert.rejects(db.query("UPDATE scorekeeper_publish_receipts SET committed_revision=2 WHERE idempotency_key='key-A'"),/append-only/);
  await db.query('ROLLBACK TO SAVEPOINT mutate_receipt');
  await db.query('SAVEPOINT delete_receipt');
  await assert.rejects(db.query("DELETE FROM scorekeeper_publish_receipts WHERE idempotency_key='key-A'"),/append-only/);
  await db.query('ROLLBACK TO SAVEPOINT delete_receipt');

 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
