-- Staging-only fictional Hub schema. Never use to replace a Production schema.
-- Matches the disposable cross-repository fixture's field contract; actual
-- Production column/constraint compatibility requires separate review.
CREATE TABLE ftg_events (
 id bigint PRIMARY KEY,
 slug text NOT NULL UNIQUE,
 name text NOT NULL,
 is_published boolean NOT NULL DEFAULT false
);
CREATE TABLE ftg_games (
 id bigserial PRIMARY KEY,
 event_id bigint NOT NULL REFERENCES ftg_events(id),
 external_game_id text NOT NULL,
 game_number text NOT NULL,
 game_date text,
 game_time text,
 court text,
 division text,
 grade text,
 format text,
 period text,
 status text,
 home_team text,
 away_team text,
 home_score integer CHECK(home_score>=0),
 away_score integer CHECK(away_score>=0),
 home_fouls integer CHECK(home_fouls>=0),
 away_fouls integer CHECK(away_fouls>=0),
 published_at timestamptz,
 updated_at timestamptz,
 UNIQUE(event_id,game_number)
);
CREATE TABLE ftg_game_players (
 game_id bigint NOT NULL REFERENCES ftg_games(id),
 side text NOT NULL CHECK(side IN ('home','away')),
 player_number text NOT NULL,
 player_name text NOT NULL,
 pts integer NOT NULL CHECK(pts>=0),
 reb integer NOT NULL CHECK(reb>=0),
 ast integer NOT NULL CHECK(ast>=0),
 stl integer NOT NULL CHECK(stl>=0),
 blk integer NOT NULL CHECK(blk>=0),
 turnovers integer NOT NULL CHECK(turnovers>=0),
 fouls integer NOT NULL CHECK(fouls>=0),
 ftm integer NOT NULL CHECK(ftm>=0),
 ftx integer NOT NULL CHECK(ftx>=0)
);
