// Movie night with friends: one person creates a room and shares the link, everyone answers
// mood/time/services, the organiser gets 3 options, everyone votes, the winner is shown to all.
//
// rooms.result holds the state as JSON:
//   null                                              — nothing picked yet
//   { stage: "voting", options: [3 results], votes: { userId: optionIndex }, vetoes: { userId: optionIndex }, groupSize }
//   { stage: "final", movie: result, votes: [counts], groupSize }
import { HttpError } from "./auth.js";
import { checkAnswers, groupCriteria, pickAny } from "./recommend.js";
import { getMarks } from "./lists.js";
import { computeTaste } from "./taste.js";
import { requestFriend, relationTo } from "./friends.js";

const ROOM_MS = 24 * 3600_000; // rooms last one day
const MAX_MEMBERS = 12;
const OPTIONS = 3;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function loadRoom(env, rawCode) {
  const code = String(rawCode || "").toUpperCase();
  const room = await env.DB.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first();
  if (!room || Date.now() - room.created_at > ROOM_MS) throw new HttpError(404, "err.noRoom");
  return { ...room, result: room.result ? JSON.parse(room.result) : null };
}

async function saveResult(env, code, result) {
  await env.DB.prepare("UPDATE rooms SET result = ? WHERE code = ?").bind(JSON.stringify(result), code).run();
}

async function members(env, code) {
  const { results } = await env.DB.prepare(
    `SELECT rm.user_id, rm.answers, fc.nickname FROM room_members rm
     LEFT JOIN friend_codes fc ON fc.user_id = rm.user_id
     WHERE rm.code = ? ORDER BY rm.joined_at`,
  )
    .bind(code)
    .all();
  return results;
}

async function startTime(env, code) {
  const row = await env.DB.prepare("SELECT start_time FROM room_meta WHERE code = ?").bind(code).first().catch(() => null);
  return row?.start_time || null;
}

