// Friends: everyone has a private friend code (like ABCD-2345). Sharing it lets someone add you —
// friendship is mutual right away (you chose to give them the code). Friends see each other's
// nickname (never the email) and recent 👍, and can recommend movies to each other.
import { HttpError } from "./auth.js";
import { infoFor, isKnownId } from "./lists.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_FRIENDS = 50;
const MAX_RECOMMENDATIONS_PER_DAY = 30;

const normalizeCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const pretty = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

// The user's own code + nickname (the code is created the first time it's needed).
export async function myFriendInfo(env, userId) {
  let row = await env.DB.prepare("SELECT code, nickname FROM friend_codes WHERE user_id = ?").bind(userId).first();
  if (!row) {
    const code = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    await env.DB.prepare("INSERT OR IGNORE INTO friend_codes (user_id, code) VALUES (?, ?)").bind(userId, code).run();
    row = await env.DB.prepare("SELECT code, nickname FROM friend_codes WHERE user_id = ?").bind(userId).first();
  }
  return { code: pretty(row.code), nickname: row.nickname || null };
}

export async function setNickname(env, userId, raw) {
  const nickname = String(raw || "").replace(/\s+/g, " ").trim();
  if (nickname.length < 2 || nickname.length > 24) throw new HttpError(400, "err.nickname");
  await myFriendInfo(env, userId);
  await env.DB.prepare("UPDATE friend_codes SET nickname = ? WHERE user_id = ?").bind(nickname, userId).run();
  return { nickname };
}

async function userByCode(env, rawCode) {
  const row = await env.DB.prepare("SELECT user_id FROM friend_codes WHERE code = ?").bind(normalizeCode(rawCode)).first();
  if (!row) throw new HttpError(404, "err.friendCode");
  return row.user_id;
}

async function areFriends(env, a, b) {
  return Boolean(await env.DB.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?").bind(a, b).first());
}

export async function addFriend(env, userId, rawCode) {
  const friendId = await userByCode(env, rawCode);
  if (friendId === userId) throw new HttpError(400, "err.friendSelf");
  if (await areFriends(env, userId, friendId)) return;
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM friendships WHERE user_id = ?").bind(userId).first();
  if (n >= MAX_FRIENDS) throw new HttpError(409, "err.friendsFull");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").bind(userId, friendId, now),
    env.DB.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").bind(friendId, userId, now),
  ]);
}

export async function removeFriend(env, userId, rawCode) {
  const friendId = await userByCode(env, rawCode);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").bind(userId, friendId),
    env.DB.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").bind(friendId, userId),
  ]);
}

// Everything for the 🤝 Friends screen.
export async function friendsPage(env, userId, lang) {
  const me = await myFriendInfo(env, userId);
  const { results: friends } = await env.DB.prepare(
    `SELECT f.friend_id, fc.code, fc.nickname FROM friendships f
     JOIN friend_codes fc ON fc.user_id = f.friend_id
     WHERE f.user_id = ? ORDER BY f.created_at DESC`,
  )
    .bind(userId)
    .all();

  // Each friend's latest 👍 (up to 6).
  const likes = {};
  for (const f of friends) {
    const { results } = await env.DB.prepare(
      "SELECT movie_id FROM ratings WHERE user_id = ? AND rating = 1 ORDER BY created_at DESC LIMIT 6",
    )
      .bind(f.friend_id)
      .all()
      .catch(() => ({ results: [] }));
    likes[f.friend_id] = results.map((r) => r.movie_id);
  }

  const { results: recs } = await env.DB.prepare(
    `SELECT r.id, r.movie_id, r.created_at, fc.nickname FROM recommendations r
     LEFT JOIN friend_codes fc ON fc.user_id = r.from_id
     WHERE r.to_id = ? AND r.dismissed = 0 ORDER BY r.created_at DESC LIMIT 30`,
  )
    .bind(userId)
    .all();

  const ids = [...new Set([...Object.values(likes).flat(), ...recs.map((r) => r.movie_id)])];
  const info = await infoFor(env, ids, lang);
  return {
    me,
    friends: friends.map((f) => ({
      code: pretty(f.code),
      nickname: f.nickname,
      likes: likes[f.friend_id].map((id) => info[id]).filter(Boolean),
    })),
    recommendations: recs
      .filter((r) => info[r.movie_id])
      .map((r) => ({ id: r.id, from: r.nickname, at: r.created_at, movie: info[r.movie_id] })),
  };
}

// Just the list of friends (for the "recommend to a friend" picker on a result card).
export async function friendNames(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT fc.code, fc.nickname FROM friendships f JOIN friend_codes fc ON fc.user_id = f.friend_id
     WHERE f.user_id = ? ORDER BY fc.nickname`,
  )
    .bind(userId)
    .all();
  return results.map((r) => ({ code: pretty(r.code), nickname: r.nickname }));
}

export async function recommendToFriend(env, userId, rawCode, movieId) {
  if (!isKnownId(movieId)) throw new HttpError(400, "err.noMovie");
  const friendId = await userByCode(env, rawCode);
  if (!(await areFriends(env, userId, friendId))) throw new HttpError(403, "err.notFriends");
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM recommendations WHERE from_id = ? AND created_at > ?")
    .bind(userId, Date.now() - 86400_000)
    .first();
  if (n >= MAX_RECOMMENDATIONS_PER_DAY) throw new HttpError(429, "err.tooMany");
  // Don't recommend the same thing twice.
  await env.DB.prepare("DELETE FROM recommendations WHERE from_id = ? AND to_id = ? AND movie_id = ?").bind(userId, friendId, movieId).run();
  await env.DB.prepare("INSERT INTO recommendations (from_id, to_id, movie_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(userId, friendId, movieId, Date.now())
    .run();
}

export async function dismissRecommendation(env, userId, id) {
  await env.DB.prepare("UPDATE recommendations SET dismissed = 1 WHERE id = ? AND to_id = ?").bind(Number(id) || 0, userId).run();
}

// Number of new recommendations (for the badge on the 🤝 button).
export async function newRecommendationCount(env, userId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM recommendations WHERE to_id = ? AND dismissed = 0")
    .bind(userId)
    .first()
    .catch(() => ({ n: 0 })); // table missing until schema.sql is re-run
  return row?.n || 0;
}
