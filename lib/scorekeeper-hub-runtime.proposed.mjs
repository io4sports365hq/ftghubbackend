// Hub server-only composition. Both requests independently validate service
// identity, operator session, exact assignment and transactional revision.
import pg from 'pg';
import {createProductionRoutes} from './scorekeeper-production-routes.proposed.mjs';
import {createScopedHubHandlers} from './hub-scoped-release-handlers.proposed.js';
import {createScorekeeperRateLimiter} from './scorekeeper-rate-limiter.proposed.js';
export const routes=createProductionRoutes({env:process.env,pg,createScopedHubHandlers,createScorekeeperRateLimiter});
