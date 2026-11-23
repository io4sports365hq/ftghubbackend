'use strict';
// Isolated transaction coordinator. NOT imported by api/publish.js.
// Must only be called by a trusted, authenticated server integration.
// Caller provides a connected database client; this function owns BEGIN/COMMIT.
async function commitAtomicPublish(client,{eventId,gameNumber,captureId,expectedRevision,idempotencyKey,payloadDigest,score,points,receiptId}) {
 if(!client?.query || !Number.isSafeInteger(eventId) || eventId<1 ||
    !/^[1-9][0-9]{0,9}$/.test(String(gameNumber)) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(captureId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey) ||
    !/^[a-f0-9]{64}$/.test(payloadDigest) ||
    !Number.isSafeInteger(expectedRevision) || expectedRevision<0 ||
    !Number.isSafeInteger(score) || score<0 ||
    !Number.isSafeInteger(points) || points<0 ||
    !/^[0-9a-f-]{36}$/i.test(receiptId)) throw new TypeError('Invalid publish transaction');
 await client.query('BEGIN');
 try {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(eventId),String(gameNumber)]);
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
  const revision=expectedRevision+1;
  await client.query(`INSERT INTO scorekeeper_publish_versions(event_id,game_number,external_game_id,revision,payload_digest)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,game_number) DO UPDATE
   SET revision=EXCLUDED.revision,payload_digest=EXCLUDED.payload_digest,updated_at=now()`,[eventId,String(gameNumber),captureId,revision,payloadDigest]);
  // Fixture tables intentionally separate from actual Hub game/player schema.
  await client.query('INSERT INTO scorekeeper_fixture_scores(event_id,game_number,score) VALUES($1,$2,$3) ON CONFLICT(event_id,game_number) DO UPDATE SET score=EXCLUDED.score',[eventId,String(gameNumber),score]);
  await client.query('DELETE FROM scorekeeper_fixture_players WHERE event_id=$1 AND game_number=$2',[eventId,String(gameNumber)]);
  await client.query('INSERT INTO scorekeeper_fixture_players(event_id,game_number,points) VALUES($1,$2,$3)',[eventId,String(gameNumber),points]);
  await client.query(`INSERT INTO scorekeeper_publish_receipts(receipt_id,event_id,game_number,external_game_id,idempotency_key,payload_digest,expected_revision,committed_revision)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[receiptId,eventId,String(gameNumber),captureId,idempotencyKey,payloadDigest,expectedRevision,revision]);
  await client.query('COMMIT');
  return {status:200,action:'committed',receiptId,revision};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
module.exports={commitAtomicPublish};
