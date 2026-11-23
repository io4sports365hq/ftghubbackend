import {createIdentityReaders} from './scorekeeper-identity-readers.proposed.js';
// Draft: opaque operator session is forwarded only by the authenticated server.
export function createServiceDelegation({client,resolveEvent,clock=Date.now}){
 const readers=createIdentityReaders(client);
 return async(req,binding)=>{
  const session=await readers.loadSession(req.headers?.['x-ftg-operator-session']);
  const now=clock();
  if(!Number.isSafeInteger(now)||!session||session.verified!==true||session.revoked!==false||!Number.isSafeInteger(session.expiresAtMs)||session.expiresAtMs<=now)return null;
  const a=await readers.loadAssignment(session.operatorId,binding);
  if(!a||a.verified!==true||a.revoked!==false||a.active!==true||!Number.isSafeInteger(a.expiresAtMs)||a.expiresAtMs<=now)return null;
  const event=await resolveEvent(a.eventSlug);
  const end=clock();
  if(!Number.isSafeInteger(end)||session.expiresAtMs<=end||a.expiresAtMs<=end||!event||event.slug!==a.eventSlug||!Number.isSafeInteger(event.id)||event.id<1)return null;
  return {verified:true,eventId:event.id,eventSlug:a.eventSlug,gameNumber:a.gameNumber,captureId:a.captureId};
 };
}
