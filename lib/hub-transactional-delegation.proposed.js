// Review-only prototype for an isolated, colocated identity authority and Hub database.
// Not appropriate for production until the identity-store architecture is approved.
import {createHash} from 'node:crypto';
import {validAssignmentScope,evaluateScopedPayload} from './scorekeeper-assignment-scope.proposed.js';
export function createTransactionalDelegation({clock=Date.now,requireScope=false}={}){
 if(typeof clock!=='function')throw new TypeError('Invalid clock');
 return async function revalidate(tx,req,binding){
  const token=req.headers?.['x-ftg-operator-session'],claimed=req.body?.binding;
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||!claimed||claimed.gameNumber!==binding.gameNumber||claimed.captureId!==binding.captureId)return false;
  const hash=createHash('sha256').update(token).digest('hex');
  // Match directory deactivation/session issuance lock order: operator first.
  if(requireScope){if(typeof binding.operatorId!=='string'||!binding.operatorId)return false;const {rows}=await tx.query('SELECT operator_id FROM scorekeeper_operators WHERE operator_id=$1 AND active=true AND revoked_at IS NULL FOR SHARE',[binding.operatorId]);if(rows.length!==1)return false;}
  // FOR SHARE makes revocation updates wait until this publish finishes, or
  // observes revocation first if its UPDATE won the lock before this recheck.
  const {rows:sessions}=await tx.query('SELECT operator_id,expires_at,revoked_at,idle_expires_at FROM scorekeeper_operator_sessions WHERE token_hash=$1 FOR SHARE',[hash]);
  const session=sessions[0];if(!session||session.revoked_at!==null)return false;
  if(requireScope&&session.operator_id!==binding.operatorId)return false;
  const {rows:assignments}=await tx.query('SELECT expires_at,revoked_at,active,valid_from,scope FROM scorekeeper_operator_assignments WHERE operator_id=$1 AND event_slug=$2 AND game_number=$3 AND capture_id=$4 FOR SHARE',[session.operator_id,claimed.eventSlug,binding.gameNumber,binding.captureId]);
  const assignment=assignments[0];if(!assignment||assignment.revoked_at!==null||assignment.active!==true)return false;
  const {rows:events}=await tx.query('SELECT id FROM ftg_events WHERE id=$1 AND slug=$2 FOR SHARE',[binding.eventId,claimed.eventSlug]);
  const now=clock();
  if(requireScope&&(!validAssignmentScope(assignment.scope)||!Number.isSafeInteger(new Date(assignment.valid_from).getTime())||new Date(assignment.valid_from).getTime()>now||(req.body.game!==undefined&&evaluateScopedPayload(assignment.scope,req.body.game,req.body.players)!==200)))return false;
  return events.length===1&&Number.isSafeInteger(now)&&new Date(session.expires_at).getTime()>now&&session.idle_expires_at!=null&&new Date(session.idle_expires_at).getTime()>now&&new Date(assignment.expires_at).getTime()>now;
 };
}