export async function createRoom(env, user) {
  if (!user.profile) throw new HttpError(409, "err.profileFirst");
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

function counts(result, key = "votes") {
  const c = Array(result.options.length).fill(0);
  for (const i of Object.values(result[key] || {})) c[i]++;
  return c;
}

// What everyone in the room sees. Friends are shown as "guest 1, 2…" — no emails are shared.
export async function roomState(env, user, rawCode) {
  const room = await loadRoom(env, rawCode);
  const list = await members(env, room.code);
  const others = list.map((r) => r.user_id).filter((id) => id !== user.id);
  const rel = await relationTo(env, user.id, others);
  let guest = 0;
  const people = list.map((r, ref) => ({
    ref, // position in the room — used for "➕ add as friend" (no user ids are shared)
    owner: r.user_id === room.owner_id,
    guest: r.user_id === room.owner_id ? null : ++guest,
    nickname: r.nickname || null,
    you: r.user_id === user.id,
    ready: Boolean(r.answers),
    mood: r.answers ? JSON.parse(r.answers).mood : null,
    voted: room.result?.stage === "voting" && String(r.user_id) in room.result.votes,
    friend: rel.friends.has(r.user_id),
    requested: rel.requested.has(r.user_id),
  }));
  const mine = list.find((r) => r.user_id === user.id);
  const r = room.result;
  let result = null;
  if (r?.stage === "voting") {
    result = {
      stage: "voting", options: r.options, counts: counts(r), vetoes: counts(r, "vetoes"),
      myVote: r.votes[user.id] ?? null, myVeto: r.vetoes?.[user.id] ?? null, groupSize: r.groupSize,
    };
  } else if (r?.stage === "final") {
    result = { stage: "final", movie: r.movie, counts: r.votes, groupSize: r.groupSize };
  }
  return {
    code: room.code,
    isOwner: room.owner_id === user.id,
    joined: Boolean(mine),
    myAnswers: mine?.answers ? JSON.parse(mine.answers) : null,
    members: people,
    startTime: await startTime(env, room.code),
    result,
  };
}

// Join the room; with answers it also marks you as ready.
export async function joinRoom(env, user, rawCode, body) {
  if (!user.profile) throw new HttpError(409, "err.profileFirst");
  const room = await loadRoom(env, rawCode);
  const answers = body?.mood ? checkAnswers(body) : null;

  const existing = await env.DB.prepare("SELECT 1 FROM room_members WHERE code = ? AND user_id = ?")
    .bind(room.code, user.id)
    .first();
  if (!existing) {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE code = ?").bind(room.code).first();
    if (n >= MAX_MEMBERS) throw new HttpError(409, "err.roomFull");
  }
  await env.DB.prepare(
    `INSERT INTO room_members (code, user_id, answers, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(code, user_id) DO UPDATE SET answers = COALESCE(excluded.answers, room_members.answers)`,
  )
    .bind(room.code, user.id, answers ? JSON.stringify(answers) : null, Date.now())
    .run();
  return roomState(env, user, room.code);
}

// Organiser only: find 3 options for everyone who is ready, and start the vote.
export async function pickForRoom(env, user, rawCode, body, lang) {
  const room = await loadRoom(env, rawCode);
  if (room.owner_id !== user.id) throw new HttpError(403, "err.ownerOnly");

  const { results } = await env.DB.prepare(
    `SELECT rm.user_id, rm.answers, u.profile FROM room_members rm
     JOIN users u ON u.id = rm.user_id
     WHERE rm.code = ? AND rm.answers IS NOT NULL AND u.profile IS NOT NULL`,
  )
    .bind(room.code)
    .all();
  if (results.length === 0) throw new HttpError(409, "err.nobodyReady");

  const people = await Promise.all(
    results.map(async (r) => ({
      answers: JSON.parse(r.answers),
      profile: JSON.parse(r.profile),
      marks: await getMarks(env, r.user_id),
      taste: (await computeTaste(env, r.user_id)).genres,
    })),
  );
  const criteria = groupCriteria(people, lang);
  // "New options": don't repeat what this room already got.
  const previous = Array.isArray(body?.exclude) ? body.exclude.slice(0, 100) : [];
  for (const id of previous) criteria.exclude.add(id);

  const options = await pickAny(env, criteria, OPTIONS);
  if (options.length === 1) {
    await saveResult(env, room.code, { stage: "final", movie: options[0], votes: [], groupSize: people.length });
  } else {
    await saveResult(env, room.code, { stage: "voting", options, votes: {}, vetoes: {}, groupSize: people.length });
  }
  return roomState(env, user, room.code);
}

// Anyone in the room votes for option `index`. When every ready member has voted, the vote ends.
export async function voteInRoom(env, user, rawCode, index) {
  const room = await loadRoom(env, rawCode);
  const r = room.result;
  if (r?.stage !== "voting") throw new HttpError(409, "err.noVoting");
  if (!Number.isInteger(index) || index < 0 || index >= r.options.length) throw new HttpError(400, "err.badRequest");
  const list = await members(env, room.code);
  if (!list.some((m) => m.user_id === user.id)) throw new HttpError(403, "err.forbidden");

  r.votes[user.id] = index;
  const ready = list.filter((m) => m.answers).map((m) => String(m.user_id));
  const everyoneVoted = ready.length > 0 && ready.every((id) => id in r.votes);
  await saveResult(env, room.code, everyoneVoted ? finalize(r) : r);
  return roomState(env, user, room.code);
}

// Organiser only: end the vote now.
export async function finishVote(env, user, rawCode) {
  const room = await loadRoom(env, rawCode);
  if (room.owner_id !== user.id) throw new HttpError(403, "err.ownerOnly");
  if (room.result?.stage !== "voting") throw new HttpError(409, "err.noVoting");
  await saveResult(env, room.code, finalize(room.result));
  return roomState(env, user, room.code);
}

// Most votes wins among options nobody vetoed (if everything was vetoed, vetoes are ignored);
// a tie (or no votes) is decided at random among the leaders.
function finalize(r) {
  const c = counts(r);
  const v = counts(r, "vetoes");
  let allowed = c.map((_, i) => i).filter((i) => v[i] === 0);
  if (!allowed.length) allowed = c.map((_, i) => i);
  const top = Math.max(...allowed.map((i) => c[i]));
  const leaders = allowed.filter((i) => c[i] === top);
  const winner = leaders[Math.floor(Math.random() * leaders.length)];
  return { stage: "final", movie: r.options[winner], votes: c, groupSize: r.groupSize };
}

// "❌ Definitely not": everyone can veto one option (pressing again on the same option removes it).
export async function vetoInRoom(env, user, rawCode, index) {
  const room = await loadRoom(env, rawCode);
  const r = room.result;
  if (r?.stage !== "voting") throw new HttpError(409, "err.noVoting");
  if (!Number.isInteger(index) || index < 0 || index >= r.options.length) throw new HttpError(400, "err.badRequest");
  const list = await members(env, room.code);
  if (!list.some((m) => m.user_id === user.id)) throw new HttpError(403, "err.forbidden");
  r.vetoes = r.vetoes || {};
  if (r.vetoes[user.id] === index) delete r.vetoes[user.id];
  else r.vetoes[user.id] = index;
  await saveResult(env, room.code, r);
  return roomState(env, user, room.code);
}

// Organiser: "we watch at 20:30" ("" clears it).
export async function setRoomTime(env, user, rawCode, time) {
  const room = await loadRoom(env, rawCode);
  if (room.owner_id !== user.id) throw new HttpError(403, "err.ownerOnly");
  const value = String(time || "");
  if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new HttpError(400, "err.badTime");
  await env.DB.prepare(
    "INSERT INTO room_meta (code, start_time) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET start_time = excluded.start_time",
  )
    .bind(room.code, value || null)
    .run();
  return roomState(env, user, room.code);
}

// "➕ Add as friend" for someone in the same room (they get a request to accept).
export async function befriendInRoom(env, user, rawCode, ref) {
  const room = await loadRoom(env, rawCode);
  const list = await members(env, room.code);
  if (!list.some((m) => m.user_id === user.id)) throw new HttpError(403, "err.forbidden");
  const other = list[Number(ref)];
  if (!other) throw new HttpError(400, "err.badRequest");
  await requestFriend(env, user.id, other.user_id);
  return roomState(env, user, room.code);
}
