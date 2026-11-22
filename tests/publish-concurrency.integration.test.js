import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import pg from 'pg';
import { timingSafeEqual } from 'node:crypto';

const root=path.dirname(fileURLToPath(import.meta.url));
const source=readFileSync(path.join(root,'../api/publish.js'),'utf8')
  .replace(/^import .*;\s*$/gm,'')
  .replace('export default async function handler','async function handler');
const secret='integration-only-credential-not-for-production';
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false,max:5});
const handler=vm.runInNewContext(source+'\nhandler',{
 process:{env:{FTG_HUB_PUBLISH_SECRET:secret}},Buffer,console,timingSafeEqual,
 db:()=>pool,cors:()=>{}
});
function publish(external_game_id,home_score){
 const res={status(n){this.code=n;return this},json(v){this.payload=v;return this},end(){return this}};
 return handler({method:'POST',headers:{'x-ftg-publish-token':secret},body:{
  event_slug:'isolated-concurrency-fixture',game:{game_number:'1',external_game_id,home_score},
  players:[{player_name:'Test Player',side:'home',pts:home_score}]
 }},res).then(()=>res);
}
test('concurrent different-game writers cannot overwrite same event/game',async(t)=>{
 if(!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_ISOLATED !== 'YES'){
  t.skip('explicit isolated PostgreSQL test database not configured');return
 }
 const parsed=new URL(process.env.TEST_DATABASE_URL);
 if(!/(_test|_ci|_fixture)$/i.test(decodeURIComponent(parsed.pathname.slice(1)))){
  throw Error('Refusing database integration test: database name must end _test, _ci, or _fixture');
 }
 await pool.query(`create temporary table no_op(x int)`).catch(()=>{});
 await pool.query(`
 create table if not exists ftg_events(
  id bigserial primary key,slug text unique not null,name text,
  is_published boolean,updated_at timestamptz);
 create table if not exists ftg_games(
  id bigserial primary key,event_id bigint not null,external_game_id text,
  game_number text not null,game_date text,game_time text,court text,
  division text,grade text,format text,period text,status text,
  home_team text,away_team text,home_score int,away_score int,
  home_fouls int,away_fouls int,published_at timestamptz,updated_at timestamptz,
  unique(event_id,game_number));
 create table if not exists ftg_game_players(
  game_id bigint,side text,player_number text,player_name text,
  pts int,reb int,ast int,stl int,blk int,turnovers int,fouls int,ftm int,ftx int);
 `);
 try{
  const [a,b]=await Promise.all([publish('capture-A',11),publish('capture-B',99)]);
  assert.deepEqual([a.code,b.code].sort(),[200,409]);
  const games=await pool.query(`select external_game_id,home_score from ftg_games g
    join ftg_events e on e.id=g.event_id where e.slug='isolated-concurrency-fixture'`);
  assert.equal(games.rowCount,1);
  const winner=a.code===200?['capture-A',11]:['capture-B',99];
  assert.equal(games.rows[0].external_game_id,winner[0]);
  assert.equal(games.rows[0].home_score,winner[1]);
  const players=await pool.query(`select pts from ftg_game_players p join ftg_games g on p.game_id=g.id
    join ftg_events e on e.id=g.event_id where e.slug='isolated-concurrency-fixture'`);
  assert.equal(players.rowCount,1);
  assert.equal(players.rows[0].pts,winner[1]);
 }finally{
  await pool.query(`delete from ftg_game_players where game_id in
    (select g.id from ftg_games g join ftg_events e on e.id=g.event_id where e.slug='isolated-concurrency-fixture')`);
  await pool.query(`delete from ftg_games where event_id in
    (select id from ftg_events where slug='isolated-concurrency-fixture')`);
  await pool.query(`delete from ftg_events where slug='isolated-concurrency-fixture'`);
  await pool.end();
 }
});
