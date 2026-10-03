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
  kind: { movie: "🎬 фильм", series: "📺 сериал", any: "всё равно" },
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
const ROOM_POLL_MS = 4000;
let me = null;
let shown = []; // ids already suggested in this picker session
let pendingRoom = null; // room code from a shared link, opened after login
let room = { code: null, timer: null, resultId: null, shown: [] };

// ---------- Helpers ----------
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

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

function show(screen) {
  $("#loading").hidden = true;
  for (const id of ["auth", "code", "onboarding", "picker", "list", "room"]) {
    $(`#screen-${id}`).hidden = id !== screen;
  }
  $("#nav").hidden = ["auth", "code"].includes(screen) || !me?.profile;
  if (screen !== "room") stopRoomPolling();
  window.scrollTo({ top: 0 });
}

// Add radio/checkbox chips to a .chips container.
function addChips(container, options, selected) {
  const { name, type } = container.dataset;
  for (const [value, label] of Object.entries(options)) {
    const input = el("input", { type, name, value, checked: selected.includes(value) });
    container.append(el("label", { className: "chip" }, input, el("span", { textContent: label })));
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
    container.append(el("p", { className: "chip-group", textContent: heading }));
    addChips(container, services, selected);
  }
}

// Mood / time / kind / services form, used by the picker and in rooms.
function renderAnswers(form, answers = {}) {
  renderChips(form.querySelector('[data-name="mood"]'), OPTIONS.mood, answers.mood ? [answers.mood] : []);
  renderChips(form.querySelector('[data-name="duration"]'), OPTIONS.duration, [answers.duration || "normal"]);
  renderChips(form.querySelector('[data-name="kind"]'), OPTIONS.kind, [answers.kind || "any"]);
  // Only show the services the user said they have (all of them if they picked none).
  const mine = (me.profile.services || []).filter((id) => id in ALL_SERVICES);
  const container = form.querySelector('[data-name="services"]');
  const selected = answers.services || mine;
  if (mine.length) renderChips(container, Object.fromEntries(mine.map((id) => [id, ALL_SERVICES[id]])), selected);
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

// ---------- Result card ----------
// actions: { onSeen, onSkip, onAnother, onSave } — whichever are given become buttons.
function resultCard(m, actions = {}) {
  const isSeries = m.type === "series";
  const meta = [
    m.original !== m.title ? m.original : null,
    m.year,
    isSeries ? `серия ~${m.runtime} мин` : `${m.runtime} мин`,
    `${m.minAge}+`,
    m.genres.join(", "),
    m.rating ? `★ ${m.rating}` : null,
  ].filter(Boolean).join(" · ");

  const links = el("div", { className: "links" });
  for (const l of m.links) {
    links.append(el("a", {
      className: "primary button",
      href: l.url,
      target: "_blank",
      rel: l.affiliate ? "sponsored noopener" : "noopener",
      textContent: l.label || `Смотреть на ${l.service}`,
    }));
  }
  if (m.trailerVideo) {
    const play = el("button", { className: "secondary", textContent: "▶ Трейлер" });
    play.addEventListener("click", () => openTrailer(m));
    links.append(play);
  } else {
    links.append(el("a", { className: "secondary button", href: m.trailer, target: "_blank", rel: "noopener", textContent: "▶ Трейлер" }));
  }

  const where = m.whereEE && (m.whereEE.stream.length || m.whereEE.rent.length)
    ? el("p", { className: "muted small" }, [
        m.whereEE.stream.length ? `В Эстонии по подписке: ${m.whereEE.stream.join(", ")}.` : "",
        m.whereEE.rent.length ? ` Напрокат: ${m.whereEE.rent.join(", ")}.` : "",
      ].join(""))
    : null;

  const reason = m.elsewhere
    ? `${m.reason} На твоих сервисах подходящего не нашлось — вот где это можно найти.`
    : m.reason;

  const buttons = el("div", { className: "actions" });
  if (actions.onSave) {
    const save = el("button", { className: "secondary", textContent: m.saved ? "★ В списке" : "☆ В список" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        m.saved = await actions.onSave(m);
        save.textContent = m.saved ? "★ В списке" : "☆ В список";
      } finally {
        save.disabled = false;
      }
    });
    buttons.append(save);
  }
  if (actions.onSeen) buttons.append(button("👁 Уже видел", () => actions.onSeen(m)));
  if (actions.onSkip) buttons.append(button("🙅 Не для меня", () => actions.onSkip(m)));
  if (actions.onAnother) buttons.append(button("🔄 Другой вариант", () => actions.onAnother(m)));

  const body = el("div", { className: "result-body" },
    el("p", { className: "eyebrow", textContent: m.groupSize ? `Смотрим вместе · ${m.groupSize} чел.` : isSeries ? "Сериал на вечер" : "Сегодня смотрим" }),
    m.logo ? el("img", { className: "title-logo", src: m.logo, alt: "", loading: "lazy" }) : null,
    el("h2", { textContent: m.title }),
    el("p", { className: "muted", textContent: meta }),
    m.tagline ? el("p", { className: "tagline", textContent: `«${m.tagline}»` }) : null,
    m.overview ? el("p", { className: "overview", textContent: m.overview }) : null,
    factsList(m),
    m.tmdbUrl ? el("a", { className: "tmdb-link", href: m.tmdbUrl, target: "_blank", rel: "noopener", textContent: "Подробнее на TMDB →" }) : null,
    el("p", { textContent: reason }),
    where,
    links,
    buttons.childElementCount ? buttons : null,
    el("p", { className: "disclosure", textContent: "Некоторые ссылки — партнёрские: если ты оформишь подписку или купишь фильм, мы можем получить небольшую комиссию. Для тебя цена не меняется." }),
  );

  const card = el("article", { className: "card result flip" },
    m.poster ? el("img", { className: "poster", src: m.poster, alt: `Постер: ${m.title}`, loading: "lazy" }) : null,
    body,
  );
  return card;
}

