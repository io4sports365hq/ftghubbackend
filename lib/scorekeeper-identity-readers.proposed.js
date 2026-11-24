// Draft-only identity readers. No route registration or session issuance.
import {createHash} from 'node:crypto';
function assignment(r){
 const from=new Date(r.valid_from).getTime();
 return {operatorId:r.operator_id,eventSlug:r.event_slug,gameNumber:r.game_number,captureId:r.capture_id,expiresAtMs:new Date(r.expires_at).getTime(),revoked:r.revoked_at!==null,active:r.active===true,verified:true,...(r.scope!=null?{scope:r.scope}:{}),...(Number.isSafeInteger(from)?{validFromMs:from}:{})};
}
export function createIdentityReaders(client) {
 if(typeof client?.query!=='function')throw new TypeError('Missing identity store');
 return {
  async resolveOperator({issuer,subject}={}){
   if(typeof issuer!=='string'||typeof subject!=='string'||!issuer||!subject||issuer.length>2048||subject.length>256)return null;
   const {rows}=await client.query('SELECT operator_id FROM scorekeeper_operators WHERE issuer=$1 AND subject=$2 AND active=true AND revoked_at IS NULL',[issuer,subject]);
   return rows.length===1?{operatorId:rows[0].operator_id,active:true}:null;
  },
  async loadActiveOperator(operatorId){
   if(typeof operatorId!=='string'||!operatorId||operatorId.length>256)return false;
   const {rows}=await client.query('SELECT operator_id FROM scorekeeper_operators WHERE operator_id=$1 AND active=true AND revoked_at IS NULL',[operatorId]);
   return rows.length===1&&rows[0].operator_id===operatorId;
  },
  async loadSession(token) {
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
   const hash=createHash('sha256').update(token).digest('hex');
   const {rows}=await client.query('SELECT operator_id,expires_at,revoked_at,idle_expires_at FROM scorekeeper_operator_sessions WHERE token_hash=$1',[hash]);
   if(rows.length!==1)return null;
   const r=rows[0];
   if(r.idle_expires_at==null)return null;
   return {operatorId:r.operator_id,expiresAtMs:Math.min(new Date(r.expires_at).getTime(),new Date(r.idle_expires_at).getTime()),revoked:r.revoked_at!==null,verified:true};
  },
  async loadAssignment(operatorId,binding) {
   if(typeof operatorId!=='string'||!binding||typeof binding.eventSlug!=='string'||typeof binding.gameNumber!=='string'||typeof binding.captureId!=='string')return null;
   const {rows}=await client.query('SELECT operator_id,event_slug,game_number,capture_id,expires_at,revoked_at,active,valid_from,scope FROM scorekeeper_operator_assignments WHERE operator_id=$1 AND event_slug=$2 AND game_number=$3 AND capture_id=$4',[operatorId,binding.eventSlug,binding.gameNumber,binding.captureId]);
   if(rows.length!==1)return null;
   return assignment(rows[0]);
  },
  async loadAssignmentForCapture(operatorId,{captureId,gameNumber}={}) {
   if(typeof operatorId!=='string'||typeof captureId!=='string'||typeof gameNumber!=='string')return null;
   const {rows}=await client.query('SELECT operator_id,event_slug,game_number,capture_id,expires_at,revoked_at,active,valid_from,scope FROM scorekeeper_operator_assignments WHERE operator_id=$1 AND game_number=$2 AND capture_id=$3 AND active=true AND revoked_at IS NULL',[operatorId,gameNumber,captureId]);
   // Never pick an arbitrary event when the same local capture is ambiguous.
   if(rows.length!==1)return null;
   return assignment(rows[0]);
  }
 };
}

