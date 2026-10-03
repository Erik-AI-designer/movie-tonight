// Per-user lists and activity:
// - "Seen it", "Not for me", ⭐ "My list", and "watching" (clicked a watch button) — table user_movies
// - 👍/👎 after watching — table ratings (used as "taste" by the recommender)
// - watch-button clicks for the stats page — table clicks
import { HttpError } from "./auth.js";
import { MOVIES_BY_ID, summary } from "./recommend.js";
import { t } from "./i18n.js";

export const STATUSES = ["saved", "seen", "skip"];
const FEEDBACK_AFTER_MS = 2 * 3600_000; // ask "how was it?" 2 hours after clicking "watch"
const FEEDBACK_UNTIL_MS = 14 * 86400_000; // ...but not about clicks older than two weeks

// Catalogue ids look like "klaus"; TMDB ids like "m508965" (movie) or "t66732" (series).
export function isKnownId(id) {
  return typeof id === "string" && (id in MOVIES_BY_ID || /^[mt]\d{1,9}$/.test(id));
}

// { seen, skip, saved, watching } Sets of ids, used by the recommender.
export async function getMarks(env, userId) {
  const { results } = await env.DB.prepare("SELECT movie_id, status FROM user_movies WHERE user_id = ?")
    .bind(userId)
    .all();
  const marks = { seen: new Set(), skip: new Set(), saved: new Set(), watching: new Set() };
  for (const r of results) marks[r.status]?.add(r.movie_id);
  return marks;
}

// status null removes the mark.
export async function setMark(env, userId, movieId, status) {
  if (!isKnownId(movieId)) throw new HttpError(400, "err.noMovie");
  if (status === null) {
    await env.DB.prepare("DELETE FROM user_movies WHERE user_id = ? AND movie_id = ?").bind(userId, movieId).run();
    return;
  }
  if (!STATUSES.includes(status) && status !== "watching") throw new HttpError(400, "err.badStatus");
  await env.DB.prepare(
    `INSERT INTO user_movies (user_id, movie_id, status, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, movie_id) DO UPDATE SET status = excluded.status, created_at = excluded.created_at`,
  )
    .bind(userId, movieId, status, Date.now())
    .run();
}

// Title/poster/genres for a set of ids, from the catalogue and the TMDB cache (no TMDB requests).
export async function infoFor(env, ids, lang) {
  const info = {};
  const keys = new Set();
  for (const id of ids) {
    if (id in MOVIES_BY_ID) {
      info[id] = summary(MOVIES_BY_ID[id], lang);
      keys.add(`_search:${id}`);
    } else {
      for (const l of [lang, "ru", "en", "et"]) keys.add(`${id}:${l}`);
    }
  }
  const rows = await cacheRows(env, [...keys]);
  // Catalogue titles: follow _search → TMDB details for the poster.
  const more = new Set();
  for (const id of ids) {
    const ref = rows[`_search:${id}`];
    if (ref?.tmdbId) {
      const k = `${MOVIES_BY_ID[id].type === "series" ? "t" : "m"}${ref.tmdbId}`;
      for (const l of [lang, "ru", "en"]) more.add(`${k}:${l}`);
      info[id].tmdbKey = k;
    }
  }
  Object.assign(rows, await cacheRows(env, [...more]));

  for (const id of ids) {
    if (info[id]) {
      const d = [lang, "ru", "en"].map((l) => rows[`${info[id].tmdbKey}:${l}`]).find(Boolean);
      info[id].poster = d?.poster || null;
      delete info[id].tmdbKey;
      continue;
    }
    const d = [lang, "ru", "en", "et"].map((l) => rows[`${id}:${l}`]).find(Boolean);
    if (d) {
      info[id] = {
        id, type: d.type, title: d.title || d.original, original: d.original, year: d.year, runtime: d.runtime,
        genreIds: d.genreIds || [], genres: (d.genreIds || []).map((g) => t(lang, `genre.${g}`)), poster: d.poster,
      };
    }
  }
  return info;
}

