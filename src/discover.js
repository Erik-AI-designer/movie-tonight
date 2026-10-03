// Finds titles on TMDB that are available RIGHT NOW in Estonia on the user's services,
// filtered by mood (genres), time, age and dislikes, ranked by favourite genres, 👍/👎 taste and rating.
// Uses few TMDB requests: one "discover" per kind (+1 retry), then details for the few chosen titles.
import { SERVICES } from "./movies.js";
import { TMDB_LANG, t } from "./i18n.js";
import { COUNTRY, OURS_TO_TMDB, AGE_TO_CERT, oursFromTmdb, providerMap, details, extras, servicesFromProviders, tmdbGet } from "./tmdb.js";

const MAX_DETAIL_LOOKUPS = 7; // keeps us well below Cloudflare's 50 requests per visit

function query(kind, c, providerIds, withRental, moodGenres) {
  const p = new URLSearchParams({
    language: TMDB_LANG[c.lang],
    watch_region: COUNTRY,
    with_watch_providers: providerIds.join("|"),
    with_watch_monetization_types: withRental && kind === "movie" ? "flatrate|rent|buy" : "flatrate",
    include_adult: "false",
    sort_by: "popularity.desc",
    "vote_count.gte": kind === "movie" ? "150" : "60",
  });
  const map = OURS_TO_TMDB[kind];
  let genres = moodGenres[c.mood].flatMap((g) => map[g]);
  if (!genres.length) genres = [18, 35]; // e.g. "romantic" series: TMDB has no romance genre for TV
  p.set("with_genres", [...new Set(genres)].join("|"));
  const without = [...new Set(c.dislikedGenres.flatMap((g) => map[g]))];
  if (without.length) p.set("without_genres", without.join(","));
  if (c.maxRuntime !== Infinity) p.set("with_runtime.lte", String(c.maxRuntime));
  if (kind === "movie") {
    p.set("with_runtime.gte", "60");
    if (c.maxAge < 18) {
      p.set("certification_country", "US");
      p.set("certification.lte", AGE_TO_CERT[c.maxAge] ?? "PG-13");
    }
  }
  return p.toString();
}

const SIMILAR_SHARE = 0.45; // how often a single pick tries "similar to something you liked"
const MAX_SIMILAR_LOOKUPS = 4;

// Turns TMDB details into a result card.
function toResult(d, c, h, extraReason = "") {
  const services = servicesFromProviders(d, c.services);
  const item = { id: d.id, type: d.type, genreIds: d.genreIds, runtime: d.runtime, rating: d.rating };
  const fitsMood = d.genreIds.some((g) => h.moodGenres[c.mood].includes(g)) || d.type === "series";
  const linkItem = { title: d.title, original: d.original };
  return {
    id: d.id,
    type: d.type,
    title: d.title || d.original,
    original: d.original,
    year: d.year,
    runtime: d.runtime,
    minAge: d.minAge,
    genreIds: d.genreIds,
    genres: d.genreNames,
    reason: [extraReason, h.explain({ ...item, fitsMood }, c)].filter(Boolean).join(" "),
    elsewhere: services.length === 0,
    links: services.length ? services.map((s) => h.makeLink(s, linkItem)) : [h.justWatchLink(d, c.lang)],
    trailer: h.youtubeSearch(d, c.lang),
    ...extras(d),
  };
}

