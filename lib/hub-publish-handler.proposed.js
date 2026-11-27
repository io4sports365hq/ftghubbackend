// Draft handler factory; deliberately not registered as an API route.
// Trusted dependencies must verify server authentication and operator assignment.
import {commitHubPublish} from './hub-atomic-publish.proposed.js';
import {evaluateScopedPayload} from './scorekeeper-assignment-scope.proposed.js';
export function createDraftPublishHandler({authorize,connect,revalidate,rateLimiter,requireScope=false}) {
 if(rateLimiter!==undefined&&typeof rateLimiter!=='function'||requireScope&&(typeof rateLimiter!=='function'||typeof revalidate!=='function'))throw new TypeError('Missing scoped release controls');
 return async function handler(req,res) {
  if(req.method!=='POST')return res.status(405).json({ok:false});
  let binding;
  try {binding=await authorize(req);} catch {return res.status(503).json({ok:false,error:'Authorization unavailable'});}
  if(!binding)return res.status(403).json({ok:false,error:'Forbidden'});
  const body=req.body;
  if(!body || typeof body!=='object' || Array.isArray(body) ||
     (body.operation!==undefined&&body.operation!=='publish'&&body.operation!=='receipt_lookup') ||
     !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0 ||
     typeof body.idempotencyKey!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.idempotencyKey) ||
     !body.game || typeof body.game!=='object'||Array.isArray(body.game)||
     !Array.isArray(body.players)||body.players.length>200||
     body.players.some(p=>!p||typeof p!=='object'||Array.isArray(p)))
   return res.status(400).json({ok:false,error:'Invalid payload'});
  try {if(Buffer.byteLength(JSON.stringify(body))>131072)return res.status(400).json({ok:false,error:'Invalid payload'});}
  catch{return res.status(400).json({ok:false,error:'Invalid payload'});}
  if(rateLimiter){try{const budget=await rateLimiter(binding.operatorId,body.operation==='receipt_lookup'?'hub_receipt':'hub_publish');if(!budget||typeof budget.allowed!=='boolean'||!Number.isSafeInteger(budget.retryAfter)||budget.retryAfter<1)return res.status(503).json({ok:false});if(!budget.allowed){res.setHeader('Retry-After',String(budget.retryAfter));return res.status(429).json({ok:false});}}catch{return res.status(503).json({ok:false});}}
  if(requireScope){const status=evaluateScopedPayload(binding.scope,body.game,body.players);if(status!==200)return res.status(status).json({ok:false});}
  let client;
  try {
   client=await connect();
   const result=await commitHubPublish(client,{eventId:binding.eventId,gameNumber:binding.gameNumber,captureId:binding.captureId,
    expectedRevision:body.expectedRevision,idempotencyKey:body.idempotencyKey,game:body.game,players:body.players},
    {revalidate:revalidate?tx=>revalidate(tx,req,binding):undefined,lookupOnly:body.operation==='receipt_lookup'});
   return res.status(result.status).json({ok:result.status===200,...result});
  } catch {return res.status(503).json({ok:false,error:'Publish unavailable'});}
  finally {if(client)client.release();}
 };
}

