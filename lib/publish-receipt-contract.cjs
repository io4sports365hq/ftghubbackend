'use strict';
// Draft-only protocol decision helper. NOT wired to api/publish.js.
// This cannot replace atomic database checks or authenticated assignments.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function decideReceipt({stored,request}={}) {
 if (!request || typeof request!=='object' ||
     typeof request.captureId!=='string' || !ID.test(request.captureId) ||
     typeof request.idempotencyKey!=='string' || !ID.test(request.idempotencyKey) ||
     typeof request.payloadDigest!=='string' || !/^[a-f0-9]{64}$/.test(request.payloadDigest) ||
     !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision<0)
   return {status:400,action:'reject'};
 if (stored==null) return request.expectedRevision===0?
   {status:200,action:'insert',nextRevision:1}:{status:409,action:'conflict'};
 if (!stored.captureId || !Number.isSafeInteger(stored.revision) ||
     stored.revision<1 || !Array.isArray(stored.receipts))
   return {status:409,action:'legacy_conflict'};
 if (stored.captureId!==request.captureId) return {status:409,action:'capture_conflict'};
 const prior=stored.receipts.find(x=>x.idempotencyKey===request.idempotencyKey);
 if(prior) {
   if(prior.payloadDigest===request.payloadDigest &&
      prior.expectedRevision===request.expectedRevision &&
      Number.isSafeInteger(prior.committedRevision) &&
      prior.committedRevision>0 && prior.committedRevision<=stored.revision &&
      typeof prior.receiptId==='string' && ID.test(prior.receiptId))
     return {status:200,action:'replay',receiptId:prior.receiptId,committedRevision:prior.committedRevision};
   return {status:409,action:'idempotency_conflict'};
 }
 if(request.expectedRevision!==stored.revision) return {status:409,action:'stale_revision'};
 return {status:200,action:'update',nextRevision:stored.revision+1};
}
module.exports={decideReceipt};
