// Review-only shared operator budget backed by isolated authoritative storage.
// Limits/window durations are trusted release configuration, never request values.
const operations=['scorer_context','scorer_publish','scorer_receipt','hub_context','hub_publish','hub_receipt'];
export function createScorekeeperRateLimiter(client,{limits,windowMs,clock=Date.now}){
 if(typeof client?.query!=='function'||typeof clock!=='function'||!Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>3600000||!limits||operations.some(op=>!Number.isSafeInteger(limits[op])||limits[op]<1||limits[op]>10000))throw new TypeError('Invalid rate policy');
 const policy=Object.freeze({...limits});
 return async function consume(operatorId,operation){
  if(typeof operatorId!=='string'||!operatorId||operatorId.length>256||!operations.includes(operation))throw new TypeError('Invalid rate subject');
  const now=clock();if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid clock');
  const start=Math.floor(now/windowMs)*windowMs,limit=policy[operation];
  const result=await client.query(`INSERT INTO scorekeeper_operator_rate_windows(operator_id,operation,window_start_ms,used) VALUES($1,$2,$3,1)
   ON CONFLICT(operator_id,operation) DO UPDATE SET window_start_ms=EXCLUDED.window_start_ms,
   used=CASE WHEN scorekeeper_operator_rate_windows.window_start_ms<EXCLUDED.window_start_ms THEN 1 ELSE scorekeeper_operator_rate_windows.used+1 END
   WHERE scorekeeper_operator_rate_windows.window_start_ms<EXCLUDED.window_start_ms OR
   (scorekeeper_operator_rate_windows.window_start_ms=EXCLUDED.window_start_ms AND scorekeeper_operator_rate_windows.used<$4)
   RETURNING used`,[operatorId,operation,start,limit]);
  return {allowed:result.rows.length===1,retryAfter:Math.max(1,Math.ceil((start+windowMs-now)/1000))};
 };
}
