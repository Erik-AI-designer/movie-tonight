// Picks movies/series from mood + duration + services, personalised by the profile and by 👍/👎 ratings.
// Two sources: TMDB (discover.js — everything available in Estonia) and our hand-made catalogue
// (movies.js — also covers Russian-language services that TMDB doesn't know). pickAny() combines them.
import { HttpError } from "./auth.js";
import { AGE_GROUPS } from "./profile.js";
import { MOVIES, MOODS, DURATIONS, SERVICES, KINDS, LIGHT_MOODS, DEEP_MOODS } from "./movies.js";
import { t } from "./i18n.js";
import { withTmdb, providerMap } from "./tmdb.js";
import { discover } from "./discover.js";

export const MOVIES_BY_ID = Object.fromEntries(MOVIES.map((m) => [m.id, m]));

// Which of our genres belong to each mood (used for TMDB titles, which have no "mood").
export const MOOD_GENRES = {
  cozy: ["family", "animation", "comedy"],
  funny: ["comedy"],
  thrilling: ["thriller", "horror", "mystery"],
  thoughtful: ["drama", "scifi"],
  romantic: ["romance"],
  epic: ["adventure", "action", "scifi"],
};

// `item` needs { original, title }. {q} = original title, {ru} = Russian/local title.
export function watchLink(env, serviceId, item) {
  const service = SERVICES[serviceId];
  let url = service.url
    .replace("{q}", encodeURIComponent(item.original || item.title))
    .replace("{ru}", encodeURIComponent(item.title || item.original));
  const tag = service.tagVar && env[service.tagVar];
  if (tag) {
    url += (url.includes("?") ? "&" : "?") + `${service.tagParam}=${encodeURIComponent(tag)}`;
  }
  return { service: service.name, serviceId, url, affiliate: Boolean(tag) };
}

// For titles that aren't on any of your services: JustWatch shows where to watch it in Estonia.
export function justWatchLink(item, lang) {
  return {
    service: "JustWatch",
    label: t(lang, "link.where"),
    url: `https://www.justwatch.com/ee/search?q=${encodeURIComponent(item.original || item.title)}`,
    affiliate: false,
  };
}

export function youtubeSearch(item, lang) {
  const word = { ru: "трейлер", et: "treiler", en: "trailer" }[lang];
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${item.original || item.title} ${item.year || ""} ${word}`)}`;
}

// Which of the given services can show this catalogue title: ones that have it, plus rental stores (movies only).
function servicesFor(movie, services) {
  return services.filter(
    (s) => movie.services.includes(s) || (SERVICES[s].rental && !movie.noRental && movie.type !== "series"),
  );
}

// Taste from 👍/👎: sum of ratings per genre, e.g. { comedy: 2, horror: -1 }.
export function tasteBonus(genreIds, taste) {
  return genreIds.reduce((sum, g) => sum + Math.max(-2, Math.min(3, taste[g] || 0)), 0);
}

function score(movie, c) {
  let s = 0;
  if (movie.moods[0] === c.mood) s += 3; // main mood of the title
  else if (movie.moods.includes(c.mood)) s += 2;
  s += movie.genres.filter((g) => c.favoriteGenres.includes(g)).length * 2;
  s += tasteBonus(movie.genres, c.taste) * 1.5;
  if (c.vibe === "light" && movie.moods.some((m) => LIGHT_MOODS.includes(m))) s += 1;
  if (c.vibe === "deep" && movie.moods.some((m) => DEEP_MOODS.includes(m))) s += 1;
  if (c.saved.has(movie.id)) s += 2; // you starred it earlier
  return s;
}

// item: { id, type, genreIds, runtime, rating?, fitsMood }
export function explain(item, c) {
  const L = c.lang;
  const reasons = [];
  if (item.fitsMood) reasons.push(t(L, "reason.mood", { mood: t(L, `mood.${c.mood}`) }));
  const liked = item.genreIds.filter((g) => c.favoriteGenres.includes(g)).map((g) => t(L, `genre.${g}`));
  if (liked.length) reasons.push(t(L, c.group ? "reason.weLike" : "reason.youLike", { genres: liked.join(", ") }));
  if (tasteBonus(item.genreIds, c.taste) >= 2) reasons.push(t(L, "reason.taste"));
  if (c.saved.has(item.id)) reasons.push(t(L, "reason.saved"));
  if (item.rating >= 7.5) reasons.push(t(L, "reason.rating", { rating: item.rating }));
  if (c.maxRuntime !== Infinity && item.runtime) {
    reasons.push(
      item.runtime <= c.maxRuntime
        ? t(L, "reason.fits", { what: t(L, item.type === "series" ? "what.series" : "what.movie"), min: item.runtime })
        : t(L, "reason.longer", { min: item.runtime }),
    );
  }
  return reasons.length ? t(L, "reason.prefix", { list: reasons.join("; ") }) : "";
}

// Checks one person's picker answers: {mood, duration, services, kind}.
export function checkAnswers(body) {
  const mood = body?.mood;
  const duration = body?.duration;
  if (!(mood in MOODS)) throw new HttpError(400, "err.mood");
  if (!(duration in DURATIONS)) throw new HttpError(400, "err.duration");
  const services = Array.isArray(body.services) ? [...new Set(body.services.filter((s) => s in SERVICES))] : [];
  if (services.length === 0) throw new HttpError(400, "err.service");
  const kind = body.kind in KINDS ? body.kind : "any";
  return { mood, duration, services, kind };
}

