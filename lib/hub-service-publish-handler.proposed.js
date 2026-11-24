// Unregistered service bridge. A service credential alone never authorizes a game.
// resolveDelegation must independently verify the operator and exact assignment.
import {createHash,timingSafeEqual} from 'node:crypto';
import {createDraftPublishHandler} from './hub-publish-handler.proposed.js';
import {validHubEventId} from './scorekeeper-event-id.proposed.js';
export function createServicePublishHandler({credential,resolveDelegation,connect,revalidate,rateLimiter,requireScope=false}){
 if(typeof connect!=='function')throw new TypeError('Missing trusted configuration');
 if(revalidate!==undefined&&typeof revalidate!=='function')throw new TypeError('Invalid commit authorization provider');
 return createDraftPublishHandler({connect,revalidate,rateLimiter,requireScope,authorize:createServiceAuthorization({credential,resolveDelegation})});
}
// Shared independently verified service authorization for publish and read-only context.
export function createServiceAuthorization({credential,resolveDelegation}){
 if(typeof credential!=='string'||Buffer.byteLength(credential)<32||typeof resolveDelegation!=='function')throw new TypeError('Missing trusted configuration');
 const digest=value=>createHash('sha256').update(value).digest();
 const expected=digest(credential);
 return async req=>{
  const supplied=req.headers?.['x-ftg-publish-token'];
  if(typeof supplied!=='string'||supplied.length>1024||!timingSafeEqual(digest(supplied),expected))return null;
  const binding=req.body?.binding;
  if(!binding||typeof binding.eventSlug!=='string'||typeof binding.gameNumber!=='string'||typeof binding.captureId!=='string')return null;
  const verified=await resolveDelegation(req,binding);
  if(!verified||verified.verified!==true||verified.eventSlug!==binding.eventSlug||verified.gameNumber!==binding.gameNumber||verified.captureId!==binding.captureId||!validHubEventId(verified.eventId))return null;
  return {eventId:verified.eventId,gameNumber:verified.gameNumber,captureId:verified.captureId,...(typeof verified.operatorId==='string'?{operatorId:verified.operatorId}:{}),...(verified.scope?{scope:verified.scope}:{})};
 };
}

