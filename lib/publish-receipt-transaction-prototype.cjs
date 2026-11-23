'use strict';
// Transaction-only prototype; deliberately NOT wired into api/publish.js.
// Caller must authenticate/authorize and validate canonical payload digest.
// Requires approved schema migration in an isolated database before use.
const {randomUUID}=require('node:crypto');
const {decideReceipt}=require('./publish-receipt-contract.cjs');
async function reserveReceipt(client,{eventId,gameNumber,request}) {
 if (!client || typeof client.query!=='function' ||
     !Number.isSafeInteger(eventId) || eventId<=0 ||
     !/^[1-9][0-9]{0,9}$/.test(String(gameNumber))) throw new TypeError('Invalid transaction inputs');
 // Serialize the first insert too; caller must have begun a transaction.
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(eventId),String(gameNumber)]);
 const v=await client.query('SELECT external_game_id,revision FROM scorekeeper_publish_versions WHERE event_id=$1 AND game_number=$2 FOR UPDATE',[eventId,String(gameNumber)]);
 const rows=await client.query('SELECT idempotency_key,payload_digest,expected_revision,committed_revision,receipt_id FROM scorekeeper_publish_receipts WHERE event_id=$1 AND game_number=$2',[eventId,String(gameNumber)]);
 const stored=v.rows[0]?{captureId:v.rows[0].external_game_id,revision:Number(v.rows[0].revision),receipts:rows.rows.map(r=>({idempotencyKey:r.idempotency_key,payloadDigest:r.payload_digest,expectedRevision:Number(r.expected_revision),committedRevision:Number(r.committed_revision),receiptId:String(r.receipt_id)}))}:null;
 const decision=decideReceipt({stored,request});
 if(decision.status!==200 || decision.action==='replay') return decision;
 const receiptId=randomUUID();
 // This prototype intentionally stops before writes: game/player data and receipt
 // must eventually commit atomically in the real Hub handler.
 return {...decision,receiptId,requiresAtomicWrite:true};
}
module.exports={reserveReceipt};
