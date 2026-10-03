// Picks ONE movie from mood + duration + services, personalised by the onboarding profile.
import { HttpError } from "./auth.js";
import { AGE_GROUPS } from "./profile.js";
import { MOVIES, MOODS, DURATIONS, GENRES, SERVICES, LIGHT_MOODS, DEEP_MOODS } from "./movies.js";

function watchLink(env, serviceId, movie) {
  const service = SERVICES[serviceId];
  let url = service.url.replace("{q}", encodeURIComponent(movie.original));
  const tag = service.tagVar && env[service.tagVar];
  if (tag) {
    url += (url.includes("?") ? "&" : "?") + `${service.tagParam}=${encodeURIComponent(tag)}`;
  }
  return { service: service.name, url, affiliate: Boolean(tag) };
}

function score(movie, profile, mood) {
  let s = 0;
  if (movie.moods[0] === mood) s += 3; // main mood of the movie
  else if (movie.moods.includes(mood)) s += 2;
  s += movie.genres.filter((g) => profile.favoriteGenres.includes(g)).length * 2;
  if (profile.vibe === "light" && movie.moods.some((m) => LIGHT_MOODS.includes(m))) s += 1;
  if (profile.vibe === "deep" && movie.moods.some((m) => DEEP_MOODS.includes(m))) s += 1;
  return s;
}

function explain(movie, profile, mood, maxRuntime) {
  const reasons = [];
  if (movie.moods.includes(mood)) reasons.push(`подходит под настроение «${MOODS[mood]}»`);
  const liked = movie.genres.filter((g) => profile.favoriteGenres.includes(g)).map((g) => GENRES[g]);
  if (liked.length) reasons.push(`ты любишь: ${liked.join(", ")}`);
  if (maxRuntime !== Infinity) {
    reasons.push(
      movie.runtime <= maxRuntime
        ? `уложится по времени (${movie.runtime} мин)`
        : `чуть длиннее, чем хотелось (${movie.runtime} мин), но короче под это настроение не нашлось`,
    );
  }
  return reasons.length ? `Почему: ${reasons.join("; ")}.` : "";
}

export function recommend(env, profile, body) {
  const mood = body?.mood;
  const durationKey = body?.duration;
  if (!(mood in MOODS)) throw new HttpError(400, "Выбери настроение");
  if (!(durationKey in DURATIONS)) throw new HttpError(400, "Выбери длительность");

  const services = Array.isArray(body.services) ? body.services.filter((s) => s in SERVICES) : [];
  if (services.length === 0) throw new HttpError(400, "Отметь хотя бы один сервис");

  const exclude = new Set(Array.isArray(body.exclude) ? body.exclude.slice(0, 100) : []);
  const maxAge = AGE_GROUPS[profile.ageGroup] ?? 6;
  const maxRuntime = DURATIONS[durationKey].max;

  // Hard rules: age, available on one of your services, not a disliked genre, not already shown.
  const allowed = MOVIES.filter(
    (m) =>
      m.minAge <= maxAge &&
      m.services.some((s) => services.includes(s)) &&
      !m.genres.some((g) => profile.dislikedGenres.includes(g)) &&
      !exclude.has(m.id),
  );

  // Prefer: right mood AND fits the time. Then relax time, then relax mood.
  const candidates =
    [
      allowed.filter((m) => m.moods.includes(mood) && m.runtime <= maxRuntime),
      allowed.filter((m) => m.moods.includes(mood)),
      allowed.filter((m) => m.runtime <= maxRuntime),
    ].find((list) => list.length > 0) || [];

  if (candidates.length === 0) {
    throw new HttpError(404, "Ничего не нашлось — попробуй другое настроение или добавь сервис");
  }

  // Take the best-scoring few and pick one at random, so "another one" gives variety.
  const ranked = candidates
    .map((m) => ({ m, s: score(m, profile, mood) + Math.random() }))
    .sort((a, b) => b.s - a.s);
  const movie = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))].m;

  return {
    id: movie.id,
    title: movie.title,
    original: movie.original,
    year: movie.year,
    runtime: movie.runtime,
    minAge: movie.minAge,
    genres: movie.genres.map((g) => GENRES[g]),
    reason: explain(movie, profile, mood, maxRuntime),
    links: movie.services.filter((s) => services.includes(s)).map((s) => watchLink(env, s, movie)),
  };
}
