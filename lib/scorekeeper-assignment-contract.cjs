'use strict';
// Isolated contract helper. Never imported by the live Hub handler.
// All identity/assignment inputs MUST originate from verified server records.
function authorizeAssignedCapture({session,assignment,request,nowMs}) {
 if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new TypeError('Invalid clock');
 if(!session || !assignment || !request ||
    typeof session.operatorId!=='string' || !session.operatorId ||
    typeof assignment.operatorId!=='string' ||
    !Number.isSafeInteger(session.expiresAtMs) ||
    !Number.isSafeInteger(assignment.expiresAtMs) ||
    session.revoked===true || assignment.revoked===true ||
    session.expiresAtMs<=nowMs || assignment.expiresAtMs<=nowMs)
  return {allowed:false,reason:'unauthorized'};
 if(assignment.operatorId!==session.operatorId ||
    assignment.active!==true ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(assignment.eventSlug) ||
    !/^[1-9][0-9]{0,9}$/.test(String(assignment.gameNumber)) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(assignment.captureId))
  return {allowed:false,reason:'unassigned'};
 if(request.eventSlug!==assignment.eventSlug ||
    String(request.gameNumber)!==String(assignment.gameNumber) ||
    request.captureId!==assignment.captureId)
  return {allowed:false,reason:'capture_mismatch'};
 return {allowed:true,binding:Object.freeze({
  eventSlug:assignment.eventSlug,
  gameNumber:String(assignment.gameNumber),
  captureId:assignment.captureId
 })};
}
module.exports={authorizeAssignedCapture};
