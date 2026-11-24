export function createStagingLoginBudget(client,{clock=Date.now,limit=25,windowMs=60000}={}){
 if(typeof client?.query!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>3600000)throw new TypeError('Invalid login budget');
 return async()=>{
  const now=clock();if(!Number.isSafeInteger(now)||now<0)throw new Error('Clock unavailable');
  const start=Math.floor(now/windowMs)*windowMs;
  const result=await client.query(`INSERT INTO public.scorekeeper_staging_login_budget(slot,window_start_ms,used) VALUES(true,$1,1)
    ON CONFLICT(slot) DO UPDATE SET window_start_ms=EXCLUDED.window_start_ms,used=CASE WHEN scorekeeper_staging_login_budget.window_start_ms<EXCLUDED.window_start_ms THEN 1 ELSE scorekeeper_staging_login_budget.used+1 END
    WHERE scorekeeper_staging_login_budget.window_start_ms<EXCLUDED.window_start_ms OR (scorekeeper_staging_login_budget.window_start_ms=EXCLUDED.window_start_ms AND scorekeeper_staging_login_budget.used<$2) RETURNING used`,[start,limit]);
  return {allowed:result.rows.length===1,retryAfter:Math.max(1,Math.ceil((start+windowMs-now)/1000))};
 };
}