// "Because you liked X": TMDB's recommendations for a title the user gave 👍,
// keeping only ones that are on their services in Estonia and fit age/time/dislikes.
async function similar(env, c, h) {
  const seed = c.seeds[Math.floor(Math.random() * c.seeds.length)];
  const kind = seed[0] === "t" ? "tv" : "movie";
  if (c.kind !== "any" && (c.kind === "series") !== (kind === "tv")) return [];
  const seedInfo = await details(env, kind, Number(seed.slice(1)), c.lang);
  const data = await tmdbGet(env, `/${kind}/${seed.slice(1)}/recommendations?language=${TMDB_LANG[c.lang]}`);
  const pool = (data.results || [])
    .filter((r) => {
      const id = `${kind === "tv" ? "t" : "m"}${r.id}`;
      if (r.adult || c.exclude.has(id) || (r.vote_count ?? 100) < 50) return false;
      return !oursFromTmdb(kind, r.genre_ids || []).some((g) => c.dislikedGenres.includes(g));
    })
    .slice(0, 12)
    .sort(() => Math.random() - 0.5);

  for (const r of pool.slice(0, MAX_SIMILAR_LOOKUPS)) {
    const d = await details(env, kind, r.id, c.lang);
    const age = d.minAge ?? (kind === "tv" ? 16 : 12);
    if (age > c.maxAge) continue;
    if (c.maxRuntime !== Infinity && d.runtime && d.runtime > c.maxRuntime + 10) continue;
    if (!servicesFromProviders(d, c.services).length) continue; // must be watchable on your services
    return [toResult(d, c, h, t(c.lang, "reason.similar", { title: seedInfo.title || seedInfo.original }))];
  }
  return [];
}

// h = helpers from recommend.js: { makeLink, explain, justWatchLink, youtubeSearch, tasteBonus, moodGenres }
export async function discover(env, c, count, h) {
  const providers = await providerMap(env);
  const mine = c.services.filter((s) => providers[s]);
  if (!mine.length) return []; // e.g. only Russian-language services
  if (count === 1 && c.seeds?.length && Math.random() < SIMILAR_SHARE) {
    const found = await similar(env, c, h);
    if (found.length) return found;
  }
  const providerIds = [...new Set(mine.flatMap((s) => providers[s]))];
  const withRental = mine.some((s) => SERVICES[s].rental);
  const kinds = c.kind === "any" ? ["movie", "tv"] : [c.kind === "series" ? "tv" : "movie"];

  let pool = [];
  for (const kind of kinds) {
    const q = query(kind, c, providerIds, withRental, h.moodGenres);
    const page = 1 + Math.floor(Math.random() * 3); // variety between visits
    let data = await tmdbGet(env, `/discover/${kind}?${q}&page=${page}`);
    if (!data.results?.length && page > 1) data = await tmdbGet(env, `/discover/${kind}?${q}&page=1`);
    for (const r of data.results || []) pool.push({ kind, r, id: `${kind === "tv" ? "t" : "m"}${r.id}` });
  }

  // Our own checks on top of TMDB's filters (TMDB's genre exclusion isn't always strict).
  pool = pool.filter(({ kind, r, id }) => {
    if (r.adult || c.exclude.has(id)) return false;
    const ours = oursFromTmdb(kind, r.genre_ids || []);
    return !ours.some((g) => c.dislikedGenres.includes(g));
  });

  const ranked = pool
    .map((p) => {
      const ours = oursFromTmdb(p.kind, p.r.genre_ids || []);
      const s =
        ours.filter((g) => c.favoriteGenres.includes(g)).length * 2 +
        h.tasteBonus(ours, c.taste) * 1.5 +
        (p.r.vote_average || 0) / 2 +
        Math.random() * 2;
      return { ...p, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(6, count * 3))
    .sort(() => Math.random() - 0.5);

  const results = [];
  let lookups = 0;
  for (const p of ranked) {
    if (results.length >= count || lookups >= MAX_DETAIL_LOOKUPS) break;
    lookups++;
    const d = await details(env, p.kind, p.r.id, c.lang);
    // Age: movies are already filtered by certification; series need a check (unknown rating → 16+).
    const age = d.minAge ?? (p.kind === "tv" ? 16 : 0);
    if (age > c.maxAge) continue;
    if (c.maxRuntime !== Infinity && d.runtime && d.runtime > c.maxRuntime + 10) continue;

    results.push(toResult(d, c, h));
  }
  return results;
}
