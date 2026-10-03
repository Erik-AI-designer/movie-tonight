# 🍿 Что посмотреть сегодня (movie-tonight)

Pick a mood, how much time you have and which streaming services you own, and get **one** movie.
You have to log in to use it. After the first login the site asks about your age, favorite and
disliked genres, and which services you have. Money comes from affiliate links on the "watch" buttons.

Runs on **Cloudflare Workers** (free plan) with a **D1** database for accounts.

**Features:** one pick by mood/time/services · movie, series or either · "seen it" / "not for me" /
⭐ "my list" (never suggests seen or hidden titles again) · trailer button · posters, descriptions,
ratings and "where to watch in Estonia" from TMDB · movie night with friends (shared room link) ·
installable on phones (PWA) · login rate limiting · password reset with a recovery code.

## Files

```
movie-tonight/
├── wrangler.jsonc      Cloudflare config: worker name, database, affiliate tags
├── schema.sql          database tables — paste into the D1 console after every update (safe to re-run)
├── src/                backend: runs on Cloudflare, never sent to the browser
│   ├── index.js        all /api/... routes
│   ├── auth.js         passwords, sessions, rate limiting, recovery codes
│   ├── profile.js      the onboarding questions
│   ├── recommend.js    picks one title (for one person or a group) and explains why
│   ├── lists.js        seen / not for me / my list
│   ├── tmdb.js         posters, descriptions, trailers, Estonian availability (cached a week)
│   ├── rooms.js        movie night with friends
│   └── movies.js       THE CATALOGUE: movies, series, moods, genres, services
└── public/             frontend: what the browser loads
    ├── index.html      all screens
    ├── app.js          page logic
    ├── style.css       look (incl. the card flip animation)
    ├── manifest.webmanifest, sw.js, icon*.png, icon.svg   phone app (PWA)
```

## Deploy (one time)

1. **Push this folder to a new GitHub repo** (e.g. `movie-tonight`).
2. **Create the database.** Cloudflare dashboard → *Storage & Databases → D1* → *Create* → name it `movie-tonight`.
   Copy its **Database ID** into `wrangler.jsonc` (replace `PASTE_DATABASE_ID_HERE`), commit and push.
3. **Create the tables.** In the database page → *Console*, paste all of `schema.sql` and run it.
4. **Connect GitHub.** *Workers & Pages → Create → Import a repository* → pick the repo.
   Build command: leave empty. Deploy command: `npx wrangler deploy`. Save and deploy.
5. Open the `https://movie-tonight.<your-subdomain>.workers.dev` link it gives you.
6. **TMDB (posters etc.):** get an "API Read Access Token" at themoviedb.org → Settings → API.
   In Cloudflare: Workers → movie-tonight → Settings → Variables and Secrets → Add →
   type **Secret**, name `TMDB_TOKEN`, paste the token. Without it the site still works, just without posters.

After that, every `git push` to `main` redeploys automatically.

## Affiliate links

- Put your Amazon Associates tag in `wrangler.jsonc` → `vars.AMAZON_TAG` (e.g. `"mysite-20"`).
- To add tags for another service, add `tagVar`/`tagParam` to it in `src/movies.js` and a matching var in `wrangler.jsonc`.
- The page shows a "партнёрские ссылки" notice under each result. Affiliate programs and the law require it, so keep it.

## Changing movies

Edit `MOVIES` in `src/movies.js` (add `type: "series"` for series; `runtime` is then one episode). Which services carry which movie changes often and depends on the
country, so the `services` lists there are examples. Check them before going public.

## Run locally (needs Node.js)

```bash
npm install
npm run db:init:local
npm run dev
```
