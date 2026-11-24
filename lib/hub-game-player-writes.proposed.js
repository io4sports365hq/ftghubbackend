// Draft-only extraction of existing Hub game/player writes. No endpoint imports this module.
// Caller owns authorization, existing event resolution, lock, revision/receipt and transaction.
function cleanInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

export async function writeHubGamePlayers(client,event,game,players,gameNumber,externalGameId) {
    const gameResult = await client.query(
      `insert into ftg_games (
         event_id,
         external_game_id,
         game_number,
         game_date,
         game_time,
         court,
         division,
         grade,
         format,
         period,
         status,
         home_team,
         away_team,
         home_score,
         away_score,
         home_fouls,
         away_fouls,
         home_quarter_points,
         away_quarter_points,
         target_score,
         published_at,
         updated_at
       )
       values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'final',
         $11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now()
       )
       on conflict (event_id, game_number) do update set
         external_game_id = excluded.external_game_id,
         game_date = excluded.game_date,
         game_time = excluded.game_time,
         court = excluded.court,
         division = excluded.division,
         grade = excluded.grade,
         format = excluded.format,
         period = excluded.period,
         status = 'final',
         home_team = excluded.home_team,
         away_team = excluded.away_team,
         home_score = excluded.home_score,
         away_score = excluded.away_score,
         home_fouls = excluded.home_fouls,
         away_fouls = excluded.away_fouls,
         home_quarter_points = excluded.home_quarter_points,
         away_quarter_points = excluded.away_quarter_points,
         target_score = excluded.target_score,
         published_at = now(),
         updated_at = now()
       returning
         id,
         game_number,
         home_team,
         away_team,
         home_score,
         away_score,
         status`,
      [
        event.id,
        externalGameId,
        gameNumber,
        game.game_date || null,
        game.game_time || null,
        game.court || null,
        game.division || null,
        game.grade || null,
        game.format || 'classic',
        game.period || 'FINAL',
        game.home_team || 'HOME TEAM',
        game.away_team || 'AWAY TEAM',
        cleanInt(game.home_score),
        cleanInt(game.away_score),
        cleanInt(game.home_fouls),
        game.away_fouls===null?null:cleanInt(game.away_fouls),
        game.home_quarter_points??null,
        game.away_quarter_points??null,
        game.target_score??null
      ]
    );

    const savedGame = gameResult.rows[0];

    await client.query(
      'delete from ftg_game_players where game_id = $1',
      [savedGame.id]
    );

    for (const p of players) {
      if (!String(p.player_name || '').trim()) continue;

      await client.query(
        `insert into ftg_game_players (
           game_id,
           side,
           player_number,
           player_name,
           pts,
           reb,
           ast,
           stl,
           blk,
           turnovers,
           fouls,
           ftm,
           ftx
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          savedGame.id,
          p.side === 'away' ? 'away' : 'home',
          String(p.player_number || ''),
          String(p.player_name || ''),
          cleanInt(p.pts),
          cleanInt(p.reb),
          cleanInt(p.ast),
          cleanInt(p.stl),
          cleanInt(p.blk),
          cleanInt(p.turnovers),
          cleanInt(p.fouls),
          cleanInt(p.ftm),
          cleanInt(p.ftx)
        ]
      );
    }

    return savedGame;
}

