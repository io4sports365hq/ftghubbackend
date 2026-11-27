// Unregistered, read-only revision context for authenticated Scorekeeper service.
import {createServiceAuthorization} from './hub-service-publish-handler.proposed.js';

export function createHubRevisionContext({credential,resolveDelegation,connect,revalidate,rateLimiter,requireScope=false}){
 const authorize=createServiceAuthorization({credential,resolveDelegation});
 if(typeof connect!=='function'||typeof revalidate!=='function')throw new TypeError('Missing trusted revision authority');
 if(rateLimiter!==undefined&&typeof rateLimiter!=='function'||requireScope&&typeof rateLimiter!=='function')throw new TypeError('Missing scoped release controls');
 return async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false});
  let client;
  try{
   const b=req.body?.binding;
   if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==1||Buffer.byteLength(JSON.stringify(req.body))>2048)return res.status(400).json({ok:false});
   if(!b||typeof b.eventSlug!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(b.eventSlug)||typeof b.gameNumber!=='string'||!/^[1-9][0-9]{0,9}$/.test(b.gameNumber)||typeof b.captureId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(b.captureId))return res.status(400).json({ok:false});
   const binding=await authorize(req);if(!binding)return res.status(403).json({ok:false});
   if(rateLimiter){const budget=await rateLimiter(binding.operatorId,'hub_context');if(!budget||typeof budget.allowed!=='boolean'||!Number.isSafeInteger(budget.retryAfter)||budget.retryAfter<1)return res.status(503).json({ok:false});if(!budget.allowed){res.setHeader('Retry-After',String(budget.retryAfter));return res.status(429).json({ok:false});}}
   client=await connect();await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(binding.eventId),binding.gameNumber]);
   if(await revalidate(client,req,binding)!==true){await client.query('ROLLBACK');return res.status(403).json({ok:false});}
   const event=(await client.query('SELECT id FROM ftg_events WHERE id=$1 FOR SHARE',[binding.eventId])).rows[0];
   const version=(await client.query('SELECT external_game_id,revision FROM scorekeeper_publish_versions WHERE event_id=$1 AND game_number=$2 FOR SHARE',[binding.eventId,binding.gameNumber])).rows[0];
   const game=(await client.query('SELECT external_game_id FROM ftg_games WHERE event_id=$1 AND game_number=$2 FOR SHARE',[binding.eventId,binding.gameNumber])).rows[0];
   if(!event||(version&&(!game||version.external_game_id!==binding.captureId||game.external_game_id!==binding.captureId))||(!version&&game)){await client.query('ROLLBACK');return res.status(409).json({ok:false});}
   const revision=version?Number(version.revision):0;
   if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw new Error('Invalid revision');
   await client.query('COMMIT');return res.status(200).json({ok:true,revision});
  }catch{if(client)await client.query('ROLLBACK').catch(()=>{});return res.status(503).json({ok:false});}
  finally{if(client)client.release();}
 };
}
