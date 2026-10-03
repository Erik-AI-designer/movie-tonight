import { register, login, logout, resetPassword, newRecoveryCode, getUser, HttpError } from "./auth.js";
import { saveProfile, validateProfile } from "./profile.js";
import { checkAnswers, criteriaFor, pickAny } from "./recommend.js";
import { getMarks, setMark, getList, getTaste, recordClick, pendingFeedback, saveFeedback, isAdmin, stats } from "./lists.js";
import { createRoom, roomState, joinRoom, pickForRoom, voteInRoom, finishVote } from "./rooms.js";
import { langOf, t } from "./i18n.js";

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
    const { email, password } = await readBody(request);
    const { cookie, recoveryCode } = await register(env, email, password, ip);
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

  // Everything below needs a logged-in user.
  const user = await getUser(env, request);
  if (!user) throw new HttpError(401, "err.login");

  if (pathname === "/api/me" && method === "GET") {
    return json({ email: user.email, profile: user.profile, isAdmin: isAdmin(env, user) });
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
    const criteria = criteriaFor(user.profile, answers, marks, await getTaste(env, user.id), lang, shown);
    const [result] = await pickAny(env, criteria, 1);
    return json({ ...result, saved: marks.saved.has(result.id) });
  }

  if (pathname === "/api/list" && method === "GET") {
    return json(await getList(env, user.id, lang));
  }

  if (pathname === "/api/list" && method === "POST") {
    const { movieId, status } = await readBody(request);
    await setMark(env, user.id, movieId, status ?? null);
    return json({ ok: true });
  }

  if (pathname === "/api/click" && method === "POST") {
    const { movieId, service, title } = await readBody(request);
    await recordClick(env, user.id, movieId, service, title);
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

  if (pathname === "/api/rooms" && method === "POST") {
    return json(await createRoom(env, user));
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/join|\/pick|\/vote|\/finish)?$/);
  if (roomMatch) {
    const [, code, action] = roomMatch;
    if (!action && method === "GET") return json(await roomState(env, user, code));
    if (method === "POST") {
      const body = await readBody(request);
      if (action === "/join") return json(await joinRoom(env, user, code, body));
      if (action === "/pick") return json(await pickForRoom(env, user, code, body, lang));
      if (action === "/vote") return json(await voteInRoom(env, user, code, body.index));
      if (action === "/finish") return json(await finishVote(env, user, code));
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
