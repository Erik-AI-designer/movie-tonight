import { register, login, logout, resetPassword, newRecoveryCode, getUser, HttpError } from "./auth.js";
import { saveProfile, validateProfile } from "./profile.js";
import { checkAnswers, criteriaFor, pick } from "./recommend.js";
import { getMarks, setMark, getList } from "./lists.js";
import { withTmdb } from "./tmdb.js";
import { createRoom, roomState, joinRoom, pickForRoom } from "./rooms.js";

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
    throw new HttpError(400, "Неверный запрос");
  }
}

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  if (method === "POST") {
    // Basic CSRF protection: POSTs must come from our own pages, as JSON.
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "Запрещено");
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      throw new HttpError(415, "Нужен JSON");
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
  if (!user) throw new HttpError(401, "Нужно войти");

  if (pathname === "/api/me" && method === "GET") {
    return json({ email: user.email, profile: user.profile });
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
    if (!user.profile) throw new HttpError(409, "Сначала ответь на пару вопросов");
    const body = await readBody(request);
    const answers = checkAnswers(body);
    const shown = Array.isArray(body.exclude) ? body.exclude.slice(0, 100) : [];
    const criteria = criteriaFor(user.profile, answers, await getMarks(env, user.id), shown);
    const result = await withTmdb(env, pick(env, criteria), answers.services);
    return json({ ...result, saved: criteria.saved.has(result.id) });
  }

  if (pathname === "/api/list" && method === "GET") {
    return json(await getList(env, user.id));
  }

  if (pathname === "/api/list" && method === "POST") {
    const { movieId, status } = await readBody(request);
    await setMark(env, user.id, movieId, status ?? null);
    return json({ ok: true });
  }

  if (pathname === "/api/rooms" && method === "POST") {
    return json(await createRoom(env, user));
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/join|\/pick)?$/);
  if (roomMatch) {
    const [, code, action] = roomMatch;
    if (!action && method === "GET") return json(await roomState(env, user, code));
    if (action === "/join" && method === "POST") return json(await joinRoom(env, user, code, await readBody(request)));
    if (action === "/pick" && method === "POST") return json(await pickForRoom(env, user, code, await readBody(request)));
  }

  throw new HttpError(404, "Не найдено");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Что-то пошло не так, попробуй ещё раз" }, 500);
    }
  },
};
