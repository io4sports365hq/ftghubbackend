// Review-only public readback; NOT registered by api/latest.js.
// Explicitly exposed events only, FINAL games only, consistent MVCC snapshot.
export function createPublicLatestHandler({connect}){
 if(typeof connect!=='function')throw new TypeError('Missing public read authority');
 return async function(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET required'});
  let client;
  try{
   client=await connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const games=await client.query(`SELECT g.id,g.game_number,g.game_date,g.game_time,g.court,g.division,g.grade,g.format,g.period,g.status,
    g.home_team,g.away_team,g.home_score,g.away_score,g.home_fouls,g.away_fouls,g.home_quarter_points,g.away_quarter_points,g.target_score,g.published_at,
    e.name AS event_name,e.slug AS event_slug FROM ftg_games g JOIN ftg_events e ON e.id=g.event_id
    WHERE e.is_published IS TRUE AND g.status='final' AND g.published_at IS NOT NULL
    ORDER BY g.published_at DESC,g.updated_at DESC NULLS LAST,g.id DESC LIMIT 1`);
   if(games.rows.length!==1){await client.query('COMMIT');return res.status(404).json({ok:false,error:'No published games found'});}
   const game=games.rows[0];
   const players=await client.query(`SELECT side,player_number,player_name,pts,reb,ast,stl,blk,turnovers,fouls,ftm,ftx
    FROM ftg_game_players WHERE game_id=$1 ORDER BY pts DESC,player_name ASC,side ASC,player_number ASC`,[game.id]);
   await client.query('COMMIT');return res.status(200).json({ok:true,game,players:players.rows});
  }catch{if(client)await client.query('ROLLBACK').catch(()=>{});return res.status(503).json({ok:false,error:'Hub latest game unavailable'});}
  finally{if(client)client.release();}
 };
}
