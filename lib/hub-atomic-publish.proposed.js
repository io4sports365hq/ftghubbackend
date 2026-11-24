import {writeHubGamePlayers} from './hub-game-player-writes.proposed.js';
import {createHash,randomUUID} from 'node:crypto';
import {validHubEventId} from './scorekeeper-event-id.proposed.js';
// Draft real-table coordinator. NOT imported by api/publish.js.
// Canonical JSON object ordering; array order remains significant.
function canonical(value) {
 if(value===null || typeof value==='string' || typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value))) return JSON.stringify(value);
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(value && Object.getPrototypeOf(value)===Object.prototype) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw new TypeError('Invalid JSON payload');
}
// Must only be called by a trusted, authenticated server integration.
// Caller provides a connected database client; this function owns BEGIN/COMMIT.
export async function commitHubPublish(client,{eventId,gameNumber,captureId,expectedRevision,idempotencyKey,game,players},{revalidate,lookupOnly=false}={}) {
 const receiptId=randomUUID();
 const payloadDigest=createHash('sha256').update(canonical({game,players})).digest('hex');
 if(!client?.query || !validHubEventId(eventId) ||
    !/^[1-9][0-9]{0,9}$/.test(String(gameNumber)) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(captureId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey) ||
    !/^[a-f0-9]{64}$/.test(payloadDigest) ||
    !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
    !game || typeof game!=='object' || Array.isArray(game) || !Array.isArray(players) || players.length>200 ||
    expectedRevision>=Number.MAX_SAFE_INTEGER ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) throw new TypeError('Invalid publish transaction');
 await client.query('BEGIN');
 try {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(eventId),String(gameNumber)]);
  // The service composition can recheck authorization after waiting for the lock.
  // A colocated authority can lock its session/assignment rows in this transaction.
  if(revalidate && await revalidate(client)!==true){await client.query('ROLLBACK');return {status:403,action:'authorization_expired'};}
  const current=await client.query('SELECT external_game_id,revision FROM scorekeeper_publish_versions WHERE event_id=$1 AND game_number=$2 FOR UPDATE',[eventId,String(gameNumber)]);
  const receipt=await client.query('SELECT payload_digest,expected_revision,committed_revision,receipt_id FROM scorekeeper_publish_receipts WHERE event_id=$1 AND game_number=$2 AND idempotency_key=$3',[eventId,String(gameNumber),idempotencyKey]);
  const row=current.rows[0],prior=receipt.rows[0];
  if(prior){
   if(prior.payload_digest===payloadDigest && Number(prior.expected_revision)===expectedRevision && row?.external_game_id===captureId){
    await client.query('COMMIT');
    return {status:200,action:'replay',receiptId:String(prior.receipt_id),revision:Number(prior.committed_revision)};
   }
   await client.query('ROLLBACK');return {status:409,action:'idempotency_conflict'};
  }
  if((row && (row.external_game_id!==captureId || Number(row.revision)!==expectedRevision)) ||
     (!row && expectedRevision!==0)){
   await client.query('ROLLBACK');return {status:409,action:'revision_conflict'};
  }
  const event=await client.query('SELECT id FROM ftg_events WHERE id=$1 FOR SHARE',[eventId]);
  const existing=await client.query('SELECT external_game_id FROM ftg_games WHERE event_id=$1 AND game_number=$2 FOR UPDATE',[eventId,String(gameNumber)]);
  if(!event.rows[0] || (existing.rows[0] && (!row || existing.rows[0].external_game_id!==captureId)) || (row && !existing.rows[0])){
   await client.query('ROLLBACK');return {status:409,action:'binding_conflict'};
  }
  // Authenticated reconciliation: prove absence under the same slot lock and
  // binding/revision checks. Never insert a receipt or modify game/player rows.
  if(lookupOnly===true){await client.query('COMMIT');return {status:404,action:'receipt_absent'};}
  const revision=expectedRevision+1;
  await client.query(`INSERT INTO scorekeeper_publish_versions(event_id,game_number,external_game_id,revision,payload_digest)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,game_number) DO UPDATE
   SET revision=EXCLUDED.revision,payload_digest=EXCLUDED.payload_digest,updated_at=now()`,[eventId,String(gameNumber),captureId,revision,payloadDigest]);
  await writeHubGamePlayers(client,{id:eventId},game,players,String(gameNumber),captureId);
  await client.query(`INSERT INTO scorekeeper_publish_receipts(receipt_id,event_id,game_number,external_game_id,idempotency_key,payload_digest,expected_revision,committed_revision)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[receiptId,eventId,String(gameNumber),captureId,idempotencyKey,payloadDigest,expectedRevision,revision]);
  await client.query('COMMIT');
  return {status:200,action:'committed',receiptId,revision};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}


