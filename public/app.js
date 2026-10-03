// Page logic. Texts come from i18n.js (I18N); ids must match src/movies.js and src/profile.js.
const IDS = {
  ageGroup: ["u13", "13-15", "16-17", "18+"],
  genres: ["comedy", "drama", "scifi", "thriller", "horror", "romance", "animation", "adventure", "action", "mystery", "family"],
  vibe: ["light", "deep", "both"],
  mood: ["cozy", "funny", "thrilling", "thoughtful", "romantic", "epic"],
  duration: ["short", "normal", "long"],
  kind: ["movie", "series", "any"],
};

// Streaming services, grouped. Ids must match SERVICES in src/movies.js.
const SERVICE_GROUPS = [
  ["sg.subs", {
    netflix: "Netflix", prime: "Prime Video", disney: "Disney+", apple: "Apple TV+", hbo: "HBO Max",
    skyshowtime: "SkyShowtime", viaplay: "Viaplay", paramount: "Paramount+", mubi: "MUBI", crunchyroll: "Crunchyroll",
  }],
  ["sg.ee", { go3: "Go3", elisa: "Elisa Elamus", telia: "Telia TV", jupiter: "ERR Jupiter" }],
  ["sg.ru", {
    kinopoisk: "Кинопоиск", okko: "Okko", ivi: "Иви", start: "Start", premier: "Premier",
    wink: "Wink", kion: "KION", amediateka: "Амедиатека",
  }],
  ["sg.rent", { apple_rent: null, google: "Google TV / YouTube" }], // null = translated name (svc.<id>)
];
const serviceName = (id) => {
  for (const [, services] of SERVICE_GROUPS) if (id in services) return services[id] ?? t(`svc.${id}`);
  return id;
};
const ALL_SERVICE_IDS = SERVICE_GROUPS.flatMap(([, s]) => Object.keys(s));

const $ = (sel) => document.querySelector(sel);
const ROOM_POLL_MS = 4000;

// ---------- Settings: language + theme (remembered in this browser only) ----------
function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode etc. — the setting just won't be remembered.
  }
}

let lang = stored("lang") || ({ et: "et", en: "en" }[(navigator.language || "ru").slice(0, 2)] ?? "ru");
if (!I18N[lang]) lang = "ru";

