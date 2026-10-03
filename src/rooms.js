// Movie night with friends: one person creates a room and shares the link,
// everyone answers mood/time/services, the organiser presses "pick" and everyone sees the same result.
import { HttpError } from "./auth.js";
import { checkAnswers, groupCriteria, pick } from "./recommend.js";
import { getMarks } from "./lists.js";
import { withTmdb } from "./tmdb.js";

const ROOM_MS = 24 * 3600_000; // rooms last one day
const MAX_MEMBERS = 12;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function loadRoom(env, rawCode) {
  const code = String(rawCode || "").toUpperCase();
  const room = await env.DB.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first();
  if (!room || Date.now() - room.created_at > ROOM_MS) {
    throw new HttpError(404, "Комната не найдена или уже закончилась — создай новую");
  }
  return room;
}

export async function createRoom(env, user) {
  if (!user.profile) throw new HttpError(409, "Сначала ответь на пару вопросов");
  // Clean up old rooms now and then.
  await env.DB.prepare("DELETE FROM rooms WHERE created_at < ?").bind(Date.now() - ROOM_MS).run();
  const code = newCode();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rooms (code, owner_id, created_at) VALUES (?, ?, ?)").bind(code, user.id, now),
    env.DB.prepare("INSERT INTO room_members (code, user_id, joined_at) VALUES (?, ?, ?)").bind(code, user.id, now),
  ]);
  return { code };
}

// What everyone in the room sees. Friends are shown as "Гость 1, 2…" — no emails are shared.
export async function roomState(env, user, rawCode) {
  const room = await loadRoom(env, rawCode);
  const { results } = await env.DB.prepare(
    "SELECT user_id, answers FROM room_members WHERE code = ? ORDER BY joined_at",
  )
    .bind(room.code)
    .all();
  let guest = 0;
  const members = results.map((r) => {
    const isOwner = r.user_id === room.owner_id;
    return {
      label: isOwner ? "Организатор" : `Гость ${++guest}`,
      you: r.user_id === user.id,
      ready: Boolean(r.answers),
    };
  });
  const mine = results.find((r) => r.user_id === user.id);
  return {
    code: room.code,
    isOwner: room.owner_id === user.id,
    joined: Boolean(mine),
    myAnswers: mine?.answers ? JSON.parse(mine.answers) : null,
    members,
    result: room.result ? JSON.parse(room.result) : null,
  };
}

// Join the room; with answers it also marks you as ready.
export async function joinRoom(env, user, rawCode, body) {
  if (!user.profile) throw new HttpError(409, "Сначала ответь на пару вопросов");
  const room = await loadRoom(env, rawCode);
  const answers = body?.mood ? checkAnswers(body) : null;

  const existing = await env.DB.prepare("SELECT 1 FROM room_members WHERE code = ? AND user_id = ?")
    .bind(room.code, user.id)
    .first();
  if (!existing) {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE code = ?").bind(room.code).first();
    if (n >= MAX_MEMBERS) throw new HttpError(409, "В комнате уже нет мест");
  }
  await env.DB.prepare(
    `INSERT INTO room_members (code, user_id, answers, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(code, user_id) DO UPDATE SET answers = COALESCE(excluded.answers, room_members.answers)`,
  )
    .bind(room.code, user.id, answers ? JSON.stringify(answers) : null, Date.now())
    .run();
  return roomState(env, user, room.code);
}

// Organiser only: pick one title for everyone who is ready.
export async function pickForRoom(env, user, rawCode, body) {
  const room = await loadRoom(env, rawCode);
  if (room.owner_id !== user.id) throw new HttpError(403, "Подбирает только организатор");

  const { results } = await env.DB.prepare(
    `SELECT rm.user_id, rm.answers, u.profile FROM room_members rm
     JOIN users u ON u.id = rm.user_id
     WHERE rm.code = ? AND rm.answers IS NOT NULL AND u.profile IS NOT NULL`,
  )
    .bind(room.code)
    .all();
  if (results.length === 0) throw new HttpError(409, "Пока никто не готов — отметьте свои ответы");

  const members = await Promise.all(
    results.map(async (r) => ({
      answers: JSON.parse(r.answers),
      profile: JSON.parse(r.profile),
      marks: await getMarks(env, r.user_id),
    })),
  );
  const criteria = groupCriteria(members);
  // "Another one" in a room: don't repeat what this room already got.
  const previous = Array.isArray(body?.exclude) ? body.exclude.slice(0, 100) : [];
  for (const id of previous) criteria.exclude.add(id);

  const result = await withTmdb(env, { ...pick(env, criteria), groupSize: members.length }, criteria.services);
  await env.DB.prepare("UPDATE rooms SET result = ? WHERE code = ?").bind(JSON.stringify(result), room.code).run();
  return roomState(env, user, room.code);
}
