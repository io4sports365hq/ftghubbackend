// Draft-only identity readers. No route registration or session issuance.
import {createHash} from 'node:crypto';
export function createIdentityReaders(client) {
 if(typeof client?.query!=='function')throw new TypeError('Missing identity store');
 return {
  async loadSession(token) {
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
   const hash=createHash('sha256').update(token).digest('hex');
   const {rows}=await client.query('SELECT operator_id,expires_at,revoked_at FROM scorekeeper_operator_sessions WHERE token_hash=$1',[hash]);
   if(rows.length!==1)return null;
   const r=rows[0];
   return {operatorId:r.operator_id,expiresAtMs:new Date(r.expires_at).getTime(),revoked:r.revoked_at!==null,verified:true};
  },
  async loadAssignment(operatorId,binding) {
   if(typeof operatorId!=='string'||!binding||typeof binding.eventSlug!=='string'||typeof binding.gameNumber!=='string'||typeof binding.captureId!=='string')return null;
   const {rows}=await client.query('SELECT operator_id,event_slug,game_number,capture_id,expires_at,revoked_at,active FROM scorekeeper_operator_assignments WHERE operator_id=$1 AND event_slug=$2 AND game_number=$3 AND capture_id=$4',[operatorId,binding.eventSlug,binding.gameNumber,binding.captureId]);
   if(rows.length!==1)return null;
   const r=rows[0];
   return {operatorId:r.operator_id,eventSlug:r.event_slug,gameNumber:r.game_number,captureId:r.capture_id,expiresAtMs:new Date(r.expires_at).getTime(),revoked:r.revoked_at!==null,active:r.active===true,verified:true};
  }
 };
}