function t(key, vars = {}) {
  let s = I18N[lang][key] ?? I18N.ru[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

function applyI18n() {
  document.documentElement.lang = lang;
  document.title = t("app.name");
  document.querySelectorAll("[data-i18n]").forEach((e) => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach((e) => { e.innerHTML = t(e.dataset.i18nHtml); }); // our own texts only
  document.querySelectorAll("[data-i18n-placeholder]").forEach((e) => { e.placeholder = t(e.dataset.i18nPlaceholder); });
  document.querySelectorAll("[data-i18n-title]").forEach((e) => { e.title = t(e.dataset.i18nTitle); });
  $("#lang-select").value = lang;
  updateAuthLabels();
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelector('meta[name="theme-color"]').content = bg;
}

$("#lang-select").addEventListener("change", (e) => {
  lang = e.target.value;
  store("lang", lang);
  applyI18n();
  rerender();
});
$("#theme-select").value = stored("theme") || "auto";
$("#theme-select").addEventListener("change", (e) => {
  store("theme", e.target.value);
  applyTheme(e.target.value);
});

// Close the ⚙️ menu when clicking elsewhere or choosing an action.
document.addEventListener("click", (e) => {
  const menu = $("#settings");
  if (menu.open && !menu.contains(e.target)) menu.open = false;
});

// ---------- State ----------
let me = null;
let screen = null;
let shown = []; // ids already suggested in this picker session
let lastResult = null;
let pendingRoom = null; // room code from a shared link, opened after login
let pendingFriend = null; // friend code from a shared link, added after login
let previousScreen = null; // where "←" on the privacy page goes back to
let room = { code: null, timer: null, renderKey: null, shown: [], state: null };

// ---------- Helpers ----------
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-lang": lang, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || t("err.network"));
    err.status = res.status;
    throw err;
  }
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

function show(name) {
  screen = name;
  $("#loading").hidden = true;
  if (name !== screen && name === "privacy") previousScreen = screen;
  for (const id of ["auth", "code", "onboarding", "picker", "list", "room", "stats", "friends", "privacy"]) {
    $(`#screen-${id}`).hidden = id !== name;
  }
  const loggedIn = Boolean(me?.profile) && !["auth", "code"].includes(name);
  updateBadge();
  $("#nav").hidden = !loggedIn;
  $("#nav-stats").hidden = !me?.isAdmin;
  $("#account-actions").hidden = !me;
  $("#settings").open = false;
  if (name !== "room") stopRoomPolling();
  window.scrollTo({ top: 0 });
}

// Add radio/checkbox chips to a .chips container. `options` = [[value, label], ...]
function addChips(container, options, selected) {
  const { name, type } = container.dataset;
  for (const [value, label] of options) {
    const input = el("input", { type, name, value, checked: selected.includes(value) });
    container.append(el("label", { className: "chip" }, input, el("span", { textContent: label })));
  }
}

function renderChips(container, options, selected = []) {
  container.replaceChildren();
  addChips(container, options, selected);
}

const opts = (group, prefix) => IDS[group].map((id) => [id, t(`${prefix}.${id}`)]);

// All services, with a small heading above each group.
function renderServiceGroups(container, selected = []) {
  container.replaceChildren();
  for (const [heading, services] of SERVICE_GROUPS) {
    container.append(el("p", { className: "chip-group", textContent: t(heading) }));
    addChips(container, Object.keys(services).map((id) => [id, serviceName(id)]), selected);
  }
}

// Mood / time / kind / services form, used by the picker and in rooms.
function renderAnswers(form, answers = {}) {
  renderChips(form.querySelector('[data-name="mood"]'), opts("mood", "mood"), answers.mood ? [answers.mood] : []);
  renderChips(form.querySelector('[data-name="duration"]'), opts("duration", "duration"), [answers.duration || "normal"]);
  renderChips(form.querySelector('[data-name="kind"]'), opts("kind", "kind"), [answers.kind || "any"]);
  // Only show the services the user said they have (all of them if they picked none).
  const mine = (me.profile.services || []).filter((id) => ALL_SERVICE_IDS.includes(id));
  const container = form.querySelector('[data-name="services"]');
  const selected = answers.services || mine;
  if (mine.length) renderChips(container, mine.map((id) => [id, serviceName(id)]), selected);
  else renderServiceGroups(container, selected);
}

function readForm(form) {
  const out = {};
  for (const c of form.querySelectorAll(".chips")) {
    const values = [...c.querySelectorAll("input:checked")].map((i) => i.value);
    out[c.dataset.name] = c.dataset.type === "radio" ? values[0] : values;
  }
  return out;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function button(text, onClick, className = "secondary") {
  const b = el("button", { className, textContent: text });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onClick(b);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

// 1 серия, 2 серии, 5 серий (other languages use the same word for few/many).
function plural(n) {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return t("ep.one");
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return t("ep.few");
  return t("ep.many");
}

// ---------- Result card ----------
function nameOf(type, code) {
  try {
    return new Intl.DisplayNames([lang], { type }).of(type === "region" ? code.toUpperCase() : code);
  } catch {
    return code;
  }
}

function factsList(m) {
  const f = m.facts;
  if (!f) return null;
  const isSeries = m.type === "series";
  const date = f.released
    ? new Date(f.released).toLocaleDateString(lang === "et" ? "et-EE" : lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const rows = [
    [t(isSeries ? "facts.firstAired" : "facts.released"), date],
    [t("facts.language"), f.language ? nameOf("language", f.language) : null],
    [t(f.countries.length > 1 ? "facts.countries" : "facts.country"), f.countries.map((c) => nameOf("region", c)).join(", ")],
    [t(isSeries ? "facts.creators" : f.directors.length > 1 ? "facts.directors" : "facts.director"), f.directors.join(", ")],
    [t("facts.cast"), f.cast.join(", ")],
    [t("facts.seasons"), f.seasons ? `${f.seasons}${f.episodes ? ` (${t("facts.episodes", { n: f.episodes, word: plural(f.episodes) })})` : ""}` : null],
  ].filter(([, value]) => value);
  if (!rows.length) return null;
  return el("dl", { className: "facts" }, ...rows.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })]));
}

function metaLine(m) {
  return [
    m.original && m.original !== m.title ? m.original : null,
    m.year,
    m.runtime ? (m.type === "series" ? t("res.episode", { n: m.runtime }) : t("res.min", { n: m.runtime })) : null,
    m.minAge != null ? `${m.minAge}+` : null,
    (m.genres || []).join(", "),
    m.rating ? `★ ${m.rating}` : null,
  ].filter(Boolean).join(" · ");
}

// Tell the server someone clicked "Watch on …" (stats + "how was it?" later). Doesn't block the link.
function trackClick(m, service) {
  try {
    fetch("/api/click", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json", "x-lang": lang },
      body: JSON.stringify({ movieId: m.id, service, title: m.title }),
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // Never break the link because of tracking.
  }
}

// actions: { onSeen, onSkip, onAnother, onSave } — whichever are given become buttons.
function resultCard(m, actions = {}, { animate = true } = {}) {
  const isSeries = m.type === "series";
  const links = el("div", { className: "links" });
  for (const l of m.links) {
    const a = el("a", {
      className: "primary button",
      href: l.url,
      target: "_blank",
      rel: l.affiliate ? "sponsored noopener" : "noopener",
      textContent: l.label || t("res.watchOn", { service: l.service }),
    });
    a.addEventListener("click", () => trackClick(m, l.service));
    links.append(a);
  }
  if (m.trailerVideo) {
    links.append(button(t("res.trailer"), () => openTrailer(m)));
  } else {
    links.append(el("a", { className: "secondary button", href: m.trailer, target: "_blank", rel: "noopener", textContent: t("res.trailer") }));
  }

  const where = m.whereEE && (m.whereEE.stream.length || m.whereEE.rent.length)
    ? el("p", { className: "muted small" },
        (m.whereEE.stream.length ? t("res.whereStream", { list: m.whereEE.stream.join(", ") }) : "") +
        (m.whereEE.rent.length ? t("res.whereRent", { list: m.whereEE.rent.join(", ") }) : ""))
    : null;

  const buttons = el("div", { className: "actions" });
  if (actions.onSave) {
    const save = el("button", { className: "secondary", textContent: t(m.saved ? "res.saved" : "res.save") });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        m.saved = await actions.onSave(m);
        save.textContent = t(m.saved ? "res.saved" : "res.save");
      } finally {
        save.disabled = false;
      }
    });
    buttons.append(save);
  }
  if (actions.onSeen) buttons.append(button(t("res.seen"), () => actions.onSeen(m)));
  if (actions.onSkip) buttons.append(button(t("res.skip"), () => actions.onSkip(m)));
  if (actions.onAnother) buttons.append(button(t("res.another"), () => actions.onAnother(m)));
  if (actions.onRecommend) buttons.append(button(t("fr.recommend"), () => openRecommendPanel(m, buttons)));
  buttons.append(button(t("res.share"), (b) => shareResult(m, b)));

  const eyebrow = m.groupSize ? t("res.together", { n: m.groupSize }) : t(isSeries ? "res.seriesTonight" : "res.tonight");
  const body = el("div", { className: "result-body" },
    el("p", { className: "eyebrow", textContent: eyebrow }),
    m.logo ? el("img", { className: "title-logo", src: m.logo, alt: "", loading: "lazy" }) : null,
    el("h2", { textContent: m.title }),
    el("p", { className: "muted", textContent: metaLine(m) }),
    m.tagline ? el("p", { className: "tagline", textContent: `«${m.tagline}»` }) : null,
    m.overview ? el("p", { className: "overview", textContent: m.overview }) : null,
    factsList(m),
    m.tmdbUrl ? el("a", { className: "tmdb-link", href: m.tmdbUrl, target: "_blank", rel: "noopener", textContent: t("res.tmdb") }) : null,
    el("p", { textContent: m.elsewhere ? `${m.reason} ${t("res.elsewhere")}` : m.reason }),
    where,
    links,
    buttons,
    el("p", { className: "disclosure", textContent: t("res.disclosure") }),
  );

  return el("article", { className: `card result${animate ? " flip" : ""}` },
    m.poster ? el("img", { className: "poster", src: m.poster, alt: t("res.poster", { title: m.title }), loading: "lazy" }) : null,
    body,
  );
}

