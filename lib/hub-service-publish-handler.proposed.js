// Unregistered service bridge. A service credential alone never authorizes a game.
// resolveDelegation must independently verify the operator and exact assignment.
import {createHash,timingSafeEqual} from 'node:crypto';
import {createDraftPublishHandler} from './hub-publish-handler.proposed.js';
export function createServicePublishHandler({credential,resolveDelegation,connect}){
 if(typeof credential!=='string'||Buffer.byteLength(credential)<32||typeof resolveDelegation!=='function'||typeof connect!=='function')throw new TypeError('Missing trusted configuration');
 const digest=value=>createHash('sha256').update(value).digest();
 const expected=digest(credential);
 return createDraftPublishHandler({connect,authorize:async req=>{
  const supplied=req.headers?.['x-ftg-publish-token'];
  if(typeof supplied!=='string'||supplied.length>1024||!timingSafeEqual(digest(supplied),expected))return null;
  const binding=req.body?.binding;
  if(!binding||typeof binding.eventSlug!=='string'||typeof binding.gameNumber!=='string'||typeof binding.captureId!=='string')return null;
  const verified=await resolveDelegation(req,binding);
  if(!verified||verified.verified!==true||verified.eventSlug!==binding.eventSlug||verified.gameNumber!==binding.gameNumber||verified.captureId!==binding.captureId||!Number.isSafeInteger(verified.eventId)||verified.eventId<1)return null;
  return {eventId:verified.eventId,gameNumber:verified.gameNumber,captureId:verified.captureId};
 }});
}
