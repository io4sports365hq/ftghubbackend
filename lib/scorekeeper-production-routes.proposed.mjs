// Review-only composition factory. Dependencies are the separately approved
// pinned scorer/backend modules, never supplied by a browser request.
import {createHash} from 'node:crypto';
import {releaseGate,restrictedDatabaseConfig,oidcConfig,publishConfig,hubConfig,productionTargets} from './scorekeeper-production-config.proposed.mjs';
const limits=Object.freeze({scorer_context:30,scorer_publish:10,scorer_receipt:30,hub_context:30,hub_publish:10,hub_receipt:30});
function loginBudget(db,clock=Date.now){return async()=>{const now=clock();if(!Number.isSafeInteger(now)||now<0)throw Error('Clock unavailable');const start=Math.floor(now/60000)*60000;const {rows}=await db.query(`INSERT INTO public.scorekeeper_login_budget(slot,window_start_ms,used) VALUES(true,$1,1) ON CONFLICT(slot) DO UPDATE SET window_start_ms=EXCLUDED.window_start_ms,used=CASE WHEN scorekeeper_login_budget.window_start_ms<EXCLUDED.window_start_ms THEN 1 ELSE scorekeeper_login_budget.used+1 END WHERE scorekeeper_login_budget.window_start_ms<EXCLUDED.window_start_ms OR (scorekeeper_login_budget.window_start_ms=EXCLUDED.window_start_ms AND scorekeeper_login_budget.used<25) RETURNING used`,[start]);return {allowed:rows.length===1,retryAfter:Math.max(1,Math.ceil((start+60000-now)/1000))};};}
export function createProductionRoutes({env,pg,library,createIdentityReaders,createSessionWriter,createOidcFlowStore,createScorekeeperAuthHandlers,createRequestSecurity,createScorekeeperSessionContext,createScorekeeperLogout,createScopedScorekeeperHandlers,createScopedHubHandlers,createScorekeeperRateLimiter}){
 let authPool,hubPool;
 const auth=()=>authPool??=new pg.Pool(restrictedDatabaseConfig(env,'auth'));
 const hub=()=>hubPool??=new pg.Pool(restrictedDatabaseConfig(env,'hub'));
 const protectedRoute=(kind,method,run)=>async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!==method){res.setHeader('Allow',method);return res.status(405).json({ok:false});}
  if(!releaseGate(env,req,kind))return res.status(503).json({ok:false,error:'Scorekeeper release is disabled'});
  try{return await run(req,res);}catch{return res.status(503).json({ok:false});}
 };
 const login=route=>protectedRoute('auth',route==='callback'?'GET':'POST',async(req,res)=>{
  const cfg=oidcConfig(env),db=auth(),identity=createIdentityReaders(db),writer=createSessionWriter(db);let enrollmentIdentifier;
  const resolveOperator=async ({issuer,subject})=>{if(issuer!==cfg.issuer)return null;const encoded=createHash('sha256').update('io4-production-entra-v1\0'+issuer+'\0'+subject).digest('hex');const operator=await identity.resolveOperator({issuer,subject:encoded});if(!operator)enrollmentIdentifier=encoded;return operator;};
  const handlers=await createScorekeeperAuthHandlers({...cfg,library,identity:{...identity,resolveOperator},sessionWriter:writer,flowStore:createOidcFlowStore(db),limitLogin:loginBudget(db)});
  if(route==='begin')return handlers.begin(req,res);
  const wrapped={setHeader:(...args)=>res.setHeader(...args),status(n){res.status(n);return this;},end(){return res.end();},json(value){return res.json(enrollmentIdentifier?{ok:false,message:'Microsoft identity verified; operator enrollment required.',enrollmentIdentifier}:value);}};
  return handlers.callback(req,wrapped);
 });
 const session=route=>protectedRoute('auth','POST',async(req,res)=>{const cfg=oidcConfig(env),db=auth(),identity=createIdentityReaders(db),writer=createSessionWriter(db);const security=createRequestSecurity({origin:cfg.origin,csrfSecret:cfg.csrfSecret,lookupSession:identity.loadSession});return (route==='context'?createScorekeeperSessionContext({origin:cfg.origin,csrfSecret:cfg.csrfSecret,identity}):createScorekeeperLogout({verifyCsrf:security.verifyCsrf,revokeSession:writer.revokeSession}))(req,res);});
 const publish=route=>protectedRoute('publish','POST',async(req,res)=>{const cfg=publishConfig(env),db=auth(),writer=createSessionWriter(db);return createScopedScorekeeperHandlers({...cfg,identity:createIdentityReaders(db),touchSession:writer.touchSession,rateLimiter:createScorekeeperRateLimiter(db,{limits,windowMs:60000})})[route](req,res);});
 const service=route=>protectedRoute('hub','POST',async(req,res)=>{const cfg=hubConfig(env),db=hub();return createScopedHubHandlers({...cfg,identityClient:db,connect:()=>db.connect(),resolveEvent:async slug=>{const {rows}=await db.query('SELECT id,slug FROM public.ftg_events WHERE slug=$1',[slug]);return rows.length===1?rows[0]:null;},rateLimiter:createScorekeeperRateLimiter(db,{limits,windowMs:60000})})[route](req,res);});
 return Object.freeze({oidcStart:login('begin'),oidcCallback:login('callback'),sessionContext:session('context'),logout:session('logout'),publishContext:publish('context'),publish:publish('publish'),hubContext:service('context'),hubPublish:service('publish')});
}
