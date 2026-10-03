// Picks ONE movie or series from mood + duration + services, personalised by the onboarding profile.
// Works for one person (criteriaFor) and for a group of friends (groupCriteria).
import { HttpError } from "./auth.js";
import { AGE_GROUPS } from "./profile.js";
import { MOVIES, MOODS, DURATIONS, GENRES, SERVICES, KINDS, LIGHT_MOODS, DEEP_MOODS } from "./movies.js";

export const MOVIES_BY_ID = Object.fromEntries(MOVIES.map((m) => [m.id, m]));

export function watchLink(env, serviceId, movie) {
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

// For titles that aren't on any of your services: JustWatch shows where to watch it in Estonia.
function justWatchLink(movie) {
  return {
    service: "JustWatch",
    label: "Где посмотреть",
    url: `https://www.justwatch.com/ee/search?q=${encodeURIComponent(movie.original)}`,
    affiliate: false,
  };
}

// Which of the given services can show this title: ones that have it, plus rental stores (movies only).
function servicesFor(movie, services) {
  return services.filter(
    (s) => movie.services.includes(s) || (SERVICES[s].rental && !movie.noRental && movie.type !== "series"),
  );
}

function score(movie, c) {
  let s = 0;
  if (movie.moods[0] === c.mood) s += 3; // main mood of the title
  else if (movie.moods.includes(c.mood)) s += 2;
  s += movie.genres.filter((g) => c.favoriteGenres.includes(g)).length * 2;
  if (c.vibe === "light" && movie.moods.some((m) => LIGHT_MOODS.includes(m))) s += 1;
  if (c.vibe === "deep" && movie.moods.some((m) => DEEP_MOODS.includes(m))) s += 1;
  if (c.saved.has(movie.id)) s += 2; // you starred it earlier
  return s;
}

function explain(movie, c) {
  const reasons = [];
  if (movie.moods.includes(c.mood)) reasons.push(`подходит под настроение «${MOODS[c.mood]}»`);
  const liked = movie.genres.filter((g) => c.favoriteGenres.includes(g)).map((g) => GENRES[g]);
  if (liked.length) reasons.push(`${c.group ? "вы любите" : "ты любишь"}: ${liked.join(", ")}`);
  if (c.saved.has(movie.id)) reasons.push("он у тебя в списке ⭐");
  if (c.maxRuntime !== Infinity) {
    const what = movie.type === "series" ? "серия" : "фильм";
    reasons.push(
      movie.runtime <= c.maxRuntime
        ? `уложится по времени (${what} ${movie.runtime} мин)`
        : `чуть длиннее, чем хотелось (${movie.runtime} мин), но короче под это настроение не нашлось`,
    );
  }
  return reasons.length ? `Почему: ${reasons.join("; ")}.` : "";
}

// Checks one person's picker answers: {mood, duration, services, kind}.
export function checkAnswers(body) {
  const mood = body?.mood;
  const duration = body?.duration;
  if (!(mood in MOODS)) throw new HttpError(400, "Выбери настроение");
  if (!(duration in DURATIONS)) throw new HttpError(400, "Выбери длительность");
  const services = Array.isArray(body.services) ? [...new Set(body.services.filter((s) => s in SERVICES))] : [];
  if (services.length === 0) throw new HttpError(400, "Отметь хотя бы один сервис");
  const kind = body.kind in KINDS ? body.kind : "any";
  return { mood, duration, services, kind };
}

// Criteria for one person. `marks` is { seen: Set, skip: Set, saved: Set } from their lists.
export function criteriaFor(profile, answers, marks, extraExclude = []) {
  return {
    mood: answers.mood,
    maxRuntime: DURATIONS[answers.duration].max,
    services: answers.services,
    kind: answers.kind,
    maxAge: AGE_GROUPS[profile.ageGroup] ?? 6,
    favoriteGenres: profile.favoriteGenres,
    dislikedGenres: profile.dislikedGenres,
    vibe: profile.vibe,
    exclude: new Set([...marks.seen, ...marks.skip, ...extraExclude]),
    saved: marks.saved,
    group: false,
  };
}

// Criteria for a group: everyone's services count (you watch together), the youngest age wins,
// anyone's dislikes are avoided, the most popular mood and the shortest time are used.
export function groupCriteria(members) {
  const moodVotes = {};
  for (const m of members) moodVotes[m.answers.mood] = (moodVotes[m.answers.mood] || 0) + 1;
  const topVotes = Math.max(...Object.values(moodVotes));
  const topMoods = Object.keys(moodVotes).filter((k) => moodVotes[k] === topVotes);
  const kinds = new Set(members.map((m) => m.answers.kind).filter((k) => k !== "any"));

  return {
    mood: topMoods[Math.floor(Math.random() * topMoods.length)],
    maxRuntime: Math.min(...members.map((m) => DURATIONS[m.answers.duration].max)),
    services: [...new Set(members.flatMap((m) => m.answers.services))],
    kind: kinds.size === 1 ? [...kinds][0] : "any",
    maxAge: Math.min(...members.map((m) => AGE_GROUPS[m.profile.ageGroup] ?? 6)),
    favoriteGenres: [...new Set(members.flatMap((m) => m.profile.favoriteGenres))],
    dislikedGenres: [...new Set(members.flatMap((m) => m.profile.dislikedGenres))],
    vibe: "both",
    exclude: new Set(members.flatMap((m) => [...m.marks.seen, ...m.marks.skip])),
    saved: new Set(),
    group: true,
  };
}

// Returns the response object for the chosen title (without TMDB extras).
export function pick(env, c) {
  // Hard rules: kind, age, not a disliked genre, not seen/skipped/already shown.
  const suitable = MOVIES.filter(
    (m) =>
      (c.kind === "any" || (m.type || "movie") === c.kind) &&
      m.minAge <= c.maxAge &&
      !m.genres.some((g) => c.dislikedGenres.includes(g)) &&
      !c.exclude.has(m.id),
  );
  const onMine = suitable.filter((m) => servicesFor(m, c.services).length > 0);

  // Prefer your services, then the right mood, then fitting the time.
  // If nothing on your services fits the mood, suggest a title from elsewhere.
  const fitsMood = (m) => m.moods.includes(c.mood);
  const fitsTime = (m) => m.runtime <= c.maxRuntime;
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
    .map((m) => ({ m, s: score(m, c) + Math.random() }))
    .sort((a, b) => b.s - a.s);
  const movie = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))].m;
  const available = servicesFor(movie, c.services);

  return {
    ...summary(movie),
    reason: explain(movie, c),
    elsewhere: available.length === 0,
    links: available.length > 0 ? available.map((s) => watchLink(env, s, movie)) : [justWatchLink(movie)],
    trailer: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${movie.original} ${movie.year} трейлер`)}`,
  };
}

// Short info about a title, used in results and in "My list".
export function summary(movie) {
  return {
    id: movie.id,
    type: movie.type || "movie",
    title: movie.title,
    original: movie.original,
    year: movie.year,
    runtime: movie.runtime,
    minAge: movie.minAge,
    genres: movie.genres.map((g) => GENRES[g]),
  };
}
