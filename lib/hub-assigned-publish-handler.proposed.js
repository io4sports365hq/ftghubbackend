// Unregistered draft composition. Trusted providers must be supplied by the server.
import gate from './scorekeeper-adapter-gate.cjs';
import {createDraftPublishHandler} from './hub-publish-handler.proposed.js';
export function createAssignedPublishHandler({verifyCsrf,loadSession,loadAssignment,resolveEvent,connect,clock=Date.now}) {
 for(const fn of [verifyCsrf,loadSession,loadAssignment,resolveEvent,connect,clock])
  if(typeof fn!=='function')throw new TypeError('Missing trusted provider');
 return createDraftPublishHandler({connect,authorize:async req=>{
  const decision=await gate.authorizeAdapterRequest({
   request:{method:req.method,csrfVerified:await verifyCsrf(req),binding:req.body?.binding},
   nowMs:clock(),loadSession:()=>loadSession(req),loadAssignment
  });
  if(decision.status===503)throw Error('Authorization unavailable');
  if(decision.status!==200)return null;
  const event=await resolveEvent(decision.binding.eventSlug);
  if(!event||event.slug!==decision.binding.eventSlug||!Number.isSafeInteger(event.id)||event.id<1)return null;
  return {eventId:event.id,gameNumber:decision.binding.gameNumber,captureId:decision.binding.captureId};
 }});
}
