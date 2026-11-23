'use strict';
// Isolated proof-of-boundary only. Not an HTTP endpoint and never imported by
// api/publish.js. No Hub secret is read or forwarded by this module.
const {authorizeAdapterRequest}=require('./scorekeeper-adapter-gate.cjs');
async function dispatchAuthorizedFixture({request,nowMs,loadSession,loadAssignment,sendFixture}) {
 const decision=await authorizeAdapterRequest({request,nowMs,loadSession,loadAssignment});
 if(decision.status!==200)return decision;
 if(typeof sendFixture!=='function')throw new TypeError('Missing isolated fixture transport');
 // Only the server-authorized binding is forwarded; never trust browser IDs.
 try {
  return await sendFixture(decision.binding);
 } catch {
  // Do not expose transport errors, credentials, or upstream response bodies.
  return {status:503,reason:'publish_transport_unavailable'};
 }
}
module.exports={dispatchAuthorizedFixture};