// Criteria for one person. `marks` = { seen, skip, saved, watching } Sets; `taste` from ratings.
export function criteriaFor(profile, answers, marks, taste, lang, extraExclude = []) {
  return {
    lang,
    mood: answers.mood,
    maxRuntime: DURATIONS[answers.duration].max,
    services: answers.services,
    kind: answers.kind,
    maxAge: AGE_GROUPS[profile.ageGroup] ?? 6,
    favoriteGenres: profile.favoriteGenres,
    dislikedGenres: profile.dislikedGenres,
    vibe: profile.vibe,
    exclude: new Set([...marks.seen, ...marks.skip, ...marks.watching, ...extraExclude]),
    saved: marks.saved,
    taste,
    group: false,
  };
}

// Criteria for a group: everyone's services count (you watch together), the youngest age wins,
// anyone's dislikes are avoided, the most popular mood and the shortest time are used.
export function groupCriteria(members, lang) {
  const moodVotes = {};
  for (const m of members) moodVotes[m.answers.mood] = (moodVotes[m.answers.mood] || 0) + 1;
  const topVotes = Math.max(...Object.values(moodVotes));
  const topMoods = Object.keys(moodVotes).filter((k) => moodVotes[k] === topVotes);
  const kinds = new Set(members.map((m) => m.answers.kind).filter((k) => k !== "any"));
  const taste = {};
  for (const m of members) for (const [g, v] of Object.entries(m.taste)) taste[g] = (taste[g] || 0) + v;

  return {
    lang,
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
    taste,
    group: true,
  };
}

// Title shown to the user: Russian title in Russian, otherwise the original title.
export function localTitle(movie, lang) {
  return lang === "ru" ? movie.title : movie.original;
}

// Short info about a catalogue title, used in results and in "My list".
export function summary(movie, lang) {
  return {
    id: movie.id,
    type: movie.type || "movie",
    title: localTitle(movie, lang),
    original: movie.original,
    year: movie.year,
    runtime: movie.runtime,
    minAge: movie.minAge,
    genreIds: movie.genres,
    genres: movie.genres.map((g) => t(lang, `genre.${g}`)),
  };
}

// Up to `count` picks from our hand-made catalogue (may be fewer, or [] when nothing fits).
export function pickLocal(env, c, count = 1) {
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

  // Take the best-scoring few and pick at random, so "another one" gives variety.
  const ranked = candidates
    .map((m) => ({ m, s: score(m, c) + Math.random() * 1.5 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(3, count * 2))
    .sort(() => Math.random() - 0.5)
    .slice(0, count);

  return ranked.map(({ m: movie }) => {
    const available = servicesFor(movie, c.services);
    const s = summary(movie, c.lang);
    const linkItem = { title: movie.title, original: movie.original };
    return {
      ...s,
      reason: explain({ ...s, fitsMood: movie.moods.includes(c.mood) }, c),
      elsewhere: available.length === 0,
      links: available.length > 0 ? available.map((id) => watchLink(env, id, linkItem)) : [justWatchLink(movie, c.lang)],
      trailer: youtubeSearch(movie, c.lang),
      catalogue: movie, // used by withTmdb, removed before sending
    };
  });
}

// The main entry: `count` different titles, from TMDB when possible, otherwise from our catalogue.
export async function pickAny(env, c, count = 1) {
  const makeLink = (serviceId, item) => watchLink(env, serviceId, item);
  const helpers = { makeLink, explain, justWatchLink, youtubeSearch, tasteBonus, moodGenres: MOOD_GENRES };
  let picks = [];

  let useTmdb = Boolean(env.TMDB_TOKEN);
  if (useTmdb) {
    // Russian-language services aren't on TMDB: if you have some, sometimes start with our catalogue.
    const known = await providerMap(env).catch(() => ({}));
    const localOnly = c.services.some((s) => !known[s] && !SERVICES[s].rental);
    if (localOnly && Math.random() < 0.35) useTmdb = false;
  }
  if (useTmdb) {
    try {
      picks = await discover(env, c, count, helpers);
    } catch (err) {
      console.error("TMDB discover failed:", err.message);
    }
  }
  if (picks.length < count) {
    const exclude = new Set([...c.exclude, ...picks.map((p) => p.id)]);
    for (const r of pickLocal(env, { ...c, exclude }, count - picks.length)) {
      picks.push(await withTmdb(env, r, c.services, c.lang, makeLink));
    }
  }
  if (picks.length < count && !useTmdb && env.TMDB_TOKEN) {
    // Our catalogue ran out — try TMDB after all.
    const exclude = new Set([...c.exclude, ...picks.map((p) => p.id)]);
    try {
      picks.push(...(await discover(env, { ...c, exclude }, count - picks.length, helpers)));
    } catch (err) {
      console.error("TMDB discover failed:", err.message);
    }
  }
  if (!picks.length) throw new HttpError(404, "err.nothing");
  return picks.map(({ catalogue, ...r }) => r);
}
