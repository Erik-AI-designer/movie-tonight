-- Paste this whole file into the D1 console (Cloudflare dashboard → D1 → movie-tonight → Console).
-- Safe to run again after updates: it only creates what's missing and never deletes data.

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,
  salt       TEXT NOT NULL,
  profile    TEXT,              -- JSON with onboarding answers, NULL until answered
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,  -- SHA-256 of the cookie value, never the raw token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- "Seen it", "Not for me" and "My list" (⭐).
CREATE TABLE IF NOT EXISTS user_movies (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id   TEXT NOT NULL,
  status     TEXT NOT NULL,     -- 'saved' | 'seen' | 'skip'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, movie_id)
);

-- Failed logins/resets and registrations, for rate limiting.
CREATE TABLE IF NOT EXISTS attempts (
  key TEXT NOT NULL,            -- e.g. 'login-ip:1.2.3.4' or 'login-email:a@b.c'
  at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS attempts_key ON attempts(key, at);

-- One recovery code per user (only its hash), used to reset a forgotten password.
CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL
);

-- Movie night with friends.
CREATE TABLE IF NOT EXISTS rooms (
  code       TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result     TEXT,              -- JSON of the picked movie, NULL until picked
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  code      TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers   TEXT,               -- JSON {mood, duration, services, kind}, NULL until ready
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);

-- Cached TMDB data (poster, description, rating, trailer, where to watch).
CREATE TABLE IF NOT EXISTS tmdb_cache (
  movie_id   TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
