// Email + password login with sessions stored in D1.
// Passwords are hashed with PBKDF2 (salted); sessions are random tokens in an HttpOnly cookie.

const PBKDF2_ITERATIONS = 100_000; // the maximum Workers allows
const SESSION_DAYS = 30;
const COOKIE = "session";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toHex(bits);
}

function sameHash(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}

function checkCredentials(email, password) {
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new HttpError(400, "Проверь email");
  }
  if (password.length < 8 || password.length > 200) {
    throw new HttpError(400, "Пароль должен быть не короче 8 символов");
  }
  return { email, password };
}

function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function startSession(env, userId) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, expires)
    .run();
  // Opportunistic cleanup of expired sessions.
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

function readToken(request) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return match ? match[1] : null;
}

export async function register(env, rawEmail, rawPassword) {
  const { email, password } = checkCredentials(rawEmail, rawPassword);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) throw new HttpError(409, "Такой email уже зарегистрирован — попробуй войти");

  const salt = randomHex(16);
  const passHash = await hashPassword(password, salt);
  const result = await env.DB.prepare(
    "INSERT INTO users (email, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(email, passHash, salt, Date.now())
    .run();
  return startSession(env, result.meta.last_row_id);
}

export async function login(env, rawEmail, rawPassword) {
  const email = String(rawEmail || "").trim().toLowerCase();
  const password = String(rawPassword || "");
  const user = await env.DB.prepare("SELECT id, pass_hash, salt FROM users WHERE email = ?").bind(email).first();

  // Hash even when the user doesn't exist, so response time doesn't reveal which emails are registered.
  const hash = await hashPassword(password, user ? user.salt : "00".repeat(16));
  if (!user || !sameHash(hash, user.pass_hash)) {
    throw new HttpError(401, "Неверный email или пароль");
  }
  return startSession(env, user.id);
}

export async function logout(env, request) {
  const token = readToken(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  return sessionCookie("", 0);
}

export async function getUser(env, request) {
  const token = readToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.profile FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first();
  if (!row) return null;
  return { id: row.id, email: row.email, profile: row.profile ? JSON.parse(row.profile) : null };
}
