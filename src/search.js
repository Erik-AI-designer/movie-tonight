// 🔍 Search any movie/series on TMDB (or our catalogue without TMDB), open its card,
// and mark it yourself: ⭐ save, 👁 seen, 👍/👎, 🙅 never show. This is how users steer their taste.
import { HttpError } from "./auth.js";
import { MOVIES, SERVICES } from "./movies.js";
import { TMDB_LANG } from "./i18n.js";
import { tmdbGet, details, extras, servicesFromProviders } from "./tmdb.js";
import { MOVIES_BY_ID, summary, watchLink, justWatchLink, youtubeSearch } from "./recommend.js";

export async function search(env, rawQuery, lang) {
  const q = String(rawQuery || "").trim().slice(0, 80);
  if (q.length < 2) return [];

  if (!env.TMDB_TOKEN) {
    const needle = q.toLowerCase();
    return MOVIES.filter((m) => m.title.toLowerCase().includes(needle) || m.original.toLowerCase().includes(needle))
      .slice(0, 15)
      .map((m) => ({ ...summary(m, lang), poster: null }));
  }

  const data = await tmdbGet(env, `/search/multi?query=${encodeURIComponent(q)}&language=${TMDB_LANG[lang]}&include_adult=false`);
  return (data.results || [])
    .filter((r) => (r.media_type === "movie" || r.media_type === "tv") && !r.adult)
    .slice(0, 15)
    .map((r) => {
      const tv = r.media_type === "tv";
      const date = (tv ? r.first_air_date : r.release_date) || "";
      return {
        id: `${tv ? "t" : "m"}${r.id}`,
        type: tv ? "series" : "movie",
        title: (tv ? r.name : r.title) || (tv ? r.original_name : r.original_title),
        original: tv ? r.original_name : r.original_title,
        year: date ? Number(date.slice(0, 4)) : null,
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
        rating: r.vote_count > 20 ? Math.round(r.vote_average * 10) / 10 : null,
      };
    });
}

// Full card for one title, with "watch" buttons for the user's services and their current marks.
export async function titleCard(env, user, id, lang) {
  const services = user.profile?.services || [];
  let card;

  if (id in MOVIES_BY_ID) {
    const movie = MOVIES_BY_ID[id];
    const available = services.filter((s) => movie.services.includes(s) || (SERVICES[s].rental && !movie.noRental && movie.type !== "series"));
    const linkItem = { title: movie.title, original: movie.original };
    card = {
      ...summary(movie, lang),
      reason: "",
      elsewhere: available.length === 0,
      links: available.length ? available.map((s) => watchLink(env, s, linkItem)) : [justWatchLink(movie, lang)],
      trailer: youtubeSearch(movie, lang),
    };
  } else if (/^[mt]\d{1,9}$/.test(id)) {
    if (!env.TMDB_TOKEN) throw new HttpError(404, "err.notFound");
    const d = await details(env, id[0] === "t" ? "tv" : "movie", Number(id.slice(1)), lang);
    const mine = servicesFromProviders(d, services);
    const linkItem = { title: d.title, original: d.original };
    card = {
      id: d.id, type: d.type, title: d.title || d.original, original: d.original, year: d.year,
      runtime: d.runtime, minAge: d.minAge, genreIds: d.genreIds, genres: d.genreNames, reason: "",
      elsewhere: mine.length === 0,
      links: mine.length ? mine.map((s) => watchLink(env, s, linkItem)) : [justWatchLink(d, lang)],
      trailer: youtubeSearch(d, lang),
      ...extras(d),
    };
  } else {
    throw new HttpError(404, "err.notFound");
  }

  const mark = await env.DB.prepare("SELECT status FROM user_movies WHERE user_id = ? AND movie_id = ?").bind(user.id, id).first();
  const rating = await env.DB.prepare("SELECT rating FROM ratings WHERE user_id = ? AND movie_id = ?")
    .bind(user.id, id)
    .first()
    .catch(() => null);
  return { ...card, status: mark?.status || null, rating: rating?.rating ?? null, saved: mark?.status === "saved" };
}
