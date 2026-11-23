CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Una película o una serie
CREATE TABLE IF NOT EXISTS titles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('movie','series')),
  year        INTEGER,
  genre       TEXT,
  description TEXT,
  poster_key  TEXT,          -- ruta en R2, p. ej. videos/titanic/poster.jpg
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Archivos reproducibles: 1 para película, N episodios para serie
CREATE TABLE IF NOT EXISTS videos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id   INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season     INTEGER,
  episode    INTEGER,
  name       TEXT,
  hls_prefix TEXT NOT NULL,  -- carpeta en R2, p. ej. videos/titanic
  duration   INTEGER         -- segundos
);
CREATE INDEX IF NOT EXISTS idx_videos_title ON videos(title_id);

-- "Seguir viendo"
CREATE TABLE IF NOT EXISTS progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position   REAL NOT NULL,
  duration   REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, video_id)
);
