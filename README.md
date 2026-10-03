# 🍿 Что посмотреть сегодня (movie-tonight)

Pick a mood, how much time you have and which streaming services you own, and get **one** movie.
You have to log in to use it. After the first login the site asks about your age, favorite and
disliked genres, and which services you have. Money comes from affiliate links on the "watch" buttons.

Runs on **Cloudflare Workers** (free plan) with a **D1** database for accounts.

**Features:** picks from everything available right now in Estonia (TMDB) plus a hand-made catalogue for
Russian-language services · movie, series or either · 🎲 surprise me · "seen it" / "not for me" / ⭐ "my list" ·
👍/👎 after watching (the picks learn from it) · posters, logos, facts and official trailers from TMDB ·
movie night with friends (3 options + voting) · share a picture of the pick · RU / EE / EN · light & dark theme ·
📊 click stats for the admin · 🤝 friends (friend codes, their 👍, recommend a movie) · 📅 monthly recap with a share
picture · 🎲 one free pick without an account · privacy page, download my data, delete my account ·
installable on phones (PWA) · login rate limiting · recovery codes.

## Files

```
movie-tonight/
├── wrangler.jsonc      Cloudflare config: worker name, database, affiliate tags
├── schema.sql          database tables — paste into the D1 console after every update (safe to re-run)
├── src/                backend: runs on Cloudflare, never sent to the browser
│   ├── index.js        all /api/... routes
│   ├── auth.js         passwords, sessions, rate limiting, recovery codes
│   ├── profile.js      the onboarding questions
│   ├── recommend.js    picks titles (one person or a group), combines TMDB + catalogue, explains why
│   ├── discover.js     finds titles on TMDB that are on your services in Estonia
│   ├── i18n.js         server texts in RU / ET / EN
│   ├── lists.js        seen / not for me / my list, 👍/👎, click stats
│   ├── tmdb.js         posters, descriptions, trailers, Estonian availability (cached a week)
│   ├── rooms.js        movie night with friends (3 options + voting)
│   ├── friends.js      friend codes, nicknames, friends' 👍, recommendations
│   ├── account.js      monthly recap, download my data, delete my account
│   └── movies.js       THE CATALOGUE: movies, series, moods, genres, services
└── public/             frontend: what the browser loads
    ├── index.html      all screens
    ├── i18n.js         page texts in RU / ET / EN
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
7. **Stats page:** add another **Secret** named `ADMIN_EMAIL` = the email you log in to the site with.
   That account gets a 📊 button. (Kept as a secret so your email isn't in the public repo.)
8. **Privacy contact:** add a **Secret** named `CONTACT_EMAIL` = the email people can write to about their data.
   It's shown on the privacy page.

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
