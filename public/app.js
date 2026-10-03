// Options shown on the page. Ids must match src/movies.js and src/profile.js.
const OPTIONS = {
  ageGroup: { u13: "до 13", "13-15": "13–15", "16-17": "16–17", "18+": "18+" },
  genres: {
    comedy: "комедия", drama: "драма", scifi: "фантастика", thriller: "триллер", horror: "ужасы",
    romance: "мелодрама", animation: "мультфильм", adventure: "приключения", action: "боевик",
    mystery: "детектив", family: "семейное",
  },
  vibe: { light: "лёгкого", deep: "серьёзного", both: "по-разному" },
  mood: {
    cozy: "🛋 уютное", funny: "😂 посмеяться", thrilling: "😱 пощекотать нервы",
    thoughtful: "🤔 подумать", romantic: "💞 романтика", epic: "🚀 приключение",
  },
  duration: { short: "до 1 ч 45 мин", normal: "до 2 ч 15 мин", long: "сколько угодно" },
};

// Streaming services, grouped. Ids must match SERVICES in src/movies.js.
const SERVICE_GROUPS = [
  [
    "Подписки",
    {
      netflix: "Netflix", prime: "Prime Video", disney: "Disney+", apple: "Apple TV+", hbo: "HBO Max",
      skyshowtime: "SkyShowtime", viaplay: "Viaplay", paramount: "Paramount+", mubi: "MUBI", crunchyroll: "Crunchyroll",
    },
  ],
  ["Эстония", { go3: "Go3", elisa: "Elisa Elamus", telia: "Telia TV", jupiter: "ERR Jupiter" }],
  [
    "Русскоязычные",
    {
      kinopoisk: "Кинопоиск", okko: "Okko", ivi: "Иви", start: "Start", premier: "Premier",
      wink: "Wink", kion: "KION", amediateka: "Амедиатека",
    },
  ],
  ["Аренда и покупка фильмов", { apple_rent: "Apple TV (аренда)", google: "Google TV / YouTube" }],
];
const ALL_SERVICES = Object.assign({}, ...SERVICE_GROUPS.map(([, services]) => services));

const $ = (sel) => document.querySelector(sel);
let me = null;
let lastPick = null;
let shown = [];

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Ошибка сети");
    err.status = res.status;
    throw err;
  }
  return data;
}

function show(screen) {
  $("#loading").hidden = true;
  for (const id of ["auth", "onboarding", "picker"]) $(`#screen-${id}`).hidden = id !== screen;
  $("#nav").hidden = screen === "auth";
}

// Add radio/checkbox chips to a .chips container.
function addChips(container, options, selected) {
  const { name, type } = container.dataset;
  for (const [value, label] of Object.entries(options)) {
    const wrap = document.createElement("label");
    wrap.className = "chip";
    const input = document.createElement("input");
    input.type = type;
    input.name = name;
    input.value = value;
    input.checked = selected.includes(value);
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(input, span);
    container.append(wrap);
  }
}

function renderChips(container, options, selected = []) {
  container.replaceChildren();
  addChips(container, options, selected);
}

// All services, with a small heading above each group.
function renderServiceGroups(container, selected = []) {
  container.replaceChildren();
  for (const [heading, services] of SERVICE_GROUPS) {
    const title = document.createElement("p");
    title.className = "muted";
    title.style.cssText = "flex-basis: 100%; margin: 8px 0 0; font-size: 0.85rem;";
    title.textContent = heading;
    container.append(title);
    addChips(container, services, selected);
  }
}

function readForm(form) {
  const out = {};
  for (const c of form.querySelectorAll(".chips")) {
    const values = [...c.querySelectorAll("input:checked")].map((i) => i.value);
    out[c.dataset.name] = c.dataset.type === "radio" ? values[0] : values;
  }
  return out;
}

