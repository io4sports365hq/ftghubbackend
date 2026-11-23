'use strict';
// Isolated authorization gate; no HTTP endpoint and no Hub credentials.
// loadSession/loadAssignment MUST use trusted server-side stores.
const {authorizeAssignedCapture}=require('./scorekeeper-assignment-contract.cjs');
async function authorizeAdapterRequest({request,nowMs,loadSession,loadAssignment}) {
 if(!request || request.method!=='POST')return {status:405,reason:'method'};
 if(request.csrfVerified!==true)return {status:403,reason:'csrf'};
 if(typeof loadSession!=='function'||typeof loadAssignment!=='function')
  throw new TypeError('Missing trusted identity providers');
 let session;
 try{session=await loadSession();}catch{return {status:503,reason:'identity_unavailable'};}
 if(!session || session.verified!==true || session.revoked!==false ||
    !Number.isSafeInteger(session.expiresAtMs) || session.expiresAtMs<=nowMs)
  return {status:401,reason:'session'};
 let assignment;
 try{assignment=await loadAssignment(session.operatorId);}catch{return {status:503,reason:'assignment_unavailable'};}
 const decision=authorizeAssignedCapture({session,assignment,request:request.binding,nowMs});
 if(!decision.allowed)return {status:403,reason:decision.reason};
 return {status:200,binding:decision.binding};
}
module.exports={authorizeAdapterRequest};