async function cacheRows(env, keys) {
  const rows = {};
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    if (!part.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT movie_id, data FROM tmdb_cache WHERE movie_id IN (${part.map(() => "?").join(",")})`,
    )
      .bind(...part)
      .all();
    for (const r of results) rows[r.movie_id] = JSON.parse(r.data);
  }
  return rows;
}

// Everything the user marked, newest first.
export async function getList(env, userId, lang) {
  const { results } = await env.DB.prepare(
    "SELECT movie_id, status FROM user_movies WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all();
  const ratings = await env.DB.prepare("SELECT movie_id, rating FROM ratings WHERE user_id = ?")
    .bind(userId)
    .all()
    .catch(() => ({ results: [] })); // table missing until schema.sql is re-run
  const rated = Object.fromEntries(ratings.results.map((r) => [r.movie_id, r.rating]));
  const info = await infoFor(env, results.map((r) => r.movie_id), lang);
  const list = { saved: [], seen: [], skip: [] };
  for (const r of results) {
    const status = r.status === "watching" ? "seen" : r.status;
    if (!info[r.movie_id] || !list[status]) continue; // e.g. removed from the catalogue
    list[status].push({ ...info[r.movie_id], rating: rated[r.movie_id] ?? null });
  }
  return list;
}

// ---------- Watch clicks + "how was it?" ----------

export async function recordClick(env, userId, movieId, service, title) {
  if (!isKnownId(movieId)) throw new HttpError(400, "err.noMovie");
  await env.DB.prepare("INSERT INTO clicks (user_id, movie_id, title, service, at) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, movieId, String(title || "").slice(0, 200), String(service || "").slice(0, 60), Date.now())
    .run();
  if (!userId) return; // trial pick without an account: count the click, nothing to remember
  // Remember it as "watching" so we can ask for 👍/👎 later (unless it's already rated/seen).
  await env.DB.prepare(
    `INSERT INTO user_movies (user_id, movie_id, status, created_at) VALUES (?, ?, 'watching', ?)
     ON CONFLICT(user_id, movie_id) DO UPDATE SET status = 'watching', created_at = excluded.created_at
     WHERE user_movies.status IN ('saved', 'watching')`,
  )
    .bind(userId, movieId, Date.now())
    .run();
}

// The title to ask about, or null.
export async function pendingFeedback(env, userId, lang) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT movie_id FROM user_movies WHERE user_id = ? AND status = 'watching'
     AND created_at < ? AND created_at > ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId, now - FEEDBACK_AFTER_MS, now - FEEDBACK_UNTIL_MS)
    .first();
  if (!row) return null;
  const info = await infoFor(env, [row.movie_id], lang);
  return info[row.movie_id] || { id: row.movie_id, title: row.movie_id };
}

// rating: 1 (👍), -1 (👎) or 0 ("didn't watch it").
export async function saveFeedback(env, userId, movieId, rating) {
  if (!isKnownId(movieId) || ![1, -1, 0].includes(rating)) throw new HttpError(400, "err.badRequest");
  if (rating === 0) {
    await env.DB.prepare("DELETE FROM user_movies WHERE user_id = ? AND movie_id = ? AND status = 'watching'")
      .bind(userId, movieId)
      .run();
    return;
  }
  const info = await infoFor(env, [movieId], "ru");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ratings (user_id, movie_id, rating, genres, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, movie_id) DO UPDATE SET rating = excluded.rating, created_at = excluded.created_at`,
    ).bind(userId, movieId, rating, JSON.stringify(info[movieId]?.genreIds || []), Date.now()),
    env.DB.prepare(
      `INSERT INTO user_movies (user_id, movie_id, status, created_at) VALUES (?, ?, 'seen', ?)
       ON CONFLICT(user_id, movie_id) DO UPDATE SET status = 'seen'`,
    ).bind(userId, movieId, Date.now()),
  ]);
}

// 👍 / 👎 set directly (from search or "My list"), without the "how was it?" question.
// rating 0 removes the rating. Rating something also marks it as seen.
export async function setRating(env, userId, movieId, rating, genreIds) {
  if (!isKnownId(movieId) || ![1, -1, 0].includes(rating)) throw new HttpError(400, "err.badRequest");
  if (rating === 0) {
    await env.DB.prepare("DELETE FROM ratings WHERE user_id = ? AND movie_id = ?").bind(userId, movieId).run();
    return;
  }
  const genres = genreIds || (await infoFor(env, [movieId], "ru"))[movieId]?.genreIds || [];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ratings (user_id, movie_id, rating, genres, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, movie_id) DO UPDATE SET rating = excluded.rating, genres = excluded.genres, created_at = excluded.created_at`,
    ).bind(userId, movieId, rating, JSON.stringify(genres), Date.now()),
    env.DB.prepare(
      `INSERT INTO user_movies (user_id, movie_id, status, created_at) VALUES (?, ?, 'seen', ?)
       ON CONFLICT(user_id, movie_id) DO UPDATE SET status = 'seen'`,
    ).bind(userId, movieId, Date.now()),
  ]);
}

// Remove (or move) many titles at once — "delete selected" / "clear" in My list.
export async function bulkMark(env, userId, movieIds, status) {
  if (!Array.isArray(movieIds)) throw new HttpError(400, "err.badRequest");
  for (const id of movieIds.slice(0, 300)) await setMark(env, userId, id, status ?? null);
}

// ---------- Stats page (admin only) ----------

export function isAdmin(env, user) {
  const admins = String(env.ADMIN_EMAIL || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return admins.includes(user.email);
}

export async function stats(env) {
  const now = Date.now();
  const since = now - 30 * 86400_000;
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  const [byService, byServiceAll, topTitles, perDay, users, newUsers, rooms, ratings] = await env.DB.batch([
    q("SELECT service, COUNT(*) AS n FROM clicks WHERE at > ? GROUP BY service ORDER BY n DESC", since),
    q("SELECT service, COUNT(*) AS n FROM clicks GROUP BY service ORDER BY n DESC"),
    q("SELECT title, COUNT(*) AS n FROM clicks WHERE at > ? GROUP BY movie_id ORDER BY n DESC LIMIT 10", since),
    q("SELECT CAST((at - ?) / 86400000 AS INTEGER) AS day, COUNT(*) AS n FROM clicks WHERE at > ? GROUP BY day", since, since),
    q("SELECT COUNT(*) AS n FROM users"),
    q("SELECT COUNT(*) AS n FROM users WHERE created_at > ?", now - 7 * 86400_000),
    q("SELECT COUNT(*) AS n FROM rooms WHERE created_at > ?", since),
    q("SELECT SUM(rating = 1) AS up, SUM(rating = -1) AS down FROM ratings"),
  ]);
  const days = Array(30).fill(0);
  for (const r of perDay.results) if (r.day >= 0 && r.day < 30) days[r.day] = r.n;
  return {
    clicks30: byService.results,
    clicksAll: byServiceAll.results,
    topTitles: topTitles.results,
    clicksPerDay: days,
    users: users.results[0].n,
    newUsers7: newUsers.results[0].n,
    rooms30: rooms.results[0].n,
    ratings: { up: ratings.results[0].up || 0, down: ratings.results[0].down || 0 },
  };
}
