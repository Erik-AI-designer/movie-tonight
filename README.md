# 🍿 Что посмотреть сегодня (movie-tonight)

Pick a mood, how much time you have and which streaming services you own, and get **one** movie.
You have to log in to use it. After the first login the site asks about your age, favorite and
disliked genres, and which services you have. Money comes from affiliate links on the "watch" buttons.

Runs on **Cloudflare Workers** (free plan) with a **D1** database for accounts.

## Files

```
movie-tonight/
├── wrangler.jsonc      Cloudflare config: worker name, database, affiliate tags
├── package.json        scripts + the `wrangler` tool
├── schema.sql          database tables (users, sessions), run once
├── src/                backend: runs on Cloudflare, never sent to the browser
│   ├── index.js        routes: /api/register, /api/login, /api/logout, /api/me, /api/profile, /api/recommend
│   ├── auth.js         passwords (PBKDF2 hashing), sessions, cookies
│   ├── profile.js      the onboarding questions and how answers are checked
│   ├── recommend.js    picks one movie and explains why
│   └── movies.js       THE CATALOGUE: movies, moods, genres, services, link templates
└── public/             frontend: what the browser loads
    ├── index.html      the page with 3 screens: login → questions → picker
    ├── app.js          page logic
    └── style.css       look
```

## Deploy (one time)

1. **Push this folder to a new GitHub repo** (e.g. `movie-tonight`).
2. **Create the database.** Cloudflare dashboard → *Storage & Databases → D1* → *Create* → name it `movie-tonight`.
   Copy its **Database ID** into `wrangler.jsonc` (replace `PASTE_DATABASE_ID_HERE`), commit and push.
3. **Create the tables.** In the database page → *Console*, paste all of `schema.sql` and run it.
4. **Connect GitHub.** *Workers & Pages → Create → Import a repository* → pick the repo.
   Build command: leave empty. Deploy command: `npx wrangler deploy`. Save and deploy.
5. Open the `https://movie-tonight.<your-subdomain>.workers.dev` link it gives you.

After that, every `git push` to `main` redeploys automatically.

## Affiliate links

- Put your Amazon Associates tag in `wrangler.jsonc` → `vars.AMAZON_TAG` (e.g. `"mysite-20"`).
- To add tags for another service, add `tagVar`/`tagParam` to it in `src/movies.js` and a matching var in `wrangler.jsonc`.
- The page shows a "партнёрские ссылки" notice under each result. Affiliate programs and the law require it, so keep it.

## Changing movies

Edit `MOVIES` in `src/movies.js`. Which services carry which movie changes often and depends on the
country, so the `services` lists there are examples. Check them before going public.

## Run locally (needs Node.js)

```bash
npm install
npm run db:init:local
npm run dev
```
