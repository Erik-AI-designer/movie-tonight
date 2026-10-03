// Posters, descriptions, ratings, trailers and "where to watch in Estonia" from TMDB.
// Needs the secret TMDB_TOKEN (TMDB "API Read Access Token") — without it the site works, just without these extras.
// Results are cached in D1 for a week, so TMDB is asked at most once a week per title.
import { SERVICES } from "./movies.js";
import { MOVIES_BY_ID, watchLink } from "./recommend.js";

const CACHE_MS = 7 * 86400_000;
const COUNTRY = "EE";

// TMDB/JustWatch provider names that differ from our service names.
const PROVIDER_ALIASES = {
  amazonprimevideo: "prime",
  disneyplus: "disney",
  appletvplus: "apple",
  appletv: "apple_rent",
  max: "hbo",
  paramountplus: "paramount",
  googleplaymovies: "google",
  youtube: "google",
  teliaplay: "telia",
};

const squash = (name) => name.toLowerCase().replace(/[^a-zа-я0-9]/g, "");
const SERVICE_BY_NAME = Object.fromEntries(Object.entries(SERVICES).map(([id, s]) => [squash(s.name), id]));

function serviceIdFor(providerName) {
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

async function fetchFromTmdb(env, movie) {
  const kind = movie.type === "series" ? "tv" : "movie";
  const yearParam = kind === "tv" ? "first_air_date_year" : "year";
  const q = encodeURIComponent(movie.original);

  let found = await tmdb(env, `/search/${kind}?query=${q}&${yearParam}=${movie.year}&language=ru-RU`);
  if (!found.results?.length) found = await tmdb(env, `/search/${kind}?query=${q}&language=ru-RU`);
  const hit = found.results?.[0];
  if (!hit) return { notFound: true };

  const d = await tmdb(
    env,
    `/${kind}/${hit.id}?language=ru-RU&append_to_response=videos,watch/providers&include_video_language=ru,en`,
  );
  let overview = d.overview;
  if (!overview) overview = (await tmdb(env, `/${kind}/${hit.id}?language=en-US`)).overview;

  const videos = (d.videos?.results || []).filter((v) => v.site === "YouTube");
  const trailer = videos.find((v) => v.type === "Trailer") || videos[0];
  const where = d["watch/providers"]?.results?.[COUNTRY];

  return {
    tmdbId: hit.id,
    poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
    overview: overview || null,
    rating: d.vote_count > 20 ? Math.round(d.vote_average * 10) / 10 : null,
    trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    providers: where
      ? {
          stream: (where.flatrate || []).map((p) => p.provider_name),
          rent: [...new Set([...(where.rent || []), ...(where.buy || [])].map((p) => p.provider_name))],
        }
      : null,
  };
}

// Cached TMDB data for one catalogue entry, or null if TMDB isn't set up / fails.
export async function tmdbData(env, movie) {
  if (!env.TMDB_TOKEN) return null;
  try {
    const row = await env.DB.prepare("SELECT data, fetched_at FROM tmdb_cache WHERE movie_id = ?").bind(movie.id).first();
    if (row && Date.now() - row.fetched_at < CACHE_MS) return JSON.parse(row.data);

    const data = await fetchFromTmdb(env, movie);
    await env.DB.prepare(
      `INSERT INTO tmdb_cache (movie_id, data, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(movie_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
    )
      .bind(movie.id, JSON.stringify(data), Date.now())
      .run();
    return data;
  } catch (err) {
    console.error("TMDB failed:", err.message);
    return null; // never break a recommendation because of TMDB
  }
}

// Adds poster, description, rating, real trailer and Estonian availability to a pick() result.
export async function withTmdb(env, result, services) {
  const movie = MOVIES_BY_ID[result.id];
  const t = await tmdbData(env, movie);
  if (!t || t.notFound) return result;

  const out = { ...result, poster: t.poster, overview: t.overview, rating: t.rating };
  if (t.trailer) out.trailer = t.trailer;

  if (t.providers) {
    out.whereEE = t.providers;
    // TMDB says it's on one of YOUR services, but our catalogue didn't know: add that button too.
    const confirmed = [...t.providers.stream, ...(movie.type === "series" ? [] : t.providers.rent)]
      .map(serviceIdFor)
      .filter((id) => id && services.includes(id));
    const known = new Set(result.elsewhere ? [] : result.links.map((l) => l.service));
    const extra = [...new Set(confirmed)].filter((id) => !known.has(SERVICES[id].name));
    if (extra.length) {
      const extraLinks = extra.map((id) => watchLink(env, id, movie));
      out.links = result.elsewhere ? extraLinks : [...result.links, ...extraLinks];
      out.elsewhere = false;
    }
  }
  return out;
}
