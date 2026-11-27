// Unregistered release-candidate composition. Explicitly requires the scoped
// assignment authority and per-operator budget on both operations.
import {createServiceDelegation} from './hub-service-delegation.proposed.js';
import {createTransactionalDelegation} from './hub-transactional-delegation.proposed.js';
import {createServicePublishHandler} from './hub-service-publish-handler.proposed.js';
import {createHubRevisionContext} from './hub-revision-context.proposed.js';
export function createScopedHubHandlers({credential,identityClient,resolveEvent,connect,rateLimiter,clock=Date.now}){
 if(typeof rateLimiter!=='function'||typeof resolveEvent!=='function'||typeof connect!=='function')throw new TypeError('Missing scoped release authority');
 const resolveDelegation=createServiceDelegation({client:identityClient,resolveEvent,clock,requireScope:true});
 const revalidate=createTransactionalDelegation({clock,requireScope:true});
 const config={credential,resolveDelegation,connect,revalidate,rateLimiter,requireScope:true};
 return {publish:createServicePublishHandler(config),context:createHubRevisionContext(config)};
}
