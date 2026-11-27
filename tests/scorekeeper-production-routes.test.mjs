import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseGate,restrictedDatabaseConfig,oidcConfig,publishConfig,hubConfig,productionTargets as t} from '../lib/scorekeeper-production-config.proposed.mjs';
import {createProductionRoutes} from '../lib/scorekeeper-production-routes.proposed.mjs';
const env={VERCEL_ENV:'production',IO4_SCOREKEEPER_RELEASE_PROFILE:'website-production-v1',IO4_SCOREKEEPER_AUTH_ENABLED:'true',IO4_SCOREKEEPER_PUBLISH_ENABLED:'true',IO4_SCOREKEEPER_OIDC_ISSUER:t.issuer,IO4_SCOREKEEPER_OIDC_CLIENT_ID:t.clientId,IO4_SCOREKEEPER_OIDC_REDIRECT_URI:t.redirectUri,IO4_SCOREKEEPER_OIDC_CLIENT_SECRET:'fictional-secret-not-real-'.repeat(2),IO4_SCOREKEEPER_CSRF_SECRET:'fictional-csrf-not-real-'.repeat(2),IO4_SCOREKEEPER_HUB_SERVICE_SECRET:'fictional-service-not-real-'.repeat(2),IO4_SCOREKEEPER_AUTH_DATABASE_URL:`postgresql://${t.roles.auth}:fictional@${t.databaseHost}/${t.dbName}?sslmode=require`,IO4_SCOREKEEPER_HUB_DATABASE_URL:`postgresql://${t.roles.hub}:fictional@${t.databaseHost}/${t.dbName}?sslmode=require`};
const request={method:'POST',headers:{host:new URL(t.website).host,origin:t.website}};
test('production gates require exact environment, profile, flag and host',()=>{
 assert.equal(releaseGate(env,request,'auth'),true);assert.equal(releaseGate(env,request,'publish'),true);
 for(const change of [{VERCEL_ENV:'preview'},{VERCEL_ENV:'development'},{IO4_SCOREKEEPER_RELEASE_PROFILE:'staging'},{IO4_SCOREKEEPER_PUBLISH_ENABLED:'false'},{IO4_SCOREKEEPER_AUTH_ENABLED:undefined}])assert.equal(releaseGate({...env,...change},request,'publish'),false);
 assert.equal(releaseGate(env,{...request,headers:{host:'other.invalid'}},'auth'),false);
 assert.equal(releaseGate(env,request,'hub'),false);assert.equal(releaseGate({...env,IO4_SCOREKEEPER_RELEASE_PROFILE:'hub-production-v1',IO4_SCOREKEEPER_HUB_ENABLED:'true'},{headers:{host:new URL(t.hub).host}},'hub'),true);
});
test('configuration rejects cross-role, wrong database, wrong Microsoft tenant and unsafe TLS options without connecting',()=>{
 const cfg=restrictedDatabaseConfig(env,'auth');assert.equal(new URL(cfg.connectionString).searchParams.get('sslmode'),'verify-full');assert.equal(cfg.ssl.rejectUnauthorized,true);assert.equal(cfg.enableChannelBinding,true);
 for(const wrong of [env.IO4_SCOREKEEPER_HUB_DATABASE_URL,env.IO4_SCOREKEEPER_AUTH_DATABASE_URL.replace(t.databaseHost,'example.invalid'),env.IO4_SCOREKEEPER_AUTH_DATABASE_URL.replace('/neondb','/other'),env.IO4_SCOREKEEPER_AUTH_DATABASE_URL+'&uselibpqcompat=true'])assert.throws(()=>restrictedDatabaseConfig({...env,IO4_SCOREKEEPER_AUTH_DATABASE_URL:wrong},'auth'));
 assert.throws(()=>oidcConfig({...env,IO4_SCOREKEEPER_OIDC_CLIENT_ID:'staging-client'}));assert.equal(oidcConfig(env).returnPath,'/scorekeeper');assert.equal(publishConfig(env).publishEndpoint,t.hub+'/api/scorekeeper-service-publish');assert.equal(hubConfig(env).credential,env.IO4_SCOREKEEPER_HUB_SERVICE_SECRET);
});
test('all eight routes remain fail-closed with no database construction or provider calls when release disabled',async()=>{
 let connections=0,calls=0;const no=()=>{calls++;throw Error('Unexpected execution');};
 const routes=createProductionRoutes({env:{...env,IO4_SCOREKEEPER_AUTH_ENABLED:'false',IO4_SCOREKEEPER_PUBLISH_ENABLED:'false',IO4_SCOREKEEPER_HUB_ENABLED:'false'},pg:{Pool:class{constructor(){connections++;throw Error('Unexpected connection');}}},library:{},createIdentityReaders:no,createSessionWriter:no,createOidcFlowStore:no,createScorekeeperAuthHandlers:no,createRequestSecurity:no,createScorekeeperSessionContext:no,createScorekeeperLogout:no,createScopedScorekeeperHandlers:no,createScopedHubHandlers:no,createScorekeeperRateLimiter:no});
 for(const [name,handler] of Object.entries(routes)){let status;const req={...request,method:name==='oidcCallback'?'GET':'POST',headers:{...request.headers,host:name.startsWith('hub')?new URL(t.hub).host:request.headers.host}};await handler(req,{setHeader(){},status(n){status=n;return this;},json(){}});assert.equal(status,503,name);}
 assert.equal(connections,0);assert.equal(calls,0);
});
