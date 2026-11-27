import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {commitHubPublish} from '../lib/hub-atomic-publish.proposed.js';
test('draft real-table coordinator commits, replays and rolls back',async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(process.env.TEST_DATABASE_ISOLATED!=='YES'||!url)throw Error('isolated DB required');
 const u=new URL(url);
 if(u.hostname!=='127.0.0.1'||u.pathname!=='/hub_receipt_fixture')throw Error('unsafe database');
 const db=new pg.Client({connectionString:url,ssl:false});await db.connect();
 try{
  await db.query('CREATE SCHEMA hub_real_fixture');
  await db.query('SET search_path TO hub_real_fixture');
  await db.query(`CREATE TABLE ftg_events(id bigint primary key);
  INSERT INTO ftg_events VALUES(1);
  CREATE TABLE ftg_games(id bigserial primary key,event_id bigint references ftg_events(id),external_game_id text,game_number text,game_date text,game_time text,court text,division text,grade text,format text,period text,status text,home_team text,away_team text,home_score int,away_score int,home_fouls int,away_fouls int,published_at timestamptz,updated_at timestamptz,unique(event_id,game_number));
  CREATE TABLE ftg_game_players(game_id bigint references ftg_games(id),side text,player_number text,player_name text,pts int check(pts<=20),reb int,ast int,stl int,blk int,turnovers int,fouls int,ftm int,ftx int);`);
  await db.query(await readFile(new URL('../docs/sql/scorekeeper-publish-receipts.proposed.sql',import.meta.url),'utf8'));
  await db.query(await readFile(new URL('../docs/sql/scorekeeper-game-format-metadata.proposed.sql',import.meta.url),'utf8'));
  const args={eventId:1,gameNumber:'1',captureId:'capture-A',expectedRevision:0,idempotencyKey:'first',game:{home_score:11,away_score:5},players:[{player_name:'Fixture Player',pts:11}]};
  const {createDraftPublishHandler}=await import('../lib/hub-publish-handler.proposed.js');
  let connections=0,releases=0;
  const handler=createDraftPublishHandler({
   authorize:async req=>req.fixtureAuthorized===true?{eventId:1,gameNumber:'1',captureId:'capture-A'}:null,
   connect:async()=>{connections++;return {query:db.query.bind(db),release(){releases++;}};}
  });
  const invoke=async(body,fixtureAuthorized=true)=>{
   const res={statusCode:0,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
   await handler({method:'POST',body,fixtureAuthorized},res);return res;
  };
  assert.equal((await invoke(args,false)).statusCode,403);
  assert.equal((await invoke({...args,players:null})).statusCode,400);
  assert.equal(connections,0);
  const published=await invoke(args);
  assert.equal(published.statusCode,200);
  const {ok,...first}=published.body;
  assert.equal(ok,true);
  assert.equal(releases,1);
  const replay=await invoke(args);
  assert.deepEqual(replay.body,{ok:true,...first,action:'replay'});
  assert.equal((await invoke({...args,game:{home_score:12}})).statusCode,409);
  const failed=await invoke({...args,expectedRevision:1,idempotencyKey:'handler-failure',players:[{player_name:'Fixture Player',pts:99}]});
  assert.equal(failed.statusCode,503);
  assert.equal(connections,releases);
  const {createAssignedPublishHandler}=await import('../lib/hub-assigned-publish-handler.proposed.js');
  const binding={eventSlug:'fixture-event',gameNumber:'1',captureId:'capture-A'};
  const session={operatorId:'op-1',verified:true,revoked:false,expiresAtMs:2000};
  const assigned=createAssignedPublishHandler({
   verifyCsrf:async req=>req.fixtureCsrf===true,
   loadSession:async()=>session,
   loadAssignment:async()=>({...session,...binding,active:true}),
   resolveEvent:async slug=>slug===binding.eventSlug?{id:1,slug}:null,
   connect:async()=>{connections++;return {query:db.query.bind(db),release(){releases++;}};},
   clock:()=>1000
  });
  const callAssigned=async(body,fixtureCsrf=true)=>{
   const res={statusCode:0,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
   await assigned({method:'POST',body,fixtureCsrf},res);return res;
  };
  const {createIdentityReaders}=await import('../lib/scorekeeper-identity-readers.proposed.js');
  const {createHash}=await import('node:crypto');
  await db.query(await readFile(new URL('../docs/sql/scorekeeper-operator-identity.proposed.sql',import.meta.url),'utf8'));
  const token='A'.repeat(43);
  await db.query('INSERT INTO scorekeeper_operator_sessions(token_hash,operator_id,expires_at,idle_expires_at) VALUES($1,$2,$3,$3)',[createHash('sha256').update(token).digest('hex'),'op-1',new Date(2000)]);
  await db.query('INSERT INTO scorekeeper_operator_assignments(operator_id,event_slug,game_number,capture_id,expires_at,active) VALUES($1,$2,$3,$4,$5,true)',['op-1',binding.eventSlug,binding.gameNumber,binding.captureId,new Date(2000)]);
  const readers=createIdentityReaders(db);
  assert.deepEqual(await readers.loadSession(token),session);
  assert.equal(await readers.loadSession('B'.repeat(43)),null);
  const databaseAssigned=createAssignedPublishHandler({
   verifyCsrf:async()=>true,loadSession:async req=>readers.loadSession(req.fixtureToken),
   loadAssignment:readers.loadAssignment,
   resolveEvent:async slug=>slug===binding.eventSlug?{id:1,slug}:null,
   connect:async()=>{connections++;return {query:db.query.bind(db),release(){releases++;}};},clock:()=>1000
  });
  const callDatabase=async(fixtureToken,body)=>{
   const res={statusCode:0,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
   await databaseAssigned({method:'POST',body,fixtureToken},res);return res;
  };
  const beforeIdentity=connections;
  assert.equal((await callDatabase('B'.repeat(43),{...args,binding})).statusCode,403);
  assert.equal((await callDatabase(token,{...args,binding:{...binding,gameNumber:'2'}})).statusCode,403);
  assert.equal(connections,beforeIdentity);
  assert.deepEqual((await callDatabase(token,{...args,binding})).body,{ok:true,...first,action:'replay'});
  await db.query('UPDATE scorekeeper_operator_sessions SET revoked_at=now()');
  assert.equal((await callDatabase(token,{...args,binding})).statusCode,403);
  assert.equal(connections,beforeIdentity+1);
  const {createServicePublishHandler}=await import('../lib/hub-service-publish-handler.proposed.js');
  const {createServiceDelegation}=await import('../lib/hub-service-delegation.proposed.js');
  const credential='fixture-service-credential-not-secret';
  const service=createServicePublishHandler({credential,resolveDelegation:createServiceDelegation({client:db,resolveEvent:async slug=>slug===binding.eventSlug?{id:1,slug}:null,clock:()=>1000}),connect:async()=>{connections++;return {query:db.query.bind(db),release(){releases++;}};}});
  const callService=async(key,sessionToken,body)=>{
   const res={statusCode:0,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
   await service({method:'POST',headers:{'x-ftg-publish-token':key,'x-ftg-operator-session':sessionToken},body},res);return res;
  };
  const beforeService=connections;
  assert.equal((await callService(credential,token,{...args,binding})).statusCode,403);
  await db.query('UPDATE scorekeeper_operator_sessions SET revoked_at=NULL');
  assert.equal((await callService('wrong',token,{...args,binding})).statusCode,403);
  assert.equal((await callService(credential,'B'.repeat(43),{...args,binding})).statusCode,403);
  assert.equal((await callService(credential,token,{...args,binding:{...binding,captureId:'wrong'}})).statusCode,403);
  assert.equal(connections,beforeService);
  assert.deepEqual((await callService(credential,token,{...args,binding})).body,{ok:true,...first,action:'replay'});
  assert.equal(connections,beforeService+1);
  const before=connections;
  assert.equal((await callAssigned({...args,binding},false)).statusCode,403);
  assert.equal((await callAssigned({...args,binding:{...binding,captureId:'wrong'}})).statusCode,403);
  assert.equal(connections,before);
  assert.deepEqual((await callAssigned({...args,binding})).body,{ok:true,...first,action:'replay'});
  assert.equal(connections,releases);

  assert.equal(first.action,'committed');
  assert.deepEqual(await commitHubPublish(db,args),{...first,action:'replay'});
  assert.deepEqual(await commitHubPublish(db,{...args,game:{away_score:5,home_score:11},players:[{pts:11,player_name:'Fixture Player'}]}),{...first,action:'replay'});
  assert.equal((await commitHubPublish(db,{...args,players:[{pts:12,player_name:'Fixture Player'}]})).status,409);
  assert.equal((await commitHubPublish(db,{...args,game:{home_score:12}})).status,409);
  await assert.rejects(commitHubPublish(db,{...args,expectedRevision:1,idempotencyKey:'failure',game:{home_score:99},players:[{player_name:'Fixture Player',pts:99}]}),/check constraint/);
  assert.equal((await db.query('SELECT home_score FROM ftg_games')).rows[0].home_score,11);
  assert.equal((await db.query('SELECT pts FROM ftg_game_players')).rows[0].pts,11);
  assert.equal(Number((await db.query('SELECT revision FROM scorekeeper_publish_versions')).rows[0].revision),1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM scorekeeper_publish_receipts')).rows[0].n,1);
  // The actual Hub's read-only catalog inventory uses UUID identifiers,
  // date/time types, and a NOT NULL opponent-fouls column. Recreate that
  // structure from schema metadata only, with no Production data or connection.
  await db.query('CREATE SCHEMA hub_uuid_fixture; SET search_path TO hub_uuid_fixture');
  await db.query(`CREATE TABLE ftg_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text NOT NULL UNIQUE,name text NOT NULL,is_published boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE ftg_games(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES ftg_events(id) ON DELETE CASCADE,external_game_id text,game_number text NOT NULL,game_date date,game_time time,court text,division text,grade text,format text NOT NULL DEFAULT 'classic',period text,status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','live','final')),home_team text NOT NULL,away_team text NOT NULL,home_score int NOT NULL DEFAULT 0 CHECK(home_score>=0),away_score int NOT NULL DEFAULT 0 CHECK(away_score>=0),home_fouls int NOT NULL DEFAULT 0 CHECK(home_fouls>=0),away_fouls int NOT NULL DEFAULT 0 CHECK(away_fouls>=0),published_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,game_number));
   CREATE TABLE ftg_game_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid NOT NULL REFERENCES ftg_games(id) ON DELETE CASCADE,side text NOT NULL CHECK(side IN ('home','away')),player_number text,player_name text NOT NULL DEFAULT '',pts int NOT NULL DEFAULT 0,reb int NOT NULL DEFAULT 0,ast int NOT NULL DEFAULT 0,stl int NOT NULL DEFAULT 0,blk int NOT NULL DEFAULT 0,turnovers int NOT NULL DEFAULT 0,fouls int NOT NULL DEFAULT 0,ftm int NOT NULL DEFAULT 0,ftx int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());`);
  const eventId=(await db.query("INSERT INTO ftg_events(slug,name) VALUES('fixture-uuid','Fictional UUID event') RETURNING id")).rows[0].id;
  for(const file of ['scorekeeper-publish-receipts.uuid.proposed.sql','scorekeeper-game-format-metadata.proposed.sql','scorekeeper-one-team-opponent-fouls.proposed.sql','scorekeeper-operator-identity.proposed.sql'])await db.query(await readFile(new URL('../docs/sql/'+file,import.meta.url),'utf8'));
  const scope={version:'scorekeeper-scope-v2-one-team',homeTeam:'Fictional Falcons',awayTeam:'Fictional Owls',format:'classic',roster:[{side:'home',player_number:'12',player_name:'Fictional Player'}]};
  const uuidBinding={eventSlug:'fixture-uuid',gameNumber:'1',captureId:'uuid-capture'};
  await db.query("INSERT INTO scorekeeper_operators(operator_id,issuer,subject,active) VALUES('op-uuid','fixture','subject',true)");
  await db.query('INSERT INTO scorekeeper_operator_sessions(token_hash,operator_id,expires_at,idle_expires_at) VALUES($1,$2,$3,$3)',[createHash('sha256').update(token).digest('hex'),'op-uuid',new Date(2000)]);
  await db.query('INSERT INTO scorekeeper_operator_assignments(operator_id,event_slug,game_number,capture_id,valid_from,expires_at,active,scope) VALUES($1,$2,$3,$4,$5,$6,true,$7)',['op-uuid',uuidBinding.eventSlug,uuidBinding.gameNumber,uuidBinding.captureId,new Date(0),new Date(2000),scope]);
  const {createScopedHubHandlers}=await import('../lib/hub-scoped-release-handlers.proposed.js');
  const {createScorekeeperRateLimiter}=await import('../lib/scorekeeper-rate-limiter.proposed.js');
  const limits={scorer_context:10,scorer_publish:10,scorer_receipt:10,hub_context:10,hub_publish:10,hub_receipt:10};
  const uuidHub=createScopedHubHandlers({credential,identityClient:db,resolveEvent:async slug=>{const {rows}=await db.query('SELECT id,slug FROM ftg_events WHERE slug=$1',[slug]);return rows[0]??null;},connect:async()=>({query:db.query.bind(db),release(){}}),rateLimiter:createScorekeeperRateLimiter(db,{limits,windowMs:1000,clock:()=>1000}),clock:()=>1000});
  const call=async(handler,body)=>{const res={setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};await handler({method:'POST',headers:{'x-ftg-publish-token':credential,'x-ftg-operator-session':token},body},res);return res;};
  assert.deepEqual((await call(uuidHub.context,{binding:uuidBinding})).body,{ok:true,revision:0});
  const uuidPayload={binding:uuidBinding,expectedRevision:0,idempotencyKey:'uuid-fixture',game:{game_date:'2026-11-24',game_time:'10:00',court:'Court 1',division:'',grade:'',format:'classic',period:'FINAL',home_team:scope.homeTeam,away_team:scope.awayTeam,home_score:8,away_score:6,home_fouls:2,away_fouls:null,home_quarter_points:0,away_quarter_points:0,target_score:null},players:[{side:'home',player_number:'12',player_name:'Fictional Player',pts:8,reb:1,ast:0,stl:0,blk:0,turnovers:0,fouls:2,ftm:0,ftx:0}]};
  const accepted=await call(uuidHub.publish,uuidPayload);assert.equal(accepted.statusCode,200);assert.equal(accepted.body.revision,1);
  const repeated=await call(uuidHub.publish,uuidPayload);assert.equal(repeated.body.receiptId,accepted.body.receiptId);assert.equal(repeated.body.action,'replay');
  const actual=(await db.query('SELECT event_id,home_score,away_score,away_fouls,game_time FROM ftg_games')).rows[0];assert.deepEqual(actual,{event_id:eventId,home_score:8,away_score:6,away_fouls:null,game_time:'10:00:00'});
  assert.equal((await db.query('SELECT is_published FROM ftg_events')).rows[0].is_published,false);assert.equal((await db.query('SELECT count(*)::int AS n FROM scorekeeper_publish_receipts')).rows[0].n,1);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.query('DROP SCHEMA IF EXISTS hub_uuid_fixture CASCADE');await db.query('DROP SCHEMA IF EXISTS hub_real_fixture CASCADE');await db.end();}
});

