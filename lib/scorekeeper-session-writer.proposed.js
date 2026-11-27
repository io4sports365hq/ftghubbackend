// Draft-only session store; no route or provider is registered. Use isolated storage.
import {createHash} from 'node:crypto';
function sessionParams({tokenHash,operatorId,expiresAtMs,idleExpiresAtMs,previousHash=null}){
 if(typeof tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(tokenHash)||typeof operatorId!=='string'||!operatorId||!Number.isSafeInteger(expiresAtMs)||!Number.isSafeInteger(idleExpiresAtMs)||idleExpiresAtMs>expiresAtMs||(previousHash!==null&&(typeof previousHash!=='string'||!/^[a-f0-9]{64}$/.test(previousHash)||previousHash===tokenHash)))throw new TypeError('Invalid session');
 return [tokenHash,operatorId,new Date(expiresAtMs),new Date(idleExpiresAtMs),previousHash];
}
export function createSessionWriter(client,{clock=Date.now,idleTimeoutMs=5*60*1000}={}) {
 if(typeof client?.query!=='function'||typeof clock!=='function'||!Number.isSafeInteger(idleTimeoutMs)||idleTimeoutMs<1000||idleTimeoutMs>60*60*1000)throw new TypeError('Missing or invalid session store');
 return {
  async storeSession(record) {
   // Single SQL statement: failure to create the replacement also rolls back rotation.
   await client.query(`WITH rotated AS (UPDATE scorekeeper_operator_sessions SET revoked_at=now() WHERE token_hash=$5 AND operator_id=$2 AND revoked_at IS NULL)
   INSERT INTO scorekeeper_operator_sessions(token_hash,operator_id,expires_at,idle_expires_at) VALUES($1,$2,$3,$4)`,sessionParams(record));
  },
  async storeAuthorizedSession(record){
   // The production-candidate issuer locks the active directory row first;
   // deactivation and session creation/rotation cannot cross one another.
   const result=await client.query(`WITH eligible AS MATERIALIZED (SELECT operator_id FROM scorekeeper_operators WHERE operator_id=$2 AND active=true AND revoked_at IS NULL FOR SHARE),
    rotated AS (UPDATE scorekeeper_operator_sessions SET revoked_at=now() WHERE token_hash=$5 AND operator_id=$2 AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM eligible))
    INSERT INTO scorekeeper_operator_sessions(token_hash,operator_id,expires_at,idle_expires_at) SELECT $1,operator_id,$3,$4 FROM eligible RETURNING token_hash`,sessionParams(record));
   if(result.rows.length!==1)throw new Error('Operator unavailable');
  },
  async touchSession(token) {
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
   const now=clock();if(!Number.isSafeInteger(now))return false;
   const hash=createHash('sha256').update(token).digest('hex');
   const result=await client.query(`UPDATE scorekeeper_operator_sessions SET idle_expires_at=LEAST(expires_at,GREATEST(idle_expires_at,$2))
   WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$3 AND idle_expires_at>$3`,[hash,new Date(now+idleTimeoutMs),new Date(now)]);
   return (result.rowCount??result.affectedRows)===1;
  },
  async revokeSession(token) {
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
   const hash=createHash('sha256').update(token).digest('hex');
   const result=await client.query('UPDATE scorekeeper_operator_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[hash]);
   return (result.rowCount??result.affectedRows)===1;
  }
 };
}
