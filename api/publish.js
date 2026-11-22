import { db, cors } from './_db.js';
import { timingSafeEqual } from 'node:crypto';

function cleanInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

export default async function handler(req, res) {
  // This endpoint is server-to-server only. Never grant browser CORS access.
  // Browsers must use the separately authorized same-origin Scorekeeper proxy.
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'POST required'
    });
  }

  // Gate publishing with a server-only credential. The browser scorer cannot
  // safely hold this credential; publishing requires a separately reviewed
  // authenticated server-side proxy before Production activation.
  const secret = process.env.FTG_HUB_PUBLISH_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    return res.status(503).json({ ok: false, error: 'Publishing not configured' });
  }
  const token = req.headers?.['x-ftg-publish-token'];
  if (typeof token !== 'string') {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const expected = Buffer.from(secret);
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Reject oversized or malformed publish requests before any database access.
  // This complements (not replaces) the platform's HTTP body-size limit.
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ ok: false, error: 'Invalid publish payload' });
  }
  let encoded;
  try { encoded = JSON.stringify(payload); } catch {
    return res.status(400).json({ ok: false, error: 'Invalid publish payload' });
  }
  if (!encoded || Buffer.byteLength(encoded) > 128 * 1024 ||
      !Array.isArray(payload.players) || payload.players.length > 200 ||
      !payload.game || typeof payload.game !== 'object' || Array.isArray(payload.game)) {
    return res.status(400).json({ ok: false, error: 'Invalid publish payload' });
  }
  // The caller must supply an explicit event identity; never silently publish
  // into a shared demo event when an assignment is missing.
  const eventSlug = typeof payload.event_slug === 'string' ? payload.event_slug.trim() : '';
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(eventSlug)) {
    return res.status(400).json({ ok: false, error: 'Invalid event_slug' });
  }
  const game = payload.game;
  const players = payload.players;

  if (!game.game_number) {
    return res.status(400).json({
      ok: false,
      error: 'Missing game.game_number'
    });
  }

  const externalGameId = String(game.external_game_id || '').trim();
  if (!externalGameId) {
    return res.status(400).json({
      ok: false,
      error: 'Missing game.external_game_id'
    });
  }

  const client = await db().connect();

  try {
    await client.query('BEGIN');

    const eventResult = await client.query(
      `insert into ftg_events (slug, name, is_published, updated_at)
       values ($1, $2, true, now())
       on conflict (slug) do update
       set is_published = true,
           updated_at = now()
       returning id, slug, name`,
      [eventSlug, payload.event_name || 'FTG Event']
    );

    const event = eventResult.rows[0];

    // Serialize publishers for the same event/game number, including the
    // initial insert when no row exists to lock with SELECT FOR UPDATE.
    // pg_advisory_xact_lock is released automatically at transaction end.
    await client.query(
      'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(event.id), String(game.game_number)]
    );

    const existingGameResult = await client.query(
      `select id, external_game_id
       from ftg_games
       where event_id = $1 and game_number = $2
       for update`,
      [event.id, String(game.game_number)]
    );

    const existingGame = existingGameResult.rows[0];
    if (
      existingGame &&
      String(existingGame.external_game_id || '').trim() &&
      String(existingGame.external_game_id).trim() !== externalGameId
    ) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        ok: false,
        error: 'Game number conflict: this event/game number belongs to a different captured game'
      });
    }

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
         published_at,
         updated_at
       )
       values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'final',
         $11,$12,$13,$14,$15,$16,now(),now()
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
        String(game.game_number || '1'),
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
        cleanInt(game.away_fouls)
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

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      message: 'Game published to FTG Hub',
      event,
      game: savedGame,
      playerCount: players.filter(
        p => String(p.player_name || '').trim()
      ).length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: 'FTG Hub publish failed'
    });

  } finally {
    client.release();
  }
}
