// Everything that talks to TMDB: details (poster, logo, description, facts, trailer, where to watch),
// the list of streaming providers in Estonia, and genre mappings used by discover.js.
// Needs the secret TMDB_TOKEN. All results are cached in D1 (tmdb_cache) for a week.
import { SERVICES } from "./movies.js";
import { TMDB_LANG } from "./i18n.js";

const CACHE_MS = 7 * 86400_000;
const CACHE_VERSION = 3; // bump when the cached shape changes, so old entries refresh
export const COUNTRY = "EE";

// ---------- Genres: TMDB ids <-> our genre ids (src/movies.js GENRES) ----------
export const TMDB_TO_OURS = {
  movie: { 35: "comedy", 18: "drama", 878: "scifi", 14: "scifi", 53: "thriller", 80: "mystery", 27: "horror",
    10749: "romance", 16: "animation", 12: "adventure", 28: "action", 9648: "mystery", 10751: "family" },
  tv: { 35: "comedy", 18: "drama", 10765: "scifi", 9648: "mystery", 80: "mystery", 16: "animation",
    10759: "action", 10751: "family", 10762: "family" },
};
export const OURS_TO_TMDB = {
  movie: { comedy: [35], drama: [18], scifi: [878, 14], thriller: [53], horror: [27], romance: [10749],
    animation: [16], adventure: [12], action: [28], mystery: [9648, 80], family: [10751] },
  tv: { comedy: [35], drama: [18], scifi: [10765], thriller: [9648, 80], horror: [], romance: [],
    animation: [16], adventure: [10759], action: [10759], mystery: [9648, 80], family: [10751, 10762] },
};

export function oursFromTmdb(kind, ids) {
  return [...new Set(ids.map((id) => TMDB_TO_OURS[kind][id]).filter(Boolean))];
}

// ---------- Age ratings (US) -> our minimum age ----------
const MOVIE_CERT_AGE = { G: 0, PG: 6, "PG-13": 12, R: 16, "NC-17": 18 };
const TV_CERT_AGE = { "TV-Y": 0, "TV-G": 0, "TV-Y7": 6, "TV-PG": 6, "TV-14": 16, "TV-MA": 18 };
export const AGE_TO_CERT = { 0: "G", 6: "PG", 12: "PG-13", 16: "R" }; // 18 → no limit

// ---------- Providers: TMDB/JustWatch names -> our service ids ----------
const PROVIDER_ALIASES = {
  amazonprimevideo: "prime",
  disneyplus: "disney",
  appletvplus: "apple",
  appletv: "apple",
  appletvstore: "apple_rent",
  itunes: "apple_rent",
  max: "hbo",
  paramountplus: "paramount",
  googleplaymovies: "google",
  googletv: "google",
  youtube: "google",
  teliaplay: "telia",
  errjupiter: "jupiter",
};
const squash = (name) => name.toLowerCase().replace(/[^a-zа-я0-9]/g, "");
const SERVICE_BY_NAME = Object.fromEntries(Object.entries(SERVICES).map(([id, s]) => [squash(s.name), id]));

export function serviceIdFor(providerName) {
  const key = squash(providerName);
  return PROVIDER_ALIASES[key] || SERVICE_BY_NAME[key] || null;
}

async function tmdb(env, path) {
  const res = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
  return res.json();
}
export { tmdb as tmdbGet };

