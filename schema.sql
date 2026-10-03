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

-- 👍/👎 after watching. `genres` = our genre ids of the title (JSON), so taste can be computed without TMDB.
CREATE TABLE IF NOT EXISTS ratings (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id   TEXT NOT NULL,
  rating     INTEGER NOT NULL,  -- 1 = 👍, -1 = 👎
  genres     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, movie_id)
);

-- Clicks on "Watch on …" buttons, for the stats page.
CREATE TABLE IF NOT EXISTS clicks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  movie_id TEXT NOT NULL,
  title    TEXT,
  service  TEXT NOT NULL,
  at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS clicks_at ON clicks(at);

-- Friends: each user's private friend code and the nickname friends see (never the email).
CREATE TABLE IF NOT EXISTS friend_codes (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code     TEXT NOT NULL UNIQUE,
  nickname TEXT
);

-- Friendship is stored both ways (a→b and b→a).
CREATE TABLE IF NOT EXISTS friendships (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- "Посоветовать другу": a movie one friend recommends to another.
CREATE TABLE IF NOT EXISTS recommendations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  dismissed  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS recommendations_to ON recommendations(to_id, dismissed);
