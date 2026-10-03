import { register, login, logout, resetPassword, newRecoveryCode, getUser, limit, HttpError } from "./auth.js";
import { saveProfile, validateProfile } from "./profile.js";
import { checkAnswers, criteriaFor, trialCriteria, pickAny } from "./recommend.js";
import { getMarks, setMark, getList, recordClick, pendingFeedback, saveFeedback, setRating, bulkMark, isAdmin, stats } from "./lists.js";
import { computeTaste, tasteSummary } from "./taste.js";
import { search, titleCard } from "./search.js";
import { createRoom, roomState, joinRoom, pickForRoom, voteInRoom, finishVote, vetoInRoom, setRoomTime, befriendInRoom } from "./rooms.js";
import { langOf, t } from "./i18n.js";
import {
  setNickname, addFriend, removeFriend, friendsPage, friendNames,
  recommendToFriend, dismissRecommendation, newRecommendationCount, answerRequest,
} from "./friends.js";
import { recap, exportData, deleteAccount } from "./account.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "err.badRequest");
  }
}

async function route(request, env, url, lang) {
  const { pathname } = url;
  const method = request.method;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  if (method === "POST") {
    // Basic CSRF protection: POSTs must come from our own pages, as JSON.
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "err.forbidden");
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      throw new HttpError(415, "err.json");
    }
  }

  if (pathname === "/api/register" && method === "POST") {
    const { email, password, consent } = await readBody(request);
    const { cookie, recoveryCode } = await register(env, email, password, ip, consent);
    return json({ ok: true, recoveryCode }, 200, { "set-cookie": cookie });
  }

  if (pathname === "/api/login" && method === "POST") {
    const { email, password } = await readBody(request);
    const cookie = await login(env, email, password, ip);
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  if (pathname === "/api/reset" && method === "POST") {
    const { email, code, password } = await readBody(request);
    const { cookie, recoveryCode } = await resetPassword(env, email, code, password, ip);
    return json({ ok: true, recoveryCode }, 200, { "set-cookie": cookie });
  }

  if (pathname === "/api/logout" && method === "POST") {
    const cookie = await logout(env, request);
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  // Contact email for the privacy page (set as a secret, so it isn't in the public code).
  if (pathname === "/api/config" && method === "GET") {
    return json({ contact: env.CONTACT_EMAIL || null });
  }

  // 🎲 One free pick without an account (once per browser, and at most 10 per hour per network).
  if (pathname === "/api/try" && method === "POST") {
    if (/(?:^|;\s*)tried=1/.test(request.headers.get("cookie") || "")) throw new HttpError(403, "err.trialUsed");
    const answers = checkAnswers(await readBody(request));
    await limit(env, "try-ip", ip);
    const [result] = await pickAny(env, trialCriteria(answers, lang), 1);
    return json(result, 200, { "set-cookie": "tried=1; Path=/; Max-Age=2592000; Secure; SameSite=Lax" });
  }

  const user = await getUser(env, request);

  // Clicks on "Watch on …" are counted even for the trial pick (without an account).
  if (pathname === "/api/click" && method === "POST") {
    const { movieId, service, title } = await readBody(request);
    await recordClick(env, user?.id ?? null, movieId, service, title);
    return json({ ok: true });
  }

  // Everything below needs a logged-in user.
  if (!user) throw new HttpError(401, "err.login");

  if (pathname === "/api/me" && method === "GET") {
    return json({
      email: user.email,
      profile: user.profile,
      isAdmin: isAdmin(env, user),
      newRecommendations: await newRecommendationCount(env, user.id),
    });
  }

  if (pathname === "/api/profile" && method === "POST") {
    const profile = validateProfile(await readBody(request));
    await saveProfile(env, user.id, profile);
    return json({ ok: true, profile });
  }

  if (pathname === "/api/recovery-code" && method === "POST") {
    return json({ recoveryCode: await newRecoveryCode(env, user.id) });
  }

  if (pathname === "/api/recommend" && method === "POST") {
    if (!user.profile) throw new HttpError(409, "err.profileFirst");
    const body = await readBody(request);
    const answers = checkAnswers(body);
    const shown = Array.isArray(body.exclude) ? body.exclude.slice(0, 100) : [];
    const marks = await getMarks(env, user.id);
    const taste = await computeTaste(env, user.id);
    const criteria = criteriaFor(user.profile, answers, marks, taste.genres, lang, shown);
    criteria.seeds = taste.seeds; // "because you liked …"
    const [result] = await pickAny(env, criteria, 1);
    return json({ ...result, saved: marks.saved.has(result.id) });
  }

  if (pathname === "/api/list" && method === "GET") {
    return json(await getList(env, user.id, lang));
  }

  if (pathname === "/api/list/bulk" && method === "POST") {
    const { movieIds, status } = await readBody(request);
    await bulkMark(env, user.id, movieIds, status);
    return json({ ok: true });
  }

  // ---------- 🧠 Taste and 🔍 search ----------
  if (pathname === "/api/taste" && method === "GET") return json(await tasteSummary(env, user.id));
  if (pathname === "/api/search" && method === "GET") {
    return json({ results: await search(env, url.searchParams.get("q"), lang) });
  }
  const titleMatch = pathname.match(/^\/api\/title\/([a-z0-9-]{1,40})$/);
  if (titleMatch && method === "GET") return json(await titleCard(env, user, titleMatch[1], lang));
  if (pathname === "/api/rate" && method === "POST") {
    const { movieId, rating } = await readBody(request);
    // Make sure we know the genres (titleCard caches TMDB details), so the rating teaches the taste.
    const card = rating ? await titleCard(env, user, movieId, lang).catch(() => null) : null;
    await setRating(env, user.id, movieId, rating, card?.genreIds);
    return json({ ok: true });
  }

  if (pathname === "/api/list" && method === "POST") {
    const { movieId, status } = await readBody(request);
    await setMark(env, user.id, movieId, status ?? null);
    return json({ ok: true });
  }

  if (pathname === "/api/feedback" && method === "GET") {
    return json({ item: await pendingFeedback(env, user.id, lang) });
  }

  if (pathname === "/api/feedback" && method === "POST") {
    const { movieId, rating } = await readBody(request);
    await saveFeedback(env, user.id, movieId, rating);
    return json({ ok: true });
  }

  if (pathname === "/api/stats" && method === "GET") {
    if (!isAdmin(env, user)) throw new HttpError(403, "err.admin");
    return json(await stats(env));
  }

  // ---------- 🤝 Friends ----------
  if (pathname === "/api/friends" && method === "GET") return json(await friendsPage(env, user.id, lang));
  if (pathname === "/api/friends/names" && method === "GET") return json({ friends: await friendNames(env, user.id) });
  if (pathname.startsWith("/api/friends/") && method === "POST") {
    const body = await readBody(request);
    const action = pathname.slice("/api/friends/".length);
    if (action === "nickname") return json(await setNickname(env, user.id, body.nickname));
    if (action === "add") await addFriend(env, user.id, body.code);
    else if (action === "remove") await removeFriend(env, user.id, body.code);
    else if (action === "recommend") await recommendToFriend(env, user.id, body.code, body.movieId);
    else if (action === "dismiss") await dismissRecommendation(env, user.id, body.id);
    else if (action === "answer") await answerRequest(env, user.id, body.id, body.accept === true);
    else throw new HttpError(404, "err.notFound");
    return json({ ok: true });
  }

  // ---------- 📅 Monthly recap ----------
  if (pathname === "/api/recap" && method === "GET") {
    return json(await recap(env, user.id, url.searchParams.get("month"), lang));
  }

  // ---------- 🔒 Privacy: download my data / delete my account ----------
  if (pathname === "/api/export" && method === "GET") {
    return json(await exportData(env, user), 200, {
      "content-disposition": 'attachment; filename="movie-tonight-my-data.json"',
    });
  }
  if (pathname === "/api/account/delete" && method === "POST") {
    const { password } = await readBody(request);
    await deleteAccount(env, user, password);
    return json({ ok: true }, 200, { "set-cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
  }

  if (pathname === "/api/rooms" && method === "POST") {
    return json(await createRoom(env, user));
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/join|\/pick|\/vote|\/finish|\/veto|\/time|\/befriend)?$/);
  if (roomMatch) {
    const [, code, action] = roomMatch;
    if (!action && method === "GET") return json(await roomState(env, user, code));
    if (method === "POST") {
      const body = await readBody(request);
      if (action === "/join") return json(await joinRoom(env, user, code, body));
      if (action === "/pick") return json(await pickForRoom(env, user, code, body, lang));
      if (action === "/vote") return json(await voteInRoom(env, user, code, body.index));
      if (action === "/finish") return json(await finishVote(env, user, code));
      if (action === "/veto") return json(await vetoInRoom(env, user, code, body.index));
      if (action === "/time") return json(await setRoomTime(env, user, code, body.time));
      if (action === "/befriend") return json(await befriendInRoom(env, user, code, body.ref));
    }
  }

  throw new HttpError(404, "err.notFound");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const lang = langOf(request);
    try {
      return await route(request, env, url, lang);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: t(lang, err.message) }, err.status);
      console.error(err);
      return json({ error: t(lang, "err.generic") }, 500);
    }
  },
};
