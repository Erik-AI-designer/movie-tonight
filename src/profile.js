// The onboarding questions asked right after the first login.
import { HttpError } from "./auth.js";
import { GENRES, SERVICES } from "./movies.js";

// Age group -> highest age rating the user may be shown.
export const AGE_GROUPS = {
  u13: 6,
  "13-15": 12,
  "16-17": 16,
  "18+": 18,
};

export const VIBES = ["light", "deep", "both"];

function pickList(value, allowed) {
  return Array.isArray(value) ? [...new Set(value.filter((v) => allowed.includes(v)))] : [];
}

export function validateProfile(body) {
  const ageGroup = body?.ageGroup;
  if (!(ageGroup in AGE_GROUPS)) throw new HttpError(400, "Выбери возраст");

  const genreIds = Object.keys(GENRES);
  const favoriteGenres = pickList(body.favoriteGenres, genreIds);
  if (favoriteGenres.length === 0) throw new HttpError(400, "Выбери хотя бы один любимый жанр");

  // A genre can't be both a favorite and disliked.
  const dislikedGenres = pickList(body.dislikedGenres, genreIds).filter((g) => !favoriteGenres.includes(g));

  const vibe = VIBES.includes(body.vibe) ? body.vibe : "both";
  const services = pickList(body.services, Object.keys(SERVICES));

  return { ageGroup, favoriteGenres, dislikedGenres, vibe, services };
}

export async function saveProfile(env, userId, profile) {
  await env.DB.prepare("UPDATE users SET profile = ? WHERE id = ?").bind(JSON.stringify(profile), userId).run();
}