// "About the film" facts from TMDB: release date, language, country, director, cast, seasons.
function nameOf(type, code) {
  try {
    return new Intl.DisplayNames(["ru"], { type }).of(type === "region" ? code.toUpperCase() : code);
  } catch {
    return code;
  }
}

// 1 серия, 2 серии, 5 серий.
function plural(n, one, few, many) {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

function factsList(m) {
  const f = m.facts;
  if (!f) return null;
  const isSeries = m.type === "series";
  const date = f.released
    ? new Date(f.released).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const rows = [
    [isSeries ? "Первая серия" : "Дата выхода", date],
    ["Язык оригинала", f.language ? nameOf("language", f.language) : null],
    [f.countries.length > 1 ? "Страны" : "Страна", f.countries.map((c) => nameOf("region", c)).join(", ")],
    [isSeries ? "Создатели" : f.directors.length > 1 ? "Режиссёры" : "Режиссёр", f.directors.join(", ")],
    ["В ролях", f.cast.join(", ")],
    ["Сезонов", f.seasons ? `${f.seasons}${f.episodes ? ` (${f.episodes} ${plural(f.episodes, "серия", "серии", "серий")})` : ""}` : null],
  ].filter(([, value]) => value);
  if (!rows.length) return null;
  return el("dl", { className: "facts" }, ...rows.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })]));
}

// Official trailer (chosen from TMDB data) played in a window on our page.
let trailerModal = null;

