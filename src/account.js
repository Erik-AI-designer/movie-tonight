// Monthly recap, "download my data" and "delete my account" (GDPR: right of access and right to erasure).
import { checkPassword } from "./auth.js";
import { infoFor } from "./lists.js";
import { myFriendInfo } from "./friends.js";

// ---------- 📅 Monthly recap ----------
// month = "2026-10" (defaults to this month). Counts what was marked seen / rated in that month.
export async function recap(env, userId, rawMonth, lang) {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(String(rawMonth || ""));
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const from = Date.UTC(year, month, 1);
  const to = Date.UTC(year, month + 1, 1);

  const seen = await env.DB.prepare(
    "SELECT movie_id FROM user_movies WHERE user_id = ? AND status = 'seen' AND created_at >= ? AND created_at < ?",
  )
    .bind(userId, from, to)
    .all();
  const rated = await env.DB.prepare(
    "SELECT movie_id, rating FROM ratings WHERE user_id = ? AND created_at >= ? AND created_at < ?",
  )
    .bind(userId, from, to)
    .all()
    .catch(() => ({ results: [] }));
  const clicks = await env.DB.prepare(
    "SELECT service, COUNT(*) AS n FROM clicks WHERE user_id = ? AND at >= ? AND at < ? GROUP BY service ORDER BY n DESC",
  )
    .bind(userId, from, to)
    .all()
    .catch(() => ({ results: [] }));

  const ratingOf = Object.fromEntries(rated.results.map((r) => [r.movie_id, r.rating]));
  const ids = [...new Set([...seen.results.map((r) => r.movie_id), ...Object.keys(ratingOf)])];
  const info = await infoFor(env, ids, lang);
  const watched = ids.map((id) => info[id]).filter(Boolean);

  const genreCount = {};
  for (const w of watched) for (const g of w.genreIds || []) genreCount[g] = (genreCount[g] || 0) + 1;
  const topGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const liked = watched.filter((w) => ratingOf[w.id] === 1);

  return {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    watched: watched.length,
    series: watched.filter((w) => w.type === "series").length,
    minutes: watched.reduce((sum, w) => sum + (w.type === "series" ? 0 : w.runtime || 0), 0),
    liked: liked.length,
    disliked: watched.filter((w) => ratingOf[w.id] === -1).length,
    topGenre,
    topService: clicks.results[0]?.service || null,
    // Liked titles first, then the rest; up to 6 for the posters on the card.
    titles: [...liked, ...watched.filter((w) => ratingOf[w.id] !== 1)].slice(0, 6).map((w) => ({
      id: w.id, title: w.title, year: w.year, poster: w.poster || null, type: w.type, rating: ratingOf[w.id] ?? null,
    })),
  };
}

// ---------- Download my data ----------
export async function exportData(env, user) {
  const q = (sql) => env.DB.prepare(sql).bind(user.id).all().then((r) => r.results).catch(() => []);
  const row = await env.DB.prepare("SELECT created_at FROM users WHERE id = ?").bind(user.id).first();
  return {
    exportedAt: new Date().toISOString(),
    account: { email: user.email, createdAt: new Date(row.created_at).toISOString(), answers: user.profile },
    friendCode: await myFriendInfo(env, user.id),
    lists: await q("SELECT movie_id, status, created_at FROM user_movies WHERE user_id = ?"),
    ratings: await q("SELECT movie_id, rating, created_at FROM ratings WHERE user_id = ?"),
    clicks: await q("SELECT movie_id, title, service, at FROM clicks WHERE user_id = ?"),
    friends: await q(
      `SELECT fc.nickname, f.created_at FROM friendships f JOIN friend_codes fc ON fc.user_id = f.friend_id WHERE f.user_id = ?`,
    ),
    recommendationsSent: await q("SELECT to_id, movie_id, created_at FROM recommendations WHERE from_id = ?"),
    recommendationsReceived: await q("SELECT movie_id, created_at FROM recommendations WHERE to_id = ?"),
    note: "Password and recovery code are stored only as one-way hashes, so they can't be shown.",
  };
}

// ---------- Delete my account ----------
// Needs the password again. Removes the user and everything linked to them.
// Click stats are kept without the user (only movie + service + time remain).
export async function deleteAccount(env, user, password) {
  await checkPassword(env, user.id, password);
  const id = user.id;
  const del = (sql) => env.DB.prepare(sql).bind(id);
  await env.DB.batch([
    del("DELETE FROM sessions WHERE user_id = ?"),
    del("DELETE FROM user_movies WHERE user_id = ?"),
    del("DELETE FROM ratings WHERE user_id = ?"),
    del("DELETE FROM recovery_codes WHERE user_id = ?"),
    del("DELETE FROM room_members WHERE user_id = ?"),
    del("DELETE FROM rooms WHERE owner_id = ?"),
    del("DELETE FROM friendships WHERE user_id = ?"),
    env.DB.prepare("DELETE FROM friendships WHERE friend_id = ?").bind(id),
    del("DELETE FROM recommendations WHERE from_id = ?"),
    env.DB.prepare("DELETE FROM recommendations WHERE to_id = ?").bind(id),
    del("DELETE FROM friend_codes WHERE user_id = ?"),
    del("UPDATE clicks SET user_id = NULL WHERE user_id = ?"),
    env.DB.prepare("DELETE FROM attempts WHERE key = ?").bind(`login-email:${user.email}`),
    del("DELETE FROM users WHERE id = ?"),
  ]);
}