async function cached(env, key, load) {
  const row = await env.DB.prepare("SELECT data, fetched_at FROM tmdb_cache WHERE movie_id = ?").bind(key).first();
  if (row && Date.now() - row.fetched_at < CACHE_MS) {
    const data = JSON.parse(row.data);
    if (data.v === CACHE_VERSION) return data;
  }
  const data = { v: CACHE_VERSION, ...(await load()) };
  await env.DB.prepare(
    `INSERT INTO tmdb_cache (movie_id, data, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(movie_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
  )
    .bind(key, JSON.stringify(data), Date.now())
    .run();
  return data;
}

// Our service id -> list of TMDB provider ids in Estonia (cached a week).
export async function providerMap(env) {
  return cached(env, `_providers:${COUNTRY}`, async () => {
    const map = {};
    for (const kind of ["movie", "tv"]) {
      const { results = [] } = await tmdb(env, `/watch/providers/${kind}?watch_region=${COUNTRY}`);
      for (const p of results) {
        const id = serviceIdFor(p.provider_name);
        if (id) map[id] = [...new Set([...(map[id] || []), p.provider_id])];
      }
    }
    return { map };
  }).then((d) => d.map);
}

// ---------- Details for one title ----------
function pickTrailer(videos, lang) {
  const rank = (v) => (v.official ? 4 : 0) + (v.type === "Trailer" ? 2 : 0) + (v.iso_639_1 === lang ? 1 : 0);
  return videos
    .filter((v) => v.site === "YouTube" && ["Trailer", "Teaser"].includes(v.type))
    .sort((a, b) => rank(b) - rank(a) || String(b.published_at).localeCompare(String(a.published_at)))[0];
}

function pickLogo(logos, lang) {
  const order = { [lang]: 0, en: 1 };
  return [...logos]
    .filter((l) => l.file_path && !l.file_path.endsWith(".svg"))
    .sort((a, b) => (order[a.iso_639_1] ?? 2) - (order[b.iso_639_1] ?? 2) || (b.vote_average || 0) - (a.vote_average || 0))[0];
}

function minAgeOf(kind, d) {
  if (kind === "movie") {
    const us = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === "US");
    const cert = (us?.release_dates || []).map((r) => r.certification).find((c) => c in MOVIE_CERT_AGE);
    return cert ? MOVIE_CERT_AGE[cert] : null;
  }
  const us = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === "US");
  return us && us.rating in TV_CERT_AGE ? TV_CERT_AGE[us.rating] : null;
}

// Full info for TMDB title `kind`/`tmdbId` in `lang`, cached as e.g. "m508965:ru".
export async function details(env, kind, tmdbId, lang) {
  const key = `${kind === "tv" ? "t" : "m"}${tmdbId}:${lang}`;
  return cached(env, key, async () => {
    const l = TMDB_LANG[lang];
    const extra = kind === "tv" ? "content_ratings" : "release_dates";
    const d = await tmdb(
      env,
      `/${kind}/${tmdbId}?language=${l}&append_to_response=videos,images,credits,watch/providers,${extra}` +
        `&include_video_language=${lang},en&include_image_language=${lang},en,null`,
    );
    let overview = d.overview;
    if (!overview && lang !== "en") overview = (await tmdb(env, `/${kind}/${tmdbId}?language=en-US`)).overview;

    const where = d["watch/providers"]?.results?.[COUNTRY];
    const trailer = pickTrailer(d.videos?.results || [], lang);
    const logo = pickLogo(d.images?.logos || [], lang);
    const directors = kind === "tv"
      ? (d.created_by || []).map((p) => p.name)
      : (d.credits?.crew || []).filter((p) => p.job === "Director").map((p) => p.name);
    const date = kind === "tv" ? d.first_air_date : d.release_date;

    return {
      id: `${kind === "tv" ? "t" : "m"}${tmdbId}`,
      type: kind === "tv" ? "series" : "movie",
      tmdbId,
      title: (kind === "tv" ? d.name : d.title) || null,
      original: (kind === "tv" ? d.original_name : d.original_title) || null,
      year: date ? Number(date.slice(0, 4)) : null,
      runtime: (kind === "tv" ? d.episode_run_time?.[0] || d.last_episode_to_air?.runtime : d.runtime) || null,
      minAge: minAgeOf(kind, d),
      genreIds: oursFromTmdb(kind, (d.genres || []).map((g) => g.id)),
      genreNames: (d.genres || []).map((g) => g.name.toLowerCase()),
      tmdbUrl: `https://www.themoviedb.org/${kind}/${tmdbId}`,
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
      logo: logo ? `https://image.tmdb.org/t/p/w500${logo.file_path}` : null,
      overview: overview || null,
      tagline: d.tagline || null,
      rating: d.vote_count > 20 ? Math.round(d.vote_average * 10) / 10 : null,
      facts: {
        released: date || null,
        language: d.original_language || null,
        countries: kind === "tv" ? d.origin_country || [] : (d.production_countries || []).map((c) => c.iso_3166_1),
        directors: directors.slice(0, 2),
        cast: (d.credits?.cast || []).slice(0, 4).map((p) => p.name),
        seasons: kind === "tv" ? d.number_of_seasons || null : null,
        episodes: kind === "tv" ? d.number_of_episodes || null : null,
      },
      trailer: trailer ? { key: trailer.key, name: trailer.name, official: Boolean(trailer.official) } : null,
      providers: where
        ? {
            stream: (where.flatrate || []).map((p) => p.provider_name),
            rent: [...new Set([...(where.rent || []), ...(where.buy || [])].map((p) => p.provider_name))],
          }
        : null,
    };
  });
}

// For our hand-made catalogue: find the title on TMDB by name + year, then load details.
async function detailsForCatalogue(env, movie, lang) {
  const kind = movie.type === "series" ? "tv" : "movie";
  const ref = await cached(env, `_search:${movie.id}`, async () => {
    const yearParam = kind === "tv" ? "first_air_date_year" : "year";
    const q = encodeURIComponent(movie.original);
    let found = await tmdb(env, `/search/${kind}?query=${q}&${yearParam}=${movie.year}`);
    if (!found.results?.length) found = await tmdb(env, `/search/${kind}?query=${q}`);
    return { tmdbId: found.results?.[0]?.id || null };
  });
  return ref.tmdbId ? details(env, kind, ref.tmdbId, lang) : null;
}

// Fields copied from TMDB details onto a result card.
export function extras(d) {
  return {
    poster: d.poster,
    logo: d.logo,
    overview: d.overview,
    tagline: d.tagline,
    rating: d.rating,
    facts: d.facts,
    tmdbUrl: d.tmdbUrl,
    trailerVideo: d.trailer || undefined,
    whereEE: d.providers || undefined,
  };
}

// Our services that, according to TMDB, have this title in Estonia.
export function servicesFromProviders(d, services) {
  if (!d.providers) return [];
  const names = [...d.providers.stream, ...(d.type === "series" ? [] : d.providers.rent)];
  return [...new Set(names.map(serviceIdFor).filter((id) => id && services.includes(id)))];
}

// Adds TMDB extras to a result from our hand-made catalogue (see recommend.js pickLocal).
export async function withTmdb(env, result, services, lang, makeLink) {
  if (!env.TMDB_TOKEN || !result.catalogue) return result;
  try {
    const movie = result.catalogue;
    const d = await detailsForCatalogue(env, movie, lang);
    if (!d) return result;
    const out = { ...result, ...extras(d) };
    // TMDB says it's on one of YOUR services, but our catalogue didn't know: add that button too.
    const known = new Set(result.elsewhere ? [] : result.links.map((l) => l.service));
    const extra = servicesFromProviders(d, services).filter((id) => !known.has(SERVICES[id].name));
    if (extra.length) {
      const extraLinks = extra.map((id) => makeLink(id, movie));
      out.links = result.elsewhere ? extraLinks : [...result.links, ...extraLinks];
      out.elsewhere = false;
    }
    return out;
  } catch (err) {
    console.error("TMDB failed:", err.message);
    return result; // never break a recommendation because of TMDB
  }
}