function openTrailer(m) {
  if (!trailerModal) {
    const frame = el("div", { className: "video" });
    const caption = el("p", { className: "muted small" });
    const close = el("button", { className: "link modal-close", textContent: "✕", ariaLabel: "Закрыть" });
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
    trailerModal = { backdrop, frame, caption };
  }

  const v = m.trailerVideo;
  trailerModal.frame.replaceChildren(el("iframe", {
    src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.key)}?autoplay=1&rel=0&modestbranding=1`,
    title: `Трейлер: ${m.title}`,
    allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
    allowFullscreen: true,
  }));
  trailerModal.caption.replaceChildren(
    [v.official ? "Официальный трейлер" : "Трейлер", v.name]
      .filter((x, i, all) => x && all.findIndex((y) => y?.toLowerCase() === x.toLowerCase()) === i)
      .join(" · ") + " · ",
    m.tmdbUrl
      ? el("a", { href: `${m.tmdbUrl}/videos`, target: "_blank", rel: "noopener", textContent: "все видео на TMDB" })
      : "",
  );
  trailerModal.backdrop.hidden = false;
}

function button(text, onClick) {
  const b = el("button", { className: "secondary", textContent: text });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onClick();
    } finally {
      b.disabled = false;
    }
  });
  return b;
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

// ---------- 1. Auth ----------
let authMode = "login";
document.querySelectorAll("#screen-auth .tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll("#screen-auth .tab").forEach((t) => t.classList.toggle("active", t === tab));
    const form = $("#auth-form");
    $("#auth-submit").textContent = { login: "Войти", register: "Создать аккаунт", reset: "Задать новый пароль" }[authMode];
    $("#password-label").textContent = authMode === "reset" ? "Новый пароль" : "Пароль";
    form.password.autocomplete = authMode === "login" ? "current-password" : "new-password";
    $("#code-field").hidden = authMode !== "reset";
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
  show("code");
}

$("#code-saved").addEventListener("change", (e) => {
  $("#code-continue").disabled = !e.target.checked;
});
$("#copy-code").addEventListener("click", async (e) => {
  e.target.textContent = (await copyText($("#recovery-code").textContent)) ? "Скопировано ✓" : "Выдели и скопируй вручную";
});
$("#code-continue").addEventListener("click", () => start());

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", {}).catch(() => {});
  me = null;
  $("#result").replaceChildren();
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
  $("#pick-error").textContent = "";
  show("picker");
}

async function pick(fresh) {
  if (fresh) shown = [];
  $("#pick-error").textContent = "";
  try {
    const m = await api("/api/recommend", { ...readForm($("#pick-form")), exclude: shown });
    shown.push(m.id);
    showResult($("#result"), resultCard(m, {
      onSave: toggleSaved,
      onSeen: async () => { await api("/api/list", { movieId: m.id, status: "seen" }); await pick(false); },
      onSkip: async () => { await api("/api/list", { movieId: m.id, status: "skip" }); await pick(false); },
      onAnother: () => pick(false),
    }));
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

// ---------- 4. My list ----------
let listStatus = "saved";
let listData = null;

async function openList() {
  show("list");
  $("#list-items").replaceChildren(el("p", { className: "muted", textContent: "Загрузка…" }));
  try {
    listData = await api("/api/list");
    renderList();
  } catch (err) {
    $("#list-items").replaceChildren(el("p", { className: "error", textContent: err.message }));
  }
}

function renderList() {
  document.querySelectorAll("#list-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.status === listStatus));
  const items = listData[listStatus];
  const empty = {
    saved: "Пока пусто. Нажми «☆ В список» на любом фильме, чтобы сохранить его на потом.",
    seen: "Здесь будут фильмы, которые ты отметил «👁 Уже видел».",
    skip: "Здесь будут фильмы, которые ты отметил «🙅 Не для меня». Они больше не будут предлагаться.",
  }[listStatus];
  if (!items.length) return $("#list-items").replaceChildren(el("p", { className: "muted", textContent: empty }));

  $("#list-items").replaceChildren(...items.map((m) => {
    const actions = el("div", { className: "actions" });
    const move = async (status) => {
      await api("/api/list", { movieId: m.id, status });
      listData = await api("/api/list");
      renderList();
    };
    if (listStatus === "saved") actions.append(button("👁 Посмотрел", () => move("seen")), button("Убрать", () => move(null)));
    if (listStatus === "seen") actions.append(button("Убрать", () => move(null)));
    if (listStatus === "skip") actions.append(button("Вернуть в подбор", () => move(null)));
    return el("div", { className: "list-item" },
      m.poster ? el("img", { className: "thumb", src: m.poster, alt: "", loading: "lazy" }) : el("div", { className: "thumb placeholder", textContent: m.type === "series" ? "📺" : "🎬" }),
      el("div", {},
        el("p", { className: "list-title", textContent: m.title }),
        el("p", { className: "muted small", textContent: `${m.year} · ${m.type === "series" ? "сериал" : "фильм"} · ${m.genres.join(", ")}` }),
        actions,
      ),
    );
  }));
}

document.querySelectorAll("#list-tabs .tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    listStatus = tab.dataset.status;
    if (listData) renderList();
  }),
);

$("#new-code").addEventListener("click", async () => {
  if (!confirm("Создать новый код? Старый перестанет работать.")) return;
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
  room = { code: code.toUpperCase(), timer: null, resultId: null, shown: [] };
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

function renderRoom(state) {
  $("#room-code").textContent = state.code;
  $("#room-link").value = roomLink(state.code);
  $("#room-members").replaceChildren(...state.members.map((m) =>
    el("li", { className: m.ready ? "ready" : "" }, `${m.ready ? "✅" : "⏳"} ${m.label}${m.you ? " (ты)" : ""}`),
  ));
  const readyCount = state.members.filter((m) => m.ready).length;
  $("#room-owner").hidden = !state.isOwner;
  $("#room-owner-hint").textContent = `Готовы: ${readyCount} из ${state.members.length}. Подбор учтёт тех, кто нажал «Я готов».`;
  $("#room-wait").hidden = state.isOwner || Boolean(state.result);
  $("#room-ready").textContent = state.myAnswers ? "Обновить мои ответы" : "Я готов";

  const r = state.result;
  if (r && r.id !== room.resultId) {
    room.resultId = r.id;
    if (!room.shown.includes(r.id)) room.shown.push(r.id);
    showResult($("#room-result"), resultCard(r, {
      onSave: toggleSaved,
      onAnother: state.isOwner ? () => pickForRoom() : null,
    }));
  }
}

async function pickForRoom() {
  $("#room-error").textContent = "";
  try {
    renderRoom(await api(`/api/rooms/${room.code}/pick`, { exclude: room.shown }));
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
      await navigator.share({ title: "Что посмотреть вместе", text: "Выбираем фильм на вечер — заходи:", url: link });
      return;
    } catch {
      // Cancelled or not allowed — fall back to copying.
    }
  }
  e.target.textContent = (await copyText(link)) ? "Скопировано ✓" : "Скопируй ссылку вручную";
});

// ---------- Navigation ----------
document.querySelectorAll("[data-go]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.go === "list") openList();
    if (b.dataset.go === "room") room.code ? openRoom(room.code) : openRoomStart();
  }),
);

$("#home").addEventListener("click", () => {
  if (!me) return show("auth");
  if (!me.profile) return openOnboarding();
  history.replaceState(null, "", "/");
  openPicker();
});

// ---------- Start ----------
async function start() {
  try {
    me = await api("/api/me");
  } catch {
    return show("auth");
  }
  if (!me.profile) return openOnboarding();
  if (pendingRoom) return openRoom(pendingRoom);
  openPicker();
}

const roomParam = new URLSearchParams(location.search).get("room");
if (roomParam && /^[A-Za-z0-9]{6}$/.test(roomParam)) pendingRoom = roomParam.toUpperCase();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

start();
