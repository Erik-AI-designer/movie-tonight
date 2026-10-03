// 🧠 A user's taste, learned from everything they mark:
//   👍 +1 / 👎 −1 per genre (strongest), ⭐ saved +0.5, seen/clicked "watch" +0.25, 🙅 not for me −0.75.
// The result is a score per genre (used by the recommender) plus "seeds": TMDB titles they liked,
// which discover.js uses to find similar titles ("because you liked …").
import { infoFor } from "./lists.js";

const WEIGHTS = { saved: 0.5, seen: 0.25, watching: 0.25, skip: -0.75 };
const MAX_ITEMS = 300; // the most recent marks are enough to know someone's taste

export async function computeTaste(env, userId) {
  const marks = (
    await env.DB.prepare("SELECT movie_id, status FROM user_movies WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(userId, MAX_ITEMS)
      .all()
  ).results;
  const ratings = (
    await env.DB.prepare("SELECT movie_id, rating, genres FROM ratings WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(userId, MAX_ITEMS)
      .all()
      .catch(() => ({ results: [] })) // table missing until schema.sql is re-run
  ).results;

  const rated = new Set(ratings.map((r) => r.movie_id));
  const unrated = marks.filter((m) => !rated.has(m.movie_id) && WEIGHTS[m.status]);
  const info = unrated.length ? await infoFor(env, unrated.map((m) => m.movie_id), "ru") : {};

  const genres = {};
  const add = (ids, w) => {
    for (const g of ids) genres[g] = (genres[g] || 0) + w;
  };
  for (const r of ratings) add(JSON.parse(r.genres || "[]"), r.rating);
  for (const m of unrated) add(info[m.movie_id]?.genreIds || [], WEIGHTS[m.status]);
  for (const g of Object.keys(genres)) genres[g] = Math.round(genres[g] * 100) / 100;

  return {
    genres,
    seeds: ratings.filter((r) => r.rating === 1 && /^[mt]\d+$/.test(r.movie_id)).map((r) => r.movie_id).slice(0, 20),
    rated: ratings.length,
    marked: marks.length,
  };
}

// What the "🧠 My taste" box shows: strongest likes and dislikes.
export async function tasteSummary(env, userId) {
  const taste = await computeTaste(env, userId);
  const sorted = Object.entries(taste.genres).sort((a, b) => b[1] - a[1]);
  return {
    likes: sorted.filter(([, v]) => v >= 0.5).slice(0, 6).map(([g, v]) => ({ genre: g, score: v })),
    dislikes: sorted.filter(([, v]) => v <= -0.5).reverse().slice(0, 4).map(([g, v]) => ({ genre: g, score: v })),
    rated: taste.rated,
    marked: taste.marked,
  };
}