function showResult(container, card) {
  container.replaceChildren(card);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function toggleSaved(m) {
  const next = m.saved ? null : "saved";
  await api("/api/list", { movieId: m.id, status: next });
  return next === "saved";
}

// ---------- Trailer window ----------
let trailerModal = null;

function openTrailer(m) {
  if (!trailerModal) {
    const frame = el("div", { className: "video" });
    const caption = el("p", { className: "muted small" });
    const close = el("button", { className: "link modal-close", textContent: "✕" });
    const box = el("div", { className: "modal-box", role: "dialog", ariaModal: "true" }, close, frame, caption);
    const backdrop = el("div", { className: "modal", hidden: true }, box);
    const hide = () => {
      backdrop.hidden = true;
      frame.replaceChildren(); // stops the video
    };
    close.addEventListener("click", hide);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !backdrop.hidden) hide();
    });
    document.body.append(backdrop);
    trailerModal = { backdrop, frame, caption, close };
  }

  const v = m.trailerVideo;
  trailerModal.close.ariaLabel = t("trailer.close");
  trailerModal.frame.replaceChildren(el("iframe", {
    src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.key)}?autoplay=1&rel=0&modestbranding=1&hl=${lang}`,
    title: t("trailer.title", { title: m.title }),
    allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
    allowFullscreen: true,
  }));
  trailerModal.caption.replaceChildren(
    [t(v.official ? "trailer.official" : "trailer.plain"), v.name]
      .filter((x, i, all) => x && all.findIndex((y) => y?.toLowerCase() === x.toLowerCase()) === i)
      .join(" · ") + " · ",
    m.tmdbUrl ? el("a", { href: `${m.tmdbUrl}/videos`, target: "_blank", rel: "noopener", textContent: t("trailer.allOnTmdb") }) : "",
  );
  trailerModal.backdrop.hidden = false;
}

// ---------- Share ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] += "…";
  }
  return lines;
}

// A 1080×1350 picture: poster, title, year/genres, and the site name.
async function shareImage(m) {
  const W = 1080, H = 1350;
  const canvas = el("canvas", { width: W, height: H });
  const ctx = canvas.getContext("2d");
  const draw = (poster) => {
    ctx.fillStyle = "#12111a";
    ctx.fillRect(0, 0, W, H);
    let y = 90;
    if (poster) {
      const pw = 520, ph = Math.round(poster.height * (pw / poster.width));
      ctx.drawImage(poster, (W - pw) / 2, y, pw, ph);
      y += ph + 70;
    } else {
      ctx.font = "200px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m.type === "series" ? "📺" : "🎬", W / 2, y + 220);
      y += 320;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffb347";
    ctx.font = "600 34px system-ui, sans-serif";
    ctx.fillText(t(m.type === "series" ? "res.seriesTonight" : "res.tonight").toUpperCase(), W / 2, y);
    ctx.fillStyle = "#f1eff8";
    ctx.font = "700 64px system-ui, sans-serif";
    for (const line of wrapLines(ctx, m.title, W - 140, 2)) {
      y += 80;
      ctx.fillText(line, W / 2, y);
    }
    ctx.fillStyle = "#a19db5";
    ctx.font = "36px system-ui, sans-serif";
    ctx.fillText([m.year, (m.genres || []).slice(0, 3).join(", ")].filter(Boolean).join(" · "), W / 2, y + 64);
    ctx.fillStyle = "#ffb347";
    ctx.font = "600 38px system-ui, sans-serif";
    ctx.fillText(`🍿 ${t("app.name")} · ${location.host}`, W / 2, H - 70);
  };
  const toBlob = () => new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png");
    } catch (e) {
      reject(e); // canvas "tainted" if the poster can't be shared
    }
  });
  let poster = null;
  if (m.poster) poster = await loadImage(m.poster).catch(() => null);
  draw(poster);
  try {
    return await toBlob();
  } catch {
    draw(null);
    return toBlob();
  }
}

async function shareResult(m, b) {
  const text = t("res.shareText", { title: m.title });
  const url = location.origin;
  try {
    const blob = await shareImage(m);
    const file = new File([blob], "movie-tonight.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: `${text} ${url}` });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return; // user closed the share sheet
  }
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  if (await copyText(`${text} ${url}`)) b.textContent = t("res.shared");
}

// ---------- 1. Auth ----------
let authMode = "login";

function updateAuthLabels() {
  $("#auth-submit").textContent = t({ login: "auth.doLogin", register: "auth.doRegister", reset: "auth.doReset" }[authMode]);
  $("#password-label").textContent = t(authMode === "reset" ? "auth.newPassword" : "auth.password");
}

document.querySelectorAll("#screen-auth .tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll("#screen-auth .tab").forEach((x) => x.classList.toggle("active", x === tab));
    const form = $("#auth-form");
    updateAuthLabels();
    form.password.autocomplete = authMode === "login" ? "current-password" : "new-password";
    $("#code-field").hidden = authMode !== "reset";
    $("#consent-field").hidden = authMode !== "register";
    form.consent.required = authMode === "register";
    form.code.required = authMode === "reset";
    $("#auth-error").textContent = "";
  }),
);

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  $("#auth-error").textContent = "";
  try {
    const data = await api(`/api/${authMode}`, {
      email: form.email.value,
      password: form.password.value,
      code: form.code.value,
      consent: form.consent.checked,
    });
    form.reset();
    if (data.recoveryCode) showRecoveryCode(data.recoveryCode);
    else await start();
  } catch (err) {
    $("#auth-error").textContent = err.message;
  }
});

function showRecoveryCode(code) {
  $("#recovery-code").textContent = code;
  $("#code-saved").checked = false;
  $("#code-continue").disabled = true;
  $("#copy-code").textContent = t("code.copy");
  show("code");
}

$("#code-saved").addEventListener("change", (e) => {
  $("#code-continue").disabled = !e.target.checked;
});
$("#copy-code").addEventListener("click", async (e) => {
  e.target.textContent = t((await copyText($("#recovery-code").textContent)) ? "code.copied" : "code.copyManually");
});
$("#code-continue").addEventListener("click", () => start());

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", {}).catch(() => {});
  me = null;
  lastResult = null;
  $("#result").replaceChildren();
  show("auth");
});

// ---------- 2. Onboarding ----------
function openOnboarding(values) {
  const p = values || me.profile || {};
  const form = $("#profile-form");
  renderChips(form.querySelector('[data-name="ageGroup"]'), opts("ageGroup", "age"), [p.ageGroup]);
  renderChips(form.querySelector('[data-name="favoriteGenres"]'), opts("genres", "genre"), p.favoriteGenres || []);
  renderChips(form.querySelector('[data-name="dislikedGenres"]'), opts("genres", "genre"), p.dislikedGenres || []);
  renderChips(form.querySelector('[data-name="vibe"]'), opts("vibe", "vibe"), [p.vibe || "both"]);
  renderServiceGroups(form.querySelector('[data-name="services"]'), p.services || []);
  $("#profile-error").textContent = "";
  if (screen !== "onboarding") show("onboarding");
}

$("#edit-profile").addEventListener("click", () => openOnboarding());

$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { profile } = await api("/api/profile", readForm(e.target));
    me.profile = profile;
    if (pendingRoom) openRoom(pendingRoom);
    else openPicker();
  } catch (err) {
    $("#profile-error").textContent = err.message;
  }
});

// ---------- 3. Picker ----------
function openPicker() {
  renderAnswers($("#pick-form"));
  $("#result").replaceChildren();
  lastResult = null;
  $("#pick-error").textContent = "";
  show("picker");
  loadFeedback();
}

function pickerActions(m) {
  return {
    onSave: toggleSaved,
    onSeen: async () => { await api("/api/list", { movieId: m.id, status: "seen" }); await pick(false); },
    onSkip: async () => { await api("/api/list", { movieId: m.id, status: "skip" }); await pick(false); },
    onAnother: () => pick(false),
    onRecommend: true,
  };
}

async function pick(fresh) {
  if (fresh) shown = [];
  $("#pick-error").textContent = "";
  try {
    const m = await api("/api/recommend", { ...readForm($("#pick-form")), exclude: shown });
    shown.push(m.id);
    lastResult = m;
    showResult($("#result"), resultCard(m, pickerActions(m)));
  } catch (err) {
    if (err.status === 401) return show("auth");
    $("#pick-error").textContent = err.message;
    if (fresh) $("#result").replaceChildren();
  }
}

$("#pick-form").addEventListener("submit", (e) => {
  e.preventDefault();
  pick(true);
});

// 🎲 Surprise me: random mood, any length, movie or series — and show those choices in the form.
$("#surprise").addEventListener("click", () => {
  const form = $("#pick-form");
  const current = readForm(form);
  const mood = IDS.mood[Math.floor(Math.random() * IDS.mood.length)];
  renderAnswers(form, { mood, duration: "long", kind: "any", services: current.services?.length ? current.services : undefined });
  pick(true);
});

// "How was it?" — asked a couple of hours after you clicked "Watch on …".
async function loadFeedback() {
  const box = $("#feedback");
  box.hidden = true;
  try {
    const { item } = await api("/api/feedback");
    if (!item || screen !== "picker") return;
    box.dataset.movieId = item.id;
    $("#feedback-question").textContent = t("fb.question", { title: item.title });
    box.querySelector(".actions").hidden = false;
    box.hidden = false;
  } catch {
    // Not important enough to show an error.
  }
}

$("#feedback").querySelectorAll("[data-rating]").forEach((b) =>
  b.addEventListener("click", async () => {
    const box = $("#feedback");
    try {
      await api("/api/feedback", { movieId: box.dataset.movieId, rating: Number(b.dataset.rating) });
      $("#feedback-question").textContent = t("fb.thanks");
      box.querySelector(".actions").hidden = true;
      setTimeout(loadFeedback, 2500); // maybe there's another one to ask about
    } catch {
      box.hidden = true;
    }
  }),
);

// ---------- 4. My list ----------
let listStatus = "saved";
let listData = null;

async function openList() {
  show("list");
  loadRecap();
  $("#list-items").replaceChildren(el("p", { className: "muted", textContent: t("list.loading") }));
  try {
    listData = await api("/api/list");
    renderList();
  } catch (err) {
    $("#list-items").replaceChildren(el("p", { className: "error", textContent: err.message }));
  }
}

function renderList() {
  document.querySelectorAll("#list-tabs .tab").forEach((x) => x.classList.toggle("active", x.dataset.status === listStatus));
  if (!listData) return;
  const items = listData[listStatus];
  const empty = t({ saved: "list.emptySaved", seen: "list.emptySeen", skip: "list.emptySkip" }[listStatus]);
  if (!items.length) return $("#list-items").replaceChildren(el("p", { className: "muted", textContent: empty }));

  $("#list-items").replaceChildren(...items.map((m) => {
    const actions = el("div", { className: "actions" });
    const move = async (status) => {
      await api("/api/list", { movieId: m.id, status });
      listData = await api("/api/list");
      renderList();
    };
    if (listStatus === "saved") actions.append(button(t("list.watched"), () => move("seen")), button(t("list.remove"), () => move(null)));
    if (listStatus === "seen") actions.append(button(t("list.remove"), () => move(null)));
    if (listStatus === "skip") actions.append(button(t("list.restore"), () => move(null)));
    const rated = m.rating === 1 ? " · 👍" : m.rating === -1 ? " · 👎" : "";
    return el("div", { className: "list-item" },
      m.poster ? el("img", { className: "thumb", src: m.poster, alt: "", loading: "lazy" }) : el("div", { className: "thumb placeholder", textContent: m.type === "series" ? "📺" : "🎬" }),
      el("div", {},
        el("p", { className: "list-title", textContent: m.title }),
        el("p", { className: "muted small", textContent: [m.year, t(m.type === "series" ? "list.series" : "list.movie"), (m.genres || []).join(", ")].filter(Boolean).join(" · ") + rated }),
        actions,
      ),
    );
  }));
}

document.querySelectorAll("#list-tabs .tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    listStatus = tab.dataset.status;
    renderList();
  }),
);

$("#new-code").addEventListener("click", async () => {
  if (!confirm(t("list.newCodeConfirm"))) return;
  try {
    const { recoveryCode } = await api("/api/recovery-code", {});
    showRecoveryCode(recoveryCode);
  } catch (err) {
    alert(err.message);
  }
});

// ---------- 5. Movie night with friends ----------
function roomLink(code) {
  return `${location.origin}/?room=${code}`;
}

function openRoomStart() {
  room.code = null;
  $("#room-start").hidden = false;
  $("#room-view").hidden = true;
  $("#room-start-error").textContent = "";
  show("room");
}

async function openRoom(code) {
  pendingRoom = null;
  show("room");
  $("#room-start").hidden = true;
  $("#room-view").hidden = false;
  $("#room-error").textContent = "";
  $("#room-result").replaceChildren();
  room = { code: code.toUpperCase(), timer: null, renderKey: null, shown: [], state: null };
  try {
    let state = await api(`/api/rooms/${room.code}`);
    if (!state.joined) state = await api(`/api/rooms/${room.code}/join`, {});
    renderAnswers($("#room-form"), state.myAnswers || {});
    renderRoom(state);
    room.timer = setInterval(pollRoom, ROOM_POLL_MS);
  } catch (err) {
    openRoomStart();
    $("#room-start-error").textContent = err.message;
  }
}

async function pollRoom() {
  if (!room.code || document.hidden) return;
  try {
    renderRoom(await api(`/api/rooms/${room.code}`));
  } catch {
    // Network blip — try again on the next tick.
  }
}

function stopRoomPolling() {
  clearInterval(room.timer);
  room.timer = null;
}

function memberLabel(m) {
  const name = m.owner ? t("room.owner") : t("room.guest", { n: m.guest });
  return `${m.ready ? "✅" : "⏳"} ${name}${m.you ? t("room.you") : ""}${m.voted ? t("room.votedMark") : ""}`;
}

function renderRoom(state, force = false) {
  room.state = state;
  $("#room-code").textContent = state.code;
  $("#room-link").value = roomLink(state.code);
  $("#room-members").replaceChildren(...state.members.map((m) => el("li", { className: m.ready ? "ready" : "" }, memberLabel(m))));
  const readyCount = state.members.filter((m) => m.ready).length;
  const r = state.result;
  $("#room-owner").hidden = !state.isOwner;
  $("#room-owner-hint").textContent = t("room.readyCount", { ready: readyCount, all: state.members.length });
  $("#room-pick").textContent = t(r ? "room.newOptions" : "room.pick");
  $("#room-wait").hidden = state.isOwner || Boolean(r);
  $("#room-ready").textContent = t(state.myAnswers ? "room.update" : "room.ready");

  // Only redraw the result area when something in it changed (so cards don't flicker every 4 s).
  const key = JSON.stringify(r && [r.stage, r.stage === "voting" ? r.options.map((o) => o.id) : r.movie.id, r.counts, r.myVote, lang]);
  if (key === room.renderKey && !force) return;
  const firstFinal = r?.stage === "final" && !room.renderKey?.includes('"final"');
  room.renderKey = key;
  if (!r) return $("#room-result").replaceChildren();

  if (r.stage === "voting") {
    for (const o of r.options) if (!room.shown.includes(o.id)) room.shown.push(o.id);
    $("#room-result").replaceChildren(votingView(state));
    return;
  }
  if (!room.shown.includes(r.movie.id)) room.shown.push(r.movie.id);
  const card = resultCard({ ...r.movie, groupSize: r.groupSize }, { onSave: toggleSaved, onRecommend: true }, { animate: firstFinal || force === "animate" });
  const top = r.counts?.length ? Math.max(...r.counts) : 0;
  const parts = [top ? el("p", { className: "muted", textContent: t("room.winner", { n: top }) }) : null, card].filter(Boolean);
  $("#room-result").replaceChildren(...parts);
  if (firstFinal) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function votingView(state) {
  const r = state.result;
  const cards = r.options.map((o, i) => {
    const mine = r.myVote === i;
    return el("article", { className: `card option${mine ? " chosen" : ""}` },
      o.poster ? el("img", { className: "option-poster", src: o.poster, alt: "", loading: "lazy" })
        : el("div", { className: "option-poster placeholder", textContent: o.type === "series" ? "📺" : "🎬" }),
      el("div", { className: "option-body" },
        el("h3", { textContent: o.title }),
        el("p", { className: "muted small", textContent: metaLine(o) }),
        o.overview ? el("p", { className: "small clamp", textContent: o.overview }) : null,
        el("p", { className: "muted small", textContent: t("room.votes", { n: r.counts[i] }) }),
        el("div", { className: "actions" },
          mine ? el("span", { className: "voted", textContent: t("room.myVote") })
            : button(t("room.vote"), async () => renderRoom(await api(`/api/rooms/${room.code}/vote`, { index: i }), true), "primary"),
          o.trailerVideo ? button(t("res.trailer"), () => openTrailer(o)) : null,
        ),
      ),
    );
  });
  const wrap = el("div", { className: "voting" },
    el("h2", { textContent: t("room.voteTitle") }),
    el("p", { className: "muted", textContent: t("room.voteText") }),
    el("div", { className: "options" }, ...cards),
  );
  if (state.isOwner) {
    wrap.append(button(t("room.finish"), async () => renderRoom(await api(`/api/rooms/${room.code}/finish`, {}), "animate")));
  }
  return wrap;
}

async function pickForRoom() {
  $("#room-error").textContent = "";
  try {
    renderRoom(await api(`/api/rooms/${room.code}/pick`, { exclude: room.shown }), true);
  } catch (err) {
    $("#room-error").textContent = err.message;
  }
}

$("#room-create").addEventListener("click", async () => {
  try {
    const { code } = await api("/api/rooms", {});
    history.replaceState(null, "", `/?room=${code}`);
    openRoom(code);
  } catch (err) {
    $("#room-start-error").textContent = err.message;
  }
});

$("#room-join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = e.target.code.value.trim().toUpperCase();
  if (code.length === 6) {
    history.replaceState(null, "", `/?room=${code}`);
    openRoom(code);
  }
});

$("#room-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#room-error").textContent = "";
  try {
    renderRoom(await api(`/api/rooms/${room.code}/join`, readForm(e.target)));
  } catch (err) {
    $("#room-error").textContent = err.message;
  }
});

$("#room-pick").addEventListener("click", pickForRoom);

$("#room-share").addEventListener("click", async (e) => {
  const link = roomLink(room.code);
  if (navigator.share) {
    try {
      await navigator.share({ title: t("app.name"), text: t("room.shareMsg"), url: link });
      return;
    } catch {
      // Cancelled or not allowed — fall back to copying.
    }
  }
  e.target.textContent = t((await copyText(link)) ? "room.copied" : "room.copyManually");
});

// ---------- 6. Stats (admin only) ----------
let lastStats = null;

async function openStats() {
  show("stats");
  $("#stats-body").replaceChildren(el("p", { className: "muted", textContent: t("loading") }));
  try {
    lastStats = await api("/api/stats");
    renderStats();
  } catch (err) {
    $("#stats-body").replaceChildren(el("p", { className: "error", textContent: err.message }));
  }
}

function barTable(rows, labelKey) {
  if (!rows.length) return el("p", { className: "muted", textContent: t("stats.none") });
  const max = Math.max(...rows.map((r) => r.n));
  return el("div", { className: "bars" }, ...rows.map((r) =>
    el("div", { className: "bar-row" },
      el("span", { className: "bar-label", textContent: r[labelKey] || "—" }),
      el("span", { className: "bar-track" }, el("span", { className: "bar-fill", style: `width:${Math.max(4, (r.n / max) * 100)}%` })),
      el("span", { className: "bar-value", textContent: r.n }),
    ),
  ));
}

function renderStats() {
  const s = lastStats;
  if (!s) return;
  const tile = (label, value) => el("div", { className: "tile" }, el("p", { className: "tile-value", textContent: value }), el("p", { className: "muted small", textContent: label }));
  const maxDay = Math.max(1, ...s.clicksPerDay);
  const days = el("div", { className: "days" }, ...s.clicksPerDay.map((n) =>
    el("span", { className: "day", title: String(n), style: `height:${Math.max(2, (n / maxDay) * 100)}%` }),
  ));
  $("#stats-body").replaceChildren(
    el("div", { className: "tiles" },
      tile(t("stats.users"), s.users),
      tile(t("stats.newUsers"), s.newUsers7),
      tile(t("stats.rooms"), s.rooms30),
      tile(t("stats.ratings"), `${s.ratings.up} / ${s.ratings.down}`),
    ),
    el("div", { className: "card" }, el("h2", { className: "small-heading", textContent: t("stats.clicks30") }), barTable(s.clicks30, "service")),
    el("div", { className: "card" }, el("h2", { className: "small-heading", textContent: t("stats.perDay") }), days),
    el("div", { className: "card" }, el("h2", { className: "small-heading", textContent: t("stats.top") }), barTable(s.topTitles, "title")),
    el("div", { className: "card" }, el("h2", { className: "small-heading", textContent: t("stats.clicksAll") }), barTable(s.clicksAll, "service")),
  );
}

// ---------- 7. Trial pick without an account ----------
function renderTrialForm(values = {}) {
  const form = $("#trial-form");
  renderChips(form.querySelector('[data-name="mood"]'), opts("mood", "mood"), values.mood ? [values.mood] : []);
  renderServiceGroups(form.querySelector('[data-name="services"]'), values.services || []);
}

$("#trial-open").addEventListener("click", () => {
  $("#trial-open").hidden = true;
  $("#trial").hidden = false;
  renderTrialForm();
  $("#trial").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#trial-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#trial-error").textContent = "";
  try {
    const m = await api("/api/try", { ...readForm(e.target), duration: "long", kind: "any" });
    showResult($("#trial-result"), resultCard(m, {}));
    $("#trial-form").hidden = true;
  } catch (err) {
    $("#trial-error").textContent = err.message;
  }
  $("#trial-cta").hidden = false;
});

$("#trial-signup").addEventListener("click", () => {
  document.querySelector('#screen-auth .tab[data-mode="register"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#auth-form").email.focus();
});

// ---------- 8. 🤝 Friends ----------
let friendsData = null;
let friendToast = null; // set after adding a friend from a shared link

function updateBadge() {
  const n = me?.newRecommendations || 0;
  $("#friends-badge").hidden = !n;
  $("#friends-badge").textContent = n;
}

function friendLink(code) {
  return `${location.origin}/?friend=${code}`;
}

async function openFriends() {
  show("friends");
  $("#friend-recs").replaceChildren(el("p", { className: "muted", textContent: t("loading") }));
  try {
    friendsData = await api("/api/friends");
    if (me) me.newRecommendations = friendsData.recommendations.length;
    updateBadge();
    renderFriends();
  } catch (err) {
    $("#friend-recs").replaceChildren(el("p", { className: "error", textContent: err.message }));
  }
}

function thumb(m) {
  return m.poster
    ? el("img", { className: "thumb", src: m.poster, alt: "", loading: "lazy" })
    : el("div", { className: "thumb placeholder", textContent: m.type === "series" ? "📺" : "🎬" });
}

function renderFriends() {
  const d = friendsData;
  if (!d) return;
  $("#my-friend-code").textContent = d.me.code;
  const nick = $("#nickname-form").nickname;
  if (document.activeElement !== nick) nick.value = d.me.nickname || "";

  if (friendToast) {
    $("#add-friend-msg").className = friendToast.error ? "error" : "success";
    $("#add-friend-msg").textContent = friendToast.error || t("fr.added");
    friendToast = null;
  }

  $("#friend-recs").replaceChildren(...(d.recommendations.length
    ? d.recommendations.map((r) => {
        const dismiss = async () => {
          await api("/api/friends/dismiss", { id: r.id });
          await openFriends();
        };
        return el("div", { className: "list-item" },
          thumb(r.movie),
          el("div", {},
            el("p", { className: "muted small", textContent: t("fr.recFrom", { name: r.from || t("fr.noName") }) }),
            el("p", { className: "list-title", textContent: r.movie.title }),
            el("p", { className: "muted small", textContent: [r.movie.year, (r.movie.genres || []).join(", ")].filter(Boolean).join(" · ") }),
            el("div", { className: "actions" },
              button(t("res.save"), async () => {
                await api("/api/list", { movieId: r.movie.id, status: "saved" });
                await dismiss();
              }),
              button(t("fr.dismiss"), dismiss),
            ),
          ),
        );
      })
    : [el("p", { className: "muted", textContent: t("fr.noRecs") })]));

  $("#friend-list").replaceChildren(...(d.friends.length
    ? d.friends.map((f) => {
        const name = f.nickname || t("fr.noName");
        return el("div", { className: "card friend" },
          el("div", { className: "friend-head" },
            el("p", { className: "list-title", textContent: name }),
            button(t("fr.remove"), async () => {
              if (!confirm(t("fr.removeConfirm", { name }))) return;
              await api("/api/friends/remove", { code: f.code });
              await openFriends();
            }, "link"),
          ),
          el("p", { className: "muted small", textContent: t("fr.likes") }),
          f.likes.length
            ? el("div", { className: "likes" }, ...f.likes.map((m) =>
                el("div", { className: "like", title: m.title }, thumb(m), el("span", { className: "small", textContent: m.title }))))
            : el("p", { className: "muted small", textContent: t("fr.noLikes") }),
        );
      })
    : [el("p", { className: "muted card", textContent: t("fr.noFriends") })]));
}

$("#nickname-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#nickname-error").textContent = "";
  try {
    await api("/api/friends/nickname", { nickname: e.target.nickname.value });
    friendsData.me.nickname = e.target.nickname.value.trim();
    e.target.querySelector("button").textContent = t("fr.saved");
    setTimeout(() => { e.target.querySelector("button").textContent = t("fr.save"); }, 2000);
  } catch (err) {
    $("#nickname-error").textContent = err.message;
  }
});

$("#share-friend-code").addEventListener("click", async (e) => {
  const link = friendLink(friendsData.me.code);
  if (navigator.share) {
    try {
      await navigator.share({ title: t("app.name"), text: t("fr.shareMsg"), url: link });
      return;
    } catch {
      // Cancelled — fall back to copying.
    }
  }
  e.target.textContent = t((await copyText(`${t("fr.shareMsg")} ${link}`)) ? "fr.copied" : "room.copyManually");
});

$("#add-friend-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#add-friend-msg");
  msg.className = "error";
  msg.textContent = "";
  try {
    await api("/api/friends/add", { code: e.target.code.value });
    e.target.reset();
    friendToast = "ok";
    await openFriends();
  } catch (err) {
    msg.textContent = err.message;
  }
});

// "🤝 Recommend" on a result card: pick a friend and send.
async function openRecommendPanel(m, buttons) {
  const old = buttons.parentElement.querySelector(".recommend-panel");
  if (old) return old.remove();
  const panel = el("div", { className: "recommend-panel" }, el("p", { className: "muted small", textContent: t("loading") }));
  buttons.after(panel);
  try {
    const { friends } = await api("/api/friends/names");
    if (!friends.length) return panel.replaceChildren(el("p", { className: "muted small", textContent: t("fr.needFriends") }));
    const select = el("select", {}, ...friends.map((f) => el("option", { value: f.code, textContent: f.nickname || t("fr.noName") })));
    const status = el("span", { className: "muted small" });
    panel.replaceChildren(
      el("label", { className: "small" }, t("fr.recommendTo"), select),
      button(t("fr.send"), async () => {
        status.textContent = "";
        try {
          await api("/api/friends/recommend", { code: select.value, movieId: m.id });
          status.textContent = t("fr.sent");
        } catch (err) {
          status.textContent = err.message;
        }
      }, "primary"),
      status,
    );
  } catch (err) {
    panel.replaceChildren(el("p", { className: "error", textContent: err.message }));
  }
}

// ---------- 9. 📅 Monthly recap ----------
let recapMonth = null; // "2026-10"
let recapData = null;

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(key, delta) {
  const [y, mo] = key.split("-").map(Number);
  return monthKey(new Date(y, mo - 1 + delta, 1));
}
function monthName(key, withYear = true) {
  const [y, mo] = key.split("-").map(Number);
  const locale = lang === "et" ? "et-EE" : lang === "en" ? "en-GB" : "ru-RU";
  return new Date(y, mo - 1, 1).toLocaleDateString(locale, withYear ? { month: "long", year: "numeric" } : { month: "long" });
}

async function loadRecap() {
  recapMonth = recapMonth || monthKey(new Date());
  $("#recap-body").replaceChildren(el("p", { className: "muted small", textContent: t("loading") }));
  try {
    recapData = await api(`/api/recap?month=${recapMonth}`);
    renderRecap();
  } catch (err) {
    $("#recap-body").replaceChildren(el("p", { className: "error", textContent: err.message }));
  }
}

function renderRecap() {
  const r = recapData;
  if (!r) return;
  $("#recap-next").disabled = r.month >= monthKey(new Date());
  const head = el("p", { className: "recap-month", textContent: monthName(r.month) });
  if (!r.watched) {
    return $("#recap-body").replaceChildren(head, el("p", { className: "muted", textContent: t("recap.empty") }));
  }
  const stat = (value, label) => el("div", { className: "tile" }, el("p", { className: "tile-value", textContent: value }), el("p", { className: "muted small", textContent: label }));
  $("#recap-body").replaceChildren(
    head,
    el("div", { className: "tiles" },
      stat(r.watched, t("recap.watched")),
      r.minutes ? stat(Math.round(r.minutes / 60), t("recap.hours")) : null,
      stat(r.liked, t("recap.liked")),
    ),
    r.topGenre ? el("p", { textContent: t("recap.topGenre", { genre: t(`genre.${r.topGenre}`) }) }) : null,
    r.topService ? el("p", { textContent: t("recap.topService", { service: r.topService }) }) : null,
    el("div", { className: "likes" }, ...r.titles.map((m) =>
      el("div", { className: "like", title: m.title }, thumb(m), el("span", { className: "small", textContent: `${m.rating === 1 ? "👍 " : m.rating === -1 ? "👎 " : ""}${m.title}` })))),
    button(t("recap.share"), (b) => shareRecap(r, b)),
  );
}

$("#recap-prev").addEventListener("click", () => { recapMonth = shiftMonth(recapMonth, -1); loadRecap(); });
$("#recap-next").addEventListener("click", () => { recapMonth = shiftMonth(recapMonth, 1); loadRecap(); });

// A 1080×1350 recap picture: headline, big numbers, favourite genre, up to 6 posters.
async function recapImage(r) {
  const W = 1080, H = 1350;
  const canvas = el("canvas", { width: W, height: H });
  const ctx = canvas.getContext("2d");
  const posters = await Promise.all(r.titles.map((m) => (m.poster ? loadImage(m.poster).catch(() => null) : null)));
  const draw = (withPosters) => {
    ctx.fillStyle = "#12111a";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffb347";
    ctx.font = "600 40px system-ui, sans-serif";
    ctx.fillText(t("recap.headline", { month: monthName(r.month, false) }).toUpperCase(), W / 2, 110);
    ctx.fillStyle = "#f1eff8";
    ctx.font = "800 220px system-ui, sans-serif";
    ctx.fillText(String(r.watched), W / 2, 330);
    ctx.font = "44px system-ui, sans-serif";
    ctx.fillStyle = "#a19db5";
    ctx.fillText(t("recap.watched"), W / 2, 395);
    const line = [r.minutes ? `≈ ${Math.round(r.minutes / 60)} h` : null, `👍 ${r.liked}`, r.topGenre ? t(`genre.${r.topGenre}`) : null].filter(Boolean).join("   ·   ");
    ctx.fillStyle = "#f1eff8";
    ctx.font = "600 46px system-ui, sans-serif";
    ctx.fillText(line, W / 2, 480);
    const pw = 280, ph = 420, gap = 30, top = 560;
    const shown = r.titles.slice(0, 6);
    const cols = Math.min(3, shown.length);
    const startX = (W - (cols * pw + (cols - 1) * gap)) / 2;
    shown.slice(0, 3).forEach((m, i) => {
      const x = startX + i * (pw + gap);
      if (withPosters && posters[i]) ctx.drawImage(posters[i], x, top, pw, ph);
      else {
        ctx.fillStyle = "#2e2c3d";
        ctx.fillRect(x, top, pw, ph);
        ctx.fillStyle = "#f1eff8";
        ctx.font = "600 34px system-ui, sans-serif";
        wrapLines(ctx, m.title, pw - 30, 4).forEach((l, j) => ctx.fillText(l, x + pw / 2, top + 170 + j * 44));
      }
    });
    ctx.fillStyle = "#ffb347";
    ctx.font = "600 38px system-ui, sans-serif";
    ctx.fillText(`🍿 ${t("app.name")} · ${location.host}`, W / 2, H - 70);
  };
  const toBlob = () => new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png");
    } catch (e) {
      reject(e);
    }
  });
  draw(true);
  try {
    return await toBlob();
  } catch {
    draw(false); // posters couldn't be used — share without them
    return toBlob();
  }
}

async function shareRecap(r, b) {
  const text = `${t("recap.headline", { month: monthName(r.month, false) })}: ${r.watched} 🍿`;
  try {
    const blob = await recapImage(r);
    const file = new File([blob], "movie-recap.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: `${text} ${location.origin}` });
      return;
    }
    // No share sheet (e.g. a computer): download the picture instead.
    const a = el("a", { href: URL.createObjectURL(blob), download: "movie-recap.png" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (await copyText(`${text} ${location.origin}`)) b.textContent = t("res.shared");
  }
}

// ---------- 10. Delete account ----------
$("#delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#delete-error").textContent = "";
  if (!confirm(t("acc.deleteConfirm"))) return;
  try {
    await api("/api/account/delete", { password: e.target.password.value });
    me = null;
    alert(t("acc.deleted"));
    location.href = "/";
  } catch (err) {
    $("#delete-error").textContent = err.message;
  }
});

// ---------- 11. 🔒 Privacy page ----------
let contactEmail; // undefined = not loaded yet

async function openPrivacy() {
  show("privacy");
  if (contactEmail === undefined) {
    contactEmail = await api("/api/config").then((c) => c.contact).catch(() => null);
  }
  renderPrivacyContact();
}

function renderPrivacyContact() {
  const p = $("#privacy-contact");
  if (!contactEmail) return (p.textContent = t("pv.noContact"));
  const [before, after] = t("pv.contact").split("{email}");
  p.replaceChildren(before, el("a", { href: `mailto:${contactEmail}`, textContent: contactEmail }), after || "");
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".open-privacy")) {
    e.preventDefault();
    openPrivacy();
  }
});

$("#privacy-back").addEventListener("click", () => {
  const back = previousScreen;
  if (!me) return show("auth");
  if (back === "list") return openList();
  if (back === "friends") return openFriends();
  if (back === "room" && room.code) return openRoom(room.code);
  openPicker();
});

// ---------- Navigation ----------
document.querySelectorAll("[data-go]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.go === "list") openList();
    if (b.dataset.go === "room") room.code ? openRoom(room.code) : openRoomStart();
    if (b.dataset.go === "stats") openStats();
    if (b.dataset.go === "friends") openFriends();
  }),
);

$("#home").addEventListener("click", () => {
  if (!me) return show("auth");
  if (!me.profile) return openOnboarding();
  history.replaceState(null, "", "/");
  openPicker();
});

// Redraw the current screen in the new language, keeping what the user already chose.
function rerender() {
  if (screen === "onboarding") openOnboarding(readForm($("#profile-form")));
  if (screen === "picker") {
    renderAnswers($("#pick-form"), readForm($("#pick-form")));
    if (lastResult) $("#result").replaceChildren(resultCard(lastResult, pickerActions(lastResult), { animate: false }));
    loadFeedback();
  }
  if (screen === "list") {
    renderList();
    renderRecap();
  }
  if (screen === "room" && room.state) {
    renderAnswers($("#room-form"), readForm($("#room-form")));
    renderRoom(room.state, true);
  }
  if (screen === "stats") renderStats();
  if (screen === "friends") renderFriends();
  if (screen === "privacy") renderPrivacyContact();
  if (!$("#trial").hidden) renderTrialForm(readForm($("#trial-form")));
}

// ---------- Start ----------
async function start() {
  try {
    me = await api("/api/me");
  } catch {
    me = null;
    return show("auth");
  }
  if (pendingFriend) {
    const code = pendingFriend;
    pendingFriend = null;
    try {
      await api("/api/friends/add", { code });
      friendToast = code;
    } catch (err) {
      friendToast = { error: err.message };
    }
  }
  if (!me.profile) return openOnboarding();
  if (pendingRoom) return openRoom(pendingRoom);
  if (friendToast) return openFriends();
  openPicker();
}

const friendParam = new URLSearchParams(location.search).get("friend");
if (friendParam && /^[A-Za-z0-9-]{8,9}$/.test(friendParam)) pendingFriend = friendParam;
const roomParam = new URLSearchParams(location.search).get("room");
if (roomParam && /^[A-Za-z0-9]{6}$/.test(roomParam)) pendingRoom = roomParam.toUpperCase();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

applyI18n();
applyTheme(stored("theme") || "auto");
start();
