// Review-only transient login state in isolated authoritative storage.
const hex=/^[a-f0-9]{64}$/;const token=/^[A-Za-z0-9_-]{43}$/;
export function createOidcFlowStore(client,{clock=Date.now}={}){
 if(typeof client?.query!=='function'||typeof clock!=='function')throw new TypeError('Missing OIDC flow store');
 return {
  async storeFlow({flowHash,stateHash,nonce,verifier,expiresAtMs,previousHash=null}){
   const now=clock();if(!Number.isSafeInteger(now)||!hex.test(flowHash)||!hex.test(stateHash)||!token.test(nonce)||!token.test(verifier)||!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=now||expiresAtMs-now>300000||(previousHash!==null&&(!hex.test(previousHash)||previousHash===flowHash)))throw new TypeError('Invalid login flow');
   await client.query(`WITH expired AS (DELETE FROM scorekeeper_oidc_flows WHERE expires_at<=$5 OR flow_hash=$6)
    INSERT INTO scorekeeper_oidc_flows(flow_hash,state_hash,nonce,verifier,expires_at) VALUES($1,$2,$3,$4,$7)`,[flowHash,stateHash,nonce,verifier,new Date(now),previousHash,new Date(expiresAtMs)]);
  },
  async consumeFlow({flowHash,stateHash}){
   const now=clock();if(!Number.isSafeInteger(now)||!hex.test(flowHash)||!hex.test(stateHash))return null;
   // Atomic consumption across server instances; wrong/expired flow cannot issue a session.
   const {rows}=await client.query('DELETE FROM scorekeeper_oidc_flows WHERE flow_hash=$1 AND state_hash=$2 AND expires_at>$3 RETURNING nonce,verifier',[flowHash,stateHash,new Date(now)]);
   return rows.length===1?{nonce:rows[0].nonce,verifier:rows[0].verifier}:null;
  }
 };
}
