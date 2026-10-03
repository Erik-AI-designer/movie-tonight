// Picks ONE movie from mood + duration + services, personalised by the onboarding profile.
import { HttpError } from "./auth.js";
import { AGE_GROUPS } from "./profile.js";
import { MOVIES, MOODS, DURATIONS, GENRES, SERVICES, LIGHT_MOODS, DEEP_MOODS } from "./movies.js";

function watchLink(env, serviceId, movie) {
  const service = SERVICES[serviceId];
  let url = service.url
    .replace("{q}", encodeURIComponent(movie.original))
    .replace("{ru}", encodeURIComponent(movie.title));
  const tag = service.tagVar && env[service.tagVar];
  if (tag) {
    url += (url.includes("?") ? "&" : "?") + `${service.tagParam}=${encodeURIComponent(tag)}`;
  }
  return { service: service.name, url, affiliate: Boolean(tag) };
}

// For movies that aren't on any of your services: JustWatch shows where to watch it in Estonia.
function justWatchLink(movie) {
  return {
    service: "JustWatch",
    label: "Где посмотреть",
    url: `https://www.justwatch.com/ee/search?q=${encodeURIComponent(movie.original)}`,
    affiliate: false,
  };
}

// Which of the user's services can show this movie: ones that have it, plus rental stores.
function servicesFor(movie, services) {
  return services.filter(
    (s) => movie.services.includes(s) || (SERVICES[s].rental && !movie.noRental),
  );
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

  // Hard rules: age, not a disliked genre, not already shown.
  const suitable = MOVIES.filter(
    (m) =>
      m.minAge <= maxAge &&
      !m.genres.some((g) => profile.dislikedGenres.includes(g)) &&
      !exclude.has(m.id),
  );
  const onMine = suitable.filter((m) => servicesFor(m, services).length > 0);

  // Prefer your services, then the right mood, then fitting the time.
  // If nothing on your services fits the mood, suggest a movie from elsewhere.
  const fitsMood = (m) => m.moods.includes(mood);
  const fitsTime = (m) => m.runtime <= maxRuntime;
  const candidates =
    [
      onMine.filter((m) => fitsMood(m) && fitsTime(m)),
      onMine.filter(fitsMood),
      suitable.filter((m) => fitsMood(m) && fitsTime(m)),
      suitable.filter(fitsMood),
      onMine.filter(fitsTime),
    ].find((list) => list.length > 0) || [];

  if (candidates.length === 0) {
    throw new HttpError(404, "Ничего не нашлось — попробуй другое настроение или добавь сервис");
  }

  // Take the best-scoring few and pick one at random, so "another one" gives variety.
  const ranked = candidates
    .map((m) => ({ m, s: score(m, profile, mood) + Math.random() }))
    .sort((a, b) => b.s - a.s);
  const movie = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))].m;
  const myServices = servicesFor(movie, services);

  return {
    id: movie.id,
    title: movie.title,
    original: movie.original,
    year: movie.year,
    runtime: movie.runtime,
    minAge: movie.minAge,
    genres: movie.genres.map((g) => GENRES[g]),
    reason: explain(movie, profile, mood, maxRuntime),
    elsewhere: myServices.length === 0,
    links: myServices.length > 0 ? myServices.map((s) => watchLink(env, s, movie)) : [justWatchLink(movie)],
  };
}
