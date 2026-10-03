// "Seen it", "Not for me" and "My list" (⭐) — stored per user in the user_movies table.
import { HttpError } from "./auth.js";
import { MOVIES_BY_ID, summary } from "./recommend.js";

export const STATUSES = ["saved", "seen", "skip"];

// { seen: Set, skip: Set, saved: Set } of movie ids, used by the recommender.
export async function getMarks(env, userId) {
  const { results } = await env.DB.prepare("SELECT movie_id, status FROM user_movies WHERE user_id = ?")
    .bind(userId)
    .all();
  const marks = { seen: new Set(), skip: new Set(), saved: new Set() };
  for (const r of results) marks[r.status]?.add(r.movie_id);
  return marks;
}

// status null removes the mark.
export async function setMark(env, userId, movieId, status) {
  if (!(movieId in MOVIES_BY_ID)) throw new HttpError(400, "Нет такого фильма");
  if (status === null) {
    await env.DB.prepare("DELETE FROM user_movies WHERE user_id = ? AND movie_id = ?").bind(userId, movieId).run();
    return;
  }
  if (!STATUSES.includes(status)) throw new HttpError(400, "Неверный статус");
  await env.DB.prepare(
    `INSERT INTO user_movies (user_id, movie_id, status, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, movie_id) DO UPDATE SET status = excluded.status, created_at = excluded.created_at`,
  )
    .bind(userId, movieId, status, Date.now())
    .run();
}

// Everything the user marked, newest first, with posters if TMDB data is already cached.
export async function getList(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT um.movie_id, um.status, tc.data FROM user_movies um
     LEFT JOIN tmdb_cache tc ON tc.movie_id = um.movie_id
     WHERE um.user_id = ? ORDER BY um.created_at DESC`,
  )
    .bind(userId)
    .all();
  const list = { saved: [], seen: [], skip: [] };
  for (const r of results) {
    const movie = MOVIES_BY_ID[r.movie_id];
    if (!movie || !list[r.status]) continue; // removed from the catalogue
    const cached = r.data ? JSON.parse(r.data) : {};
    list[r.status].push({ ...summary(movie), poster: cached.poster || null });
  }
  return list;
}
