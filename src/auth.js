// Email + password login with sessions stored in D1.
// Passwords are hashed with PBKDF2 (salted); sessions are random tokens in an HttpOnly cookie.

const PBKDF2_ITERATIONS = 100_000; // the maximum Workers allows
const SESSION_DAYS = 30;
const COOKIE = "session";

// Rate limits: [max attempts, window in ms]. Counted per key in the `attempts` table.
const LIMITS = {
  "login-email": [5, 15 * 60_000], // wrong passwords for one account
  "login-ip": [20, 15 * 60_000], // wrong passwords from one network
  "reset-ip": [10, 15 * 60_000], // wrong recovery codes from one network
  "reg-ip": [10, 60 * 60_000], // new accounts from one network
};
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups

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
    throw new HttpError(400, "err.email");
  }
  if (password.length < 8 || password.length > 200) {
    throw new HttpError(400, "err.password");
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
  await env.DB.prepare("DELETE FROM attempts WHERE at < ?").bind(Date.now() - 86400_000).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

function readToken(request) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return match ? match[1] : null;
}

async function tooMany(env, kind, value) {
  const [max, windowMs] = LIMITS[kind];
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?")
    .bind(`${kind}:${value}`, Date.now() - windowMs)
    .first();
  return row.n >= max;
}

async function recordAttempt(env, kind, value) {
  await env.DB.prepare("INSERT INTO attempts (key, at) VALUES (?, ?)").bind(`${kind}:${value}`, Date.now()).run();
}

async function guard(env, checks) {
  for (const [kind, value] of checks) {
    if (await tooMany(env, kind, value)) {
      throw new HttpError(429, "err.tooMany");
    }
  }
}

function normalizeCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Creates (or replaces) the user's recovery code and returns it. Only its hash is stored.
export async function newRecoveryCode(env, userId) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  await env.DB.prepare(
    "INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash",
  )
    .bind(userId, await sha256Hex(raw))
    .run();
  return raw.match(/..../g).join("-");
}

export async function register(env, rawEmail, rawPassword, ip) {
  await guard(env, [["reg-ip", ip]]);
  const { email, password } = checkCredentials(rawEmail, rawPassword);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) throw new HttpError(409, "err.emailTaken");

  const salt = randomHex(16);
  const passHash = await hashPassword(password, salt);
  const result = await env.DB.prepare(
    "INSERT INTO users (email, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(email, passHash, salt, Date.now())
    .run();
  await recordAttempt(env, "reg-ip", ip);
  const userId = result.meta.last_row_id;
  return { cookie: await startSession(env, userId), recoveryCode: await newRecoveryCode(env, userId) };
}

export async function login(env, rawEmail, rawPassword, ip) {
  const email = String(rawEmail || "").trim().toLowerCase();
  const password = String(rawPassword || "");
  await guard(env, [["login-email", email], ["login-ip", ip]]);
  const user = await env.DB.prepare("SELECT id, pass_hash, salt FROM users WHERE email = ?").bind(email).first();

  // Hash even when the user doesn't exist, so response time doesn't reveal which emails are registered.
  const hash = await hashPassword(password, user ? user.salt : "00".repeat(16));
  if (!user || !sameHash(hash, user.pass_hash)) {
    await recordAttempt(env, "login-email", email);
    await recordAttempt(env, "login-ip", ip);
    throw new HttpError(401, "err.badLogin");
  }
  await env.DB.prepare("DELETE FROM attempts WHERE key = ?").bind(`login-email:${email}`).run();
  return startSession(env, user.id);
}

// Forgotten password: email + recovery code → new password. Logs out all other devices.
export async function resetPassword(env, rawEmail, rawCode, rawPassword, ip) {
  const { email, password } = checkCredentials(rawEmail, rawPassword);
  await guard(env, [["login-email", email], ["reset-ip", ip]]);

  const row = await env.DB.prepare(
    "SELECT u.id, r.code_hash FROM users u JOIN recovery_codes r ON r.user_id = u.id WHERE u.email = ?",
  )
    .bind(email)
    .first();
  const codeHash = await sha256Hex(normalizeCode(rawCode));
  if (!row || !sameHash(codeHash, row.code_hash)) {
    await recordAttempt(env, "login-email", email);
    await recordAttempt(env, "reset-ip", ip);
    throw new HttpError(401, "err.badCode");
  }

  const salt = randomHex(16);
  await env.DB.prepare("UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?")
    .bind(await hashPassword(password, salt), salt, row.id)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
  await env.DB.prepare("DELETE FROM attempts WHERE key = ?").bind(`login-email:${email}`).run();
  // The old code is used up — give a fresh one.
  return { cookie: await startSession(env, row.id), recoveryCode: await newRecoveryCode(env, row.id) };
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
