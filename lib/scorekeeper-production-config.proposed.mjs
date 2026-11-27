// Review-only production composition configuration. No route imports this yet.
const website='https://www.io4sports.com';
const hub='https://ftg-hub.vercel.app';
const issuer='https://login.microsoftonline.com/64cf4398-50de-432d-a370-93edc3ef2cfc/v2.0';
const clientId='4eaa1d9a-9a00-49c4-bd57-607bb614ad3a';
const databaseHost='ep-lingering-darkness-axmiqzs9.c-4.us-east-2.aws.neon.tech';
const dbName='neondb';
const roles={auth:'scorekeeper_prod_auth_login',hub:'scorekeeper_prod_publish_login'};
const gateKeys={auth:'IO4_SCOREKEEPER_AUTH_ENABLED',publish:'IO4_SCOREKEEPER_PUBLISH_ENABLED',hub:'IO4_SCOREKEEPER_HUB_ENABLED'};
const secret=(value)=>typeof value==='string'&&value.length>=32&&value.length<=4096;
export const productionTargets=Object.freeze({website,hub,issuer,clientId,redirectUri:website+'/api/scorekeeper-oidc-callback',databaseHost,dbName,roles:Object.freeze(roles)});
export function releaseGate(env,request,kind){
 if(!Object.hasOwn(gateKeys,kind)||env.VERCEL_ENV!=='production'||env.IO4_SCOREKEEPER_RELEASE_PROFILE!==(kind==='hub'?'hub-production-v1':'website-production-v1')||env[gateKeys[kind]]!=='true')return false;
 if(typeof request?.headers?.host!=='string'||request.headers.host!==new URL(kind==='hub'?hub:website).host)return false;
 return kind!=='publish'||env[gateKeys.auth]==='true';
}
export function restrictedDatabaseConfig(env,kind){
 if(!Object.hasOwn(roles,kind))throw Error('Unknown database role');
 const key=kind==='auth'?'IO4_SCOREKEEPER_AUTH_DATABASE_URL':'IO4_SCOREKEEPER_HUB_DATABASE_URL';
 const u=new URL(env[key]);
 if(u.protocol!=='postgresql:'||u.hostname!==databaseHost||u.port&&u.port!=='5432'||u.pathname!=='/'+dbName||u.username!==roles[kind]||!u.password||u.hash||[...u.searchParams.keys()].some(k=>!['sslmode','channel_binding'].includes(k)))throw Error('Unattested database scope');
 u.searchParams.set('sslmode','verify-full');u.searchParams.set('channel_binding','require');
 return {connectionString:u.href,max:2,connectionTimeoutMillis:5000,statement_timeout:5000,ssl:{rejectUnauthorized:true},enableChannelBinding:true};
}
export function oidcConfig(env){
 if(env.IO4_SCOREKEEPER_OIDC_ISSUER!==issuer||env.IO4_SCOREKEEPER_OIDC_CLIENT_ID!==clientId||env.IO4_SCOREKEEPER_OIDC_REDIRECT_URI!==productionTargets.redirectUri||!secret(env.IO4_SCOREKEEPER_OIDC_CLIENT_SECRET)||!secret(env.IO4_SCOREKEEPER_CSRF_SECRET))throw Error('Unattested Microsoft configuration');
 return {issuer,clientId,clientSecret:env.IO4_SCOREKEEPER_OIDC_CLIENT_SECRET,redirectUri:productionTargets.redirectUri,origin:website,csrfSecret:env.IO4_SCOREKEEPER_CSRF_SECRET,tokenAuthMethod:'client_secret_post',returnPath:'/scorekeeper'};
}
export function publishConfig(env){
 if(!secret(env.IO4_SCOREKEEPER_HUB_SERVICE_SECRET)||!secret(env.IO4_SCOREKEEPER_CSRF_SECRET))throw Error('Missing dedicated service credential');
 return {origin:website,csrfSecret:env.IO4_SCOREKEEPER_CSRF_SECRET,hubCredential:env.IO4_SCOREKEEPER_HUB_SERVICE_SECRET,publishEndpoint:hub+'/api/scorekeeper-service-publish',contextEndpoint:hub+'/api/scorekeeper-service-context'};
}
export function hubConfig(env){if(!secret(env.IO4_SCOREKEEPER_HUB_SERVICE_SECRET))throw Error('Missing dedicated service credential');return {credential:env.IO4_SCOREKEEPER_HUB_SERVICE_SECRET};}
