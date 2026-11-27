// Review-only trusted administrative primitive. NOT a route; provisioning,
// caller authorization and operational audit approval remain external gates.
export function createOperatorDirectoryWriter({connect}){
 if(typeof connect!=='function')throw new TypeError('Missing operator directory');
 return {async deactivateOperator(operatorId){
  if(typeof operatorId!=='string'||!operatorId||operatorId.length>256)throw new TypeError('Invalid operator');
  let client;
  try{
   client=await connect();await client.query('BEGIN');
   // Acquire the directory lock before reading sessions. Separate statements
   // at READ COMMITTED see any issuance that finished while waiting for it.
   const existing=await client.query('SELECT operator_id FROM scorekeeper_operators WHERE operator_id=$1 FOR UPDATE',[operatorId]);
   if(existing.rows.length!==1){await client.query('ROLLBACK');return {disabled:false,revokedSessions:0};}
   await client.query('UPDATE scorekeeper_operators SET active=false,revoked_at=COALESCE(revoked_at,now()) WHERE operator_id=$1',[operatorId]);
   const revoked=await client.query('UPDATE scorekeeper_operator_sessions SET revoked_at=now() WHERE operator_id=$1 AND revoked_at IS NULL',[operatorId]);
   await client.query('COMMIT');return {disabled:true,revokedSessions:revoked.rowCount};
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{if(client)client.release();}
 }};
}
