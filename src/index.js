import { register, login, logout, getUser, HttpError } from "./auth.js";
import { saveProfile, validateProfile } from "./profile.js";
import { recommend } from "./recommend.js";

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
    const cookie = await register(env, email, password);
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  if (pathname === "/api/login" && method === "POST") {
    const { email, password } = await readBody(request);
    const cookie = await login(env, email, password);
    return json({ ok: true }, 200, { "set-cookie": cookie });
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

  if (pathname === "/api/recommend" && method === "POST") {
    if (!user.profile) throw new HttpError(409, "Сначала ответь на пару вопросов");
    const pick = recommend(env, user.profile, await readBody(request));
    return json(pick);
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