// ---------- 1. Auth ----------
let authMode = "login";
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("#auth-submit").textContent = authMode === "login" ? "Войти" : "Создать аккаунт";
    $("#auth-form").password.autocomplete = authMode === "login" ? "current-password" : "new-password";
    $("#auth-error").textContent = "";
  }),
);

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  $("#auth-error").textContent = "";
  try {
    await api(`/api/${authMode}`, { email: form.email.value, password: form.password.value });
    form.reset();
    await start();
  } catch (err) {
    $("#auth-error").textContent = err.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", {}).catch(() => {});
  me = null;
  $("#result").hidden = true;
  show("auth");
});

// ---------- 2. Onboarding ----------
function openOnboarding() {
  const p = me.profile || {};
  const form = $("#profile-form");
  renderChips(form.querySelector('[data-name="ageGroup"]'), OPTIONS.ageGroup, [p.ageGroup]);
  renderChips(form.querySelector('[data-name="favoriteGenres"]'), OPTIONS.genres, p.favoriteGenres || []);
  renderChips(form.querySelector('[data-name="dislikedGenres"]'), OPTIONS.genres, p.dislikedGenres || []);
  renderChips(form.querySelector('[data-name="vibe"]'), OPTIONS.vibe, [p.vibe || "both"]);
  renderServiceGroups(form.querySelector('[data-name="services"]'), p.services || []);
  $("#profile-error").textContent = "";
  show("onboarding");
}

$("#edit-profile").addEventListener("click", openOnboarding);

$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { profile } = await api("/api/profile", readForm(e.target));
    me.profile = profile;
    openPicker();
  } catch (err) {
    $("#profile-error").textContent = err.message;
  }
});

// ---------- 3. Picker ----------
function openPicker() {
  const form = $("#pick-form");
  renderChips(form.querySelector('[data-name="mood"]'), OPTIONS.mood, []);
  renderChips(form.querySelector('[data-name="duration"]'), OPTIONS.duration, ["normal"]);
  // Only show the services the user said they have (all of them if they picked none).
  const mine = (me.profile.services || []).filter((id) => id in ALL_SERVICES);
  const services = form.querySelector('[data-name="services"]');
  if (mine.length) {
    renderChips(services, Object.fromEntries(mine.map((id) => [id, ALL_SERVICES[id]])), mine);
  } else {
    renderServiceGroups(services);
  }
  $("#result").hidden = true;
  show("picker");
}

async function pick(fresh) {
  if (fresh) shown = [];
  $("#pick-error").textContent = "";
  try {
    const movie = await api("/api/recommend", { ...readForm($("#pick-form")), exclude: shown });
    shown.push(movie.id);
    lastPick = movie;
    renderResult(movie);
  } catch (err) {
    if (err.status === 401) return show("auth");
    $("#pick-error").textContent = err.message;
    if (fresh) $("#result").hidden = true;
  }
}

function renderResult(m) {
  $("#r-title").textContent = m.title;
  $("#r-meta").textContent = `${m.original} · ${m.year} · ${m.runtime} мин · ${m.minAge}+ · ${m.genres.join(", ")}`;
  $("#r-reason").textContent = m.elsewhere
    ? `${m.reason} На твоих сервисах подходящего не нашлось — вот где этот фильм можно найти.`
    : m.reason;
  const links = $("#r-links");
  links.replaceChildren();
  for (const l of m.links) {
    const a = document.createElement("a");
    a.className = "primary button";
    a.href = l.url;
    a.target = "_blank";
    a.rel = l.affiliate ? "sponsored noopener" : "noopener";
    a.textContent = l.label || `Смотреть на ${l.service}`;
    links.append(a);
  }
  $("#result").hidden = false;
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#pick-form").addEventListener("submit", (e) => {
  e.preventDefault();
  pick(true);
});
$("#another").addEventListener("click", () => pick(false));

// ---------- Start ----------
async function start() {
  try {
    me = await api("/api/me");
  } catch {
    return show("auth");
  }
  if (!me.profile) openOnboarding();
  else openPicker();
}

start();
