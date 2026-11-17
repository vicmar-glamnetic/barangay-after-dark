-- Hari ng Kanto online leaderboard (Neon Postgres). Safe to run more than once.
CREATE TABLE IF NOT EXISTS best_all (
  pid        text        NOT NULL,
  game       text        NOT NULL,
  name       text        NOT NULL,
  score      integer     NOT NULL CHECK (score > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pid, game)
);
CREATE INDEX IF NOT EXISTS best_all_top ON best_all (game, score DESC, updated_at);

CREATE TABLE IF NOT EXISTS best_week (
  pid        text        NOT NULL,
  game       text        NOT NULL,
  week       date        NOT NULL,
  name       text        NOT NULL,
  score      integer     NOT NULL CHECK (score > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pid, game, week)
);
CREATE INDEX IF NOT EXISTS best_week_top ON best_week (game, week, score DESC, updated_at);
