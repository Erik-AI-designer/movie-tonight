// The movie catalogue. Edit this file to add or change movies.
//
// NOTE: which service has which movie changes often and differs by country.
// The `services` below are examples — check them for your country before going public.

export const MOODS = {
  cozy: "уютное",
  funny: "посмеяться",
  thrilling: "пощекотать нервы",
  thoughtful: "подумать",
  romantic: "романтика",
  epic: "большое приключение",
};

// Moods that count as "light" vs "deep" for the onboarding question "what do you usually like?"
export const LIGHT_MOODS = ["cozy", "funny", "romantic"];
export const DEEP_MOODS = ["thoughtful", "thrilling", "epic"];

export const DURATIONS = {
  short: { label: "до 1 ч 45 мин", max: 105 },
  normal: { label: "до 2 ч 15 мин", max: 135 },
  long: { label: "сколько угодно", max: Infinity },
};

export const GENRES = {
  comedy: "комедия",
  drama: "драма",
  scifi: "фантастика",
  thriller: "триллер",
  horror: "ужасы",
  romance: "мелодрама",
  animation: "мультфильм",
  adventure: "приключения",
  action: "боевик",
  mystery: "детектив",
  family: "семейное",
};

// Where the "watch" button sends people.
// In `url`, {q} is replaced by the original (English) title and {ru} by the Russian title.
// `group` decides under which heading the service is shown in the questions.
// `rental: true` means you can rent almost any movie there, so it matches every movie
// except those marked `noRental` (e.g. Netflix/Apple originals, Studio Ghibli).
// `tagVar` names a variable in wrangler.jsonc whose value is added as an affiliate tag.
export const SERVICES = {
  netflix: { name: "Netflix", group: "sub", url: "https://www.netflix.com/search?q={q}" },
  prime: {
    name: "Prime Video",
    group: "sub",
    url: "https://www.amazon.com/s?k={q}&i=instant-video",
    tagVar: "AMAZON_TAG",
    tagParam: "tag",
  },
  disney: { name: "Disney+", group: "sub", url: "https://www.disneyplus.com/" },
  apple: { name: "Apple TV+", group: "sub", url: "https://tv.apple.com/search?term={q}" },
  hbo: { name: "HBO Max", group: "sub", url: "https://www.hbomax.com/" },
  skyshowtime: { name: "SkyShowtime", group: "sub", url: "https://www.skyshowtime.com/" },
  viaplay: { name: "Viaplay", group: "sub", url: "https://viaplay.com/" },
  paramount: { name: "Paramount+", group: "sub", url: "https://www.paramountplus.com/" },
  mubi: { name: "MUBI", group: "sub", url: "https://mubi.com/" },
  crunchyroll: { name: "Crunchyroll", group: "sub", url: "https://www.crunchyroll.com/search?q={q}" },

  go3: { name: "Go3", group: "ee", url: "https://go3.tv/" },
  elisa: { name: "Elisa Elamus", group: "ee", url: "https://elisaelamus.ee/" },
  telia: { name: "Telia TV", group: "ee", url: "https://www.telia.ee/" },
  jupiter: { name: "ERR Jupiter", group: "ee", url: "https://jupiter.err.ee/" },

  kinopoisk: { name: "Кинопоиск", group: "ru", url: "https://www.kinopoisk.ru/index.php?kp_query={ru}" },
  okko: { name: "Okko", group: "ru", url: "https://okko.tv/" },
  ivi: { name: "Иви", group: "ru", url: "https://www.ivi.ru/" },
  start: { name: "Start", group: "ru", url: "https://start.ru/" },
  premier: { name: "Premier", group: "ru", url: "https://premier.one/" },
  wink: { name: "Wink", group: "ru", url: "https://wink.ru/" },
  kion: { name: "KION", group: "ru", url: "https://kion.ru/" },
  amediateka: { name: "Амедиатека", group: "ru", url: "https://www.amediateka.ru/" },

  apple_rent: { name: "Apple TV (аренда)", group: "rent", rental: true, url: "https://tv.apple.com/search?term={q}" },
  google: { name: "Google TV / YouTube", group: "rent", rental: true, url: "https://www.youtube.com/results?search_query={q}+movie" },
};

// minAge: 0 = for everyone, 12, 16, 18. Runtime in minutes.
// `services` are examples — availability changes often and differs by country.
export const MOVIES = [
  { id: "grand-budapest", title: "Отель «Гранд Будапешт»", original: "The Grand Budapest Hotel", year: 2014, runtime: 99, minAge: 12, genres: ["comedy", "adventure"], moods: ["funny", "cozy"], services: ["disney", "kinopoisk", "okko"] },
  { id: "paddington-2", title: "Приключения Паддингтона 2", original: "Paddington 2", year: 2017, runtime: 104, minAge: 0, genres: ["family", "comedy"], moods: ["cozy", "funny"], services: ["netflix", "prime", "okko", "ivi", "go3", "jupiter"] },
  { id: "spirited-away", title: "Унесённые призраками", original: "Spirited Away", year: 2001, runtime: 125, minAge: 0, genres: ["animation", "adventure"], moods: ["cozy", "epic"], services: ["netflix", "hbo"], noRental: true },
  { id: "totoro", title: "Мой сосед Тоторо", original: "My Neighbor Totoro", year: 1988, runtime: 86, minAge: 0, genres: ["animation", "family"], moods: ["cozy"], services: ["netflix", "hbo"], noRental: true },
  { id: "knives-out", title: "Достать ножи", original: "Knives Out", year: 2019, runtime: 130, minAge: 12, genres: ["mystery", "comedy"], moods: ["thrilling", "funny"], services: ["prime", "kinopoisk", "wink", "go3", "elisa", "viaplay"] },
  { id: "glass-onion", title: "Достать ножи: Стеклянная луковица", original: "Glass Onion", year: 2022, runtime: 139, minAge: 12, genres: ["mystery", "comedy"], moods: ["funny", "thrilling"], services: ["netflix"], noRental: true },
  { id: "inception", title: "Начало", original: "Inception", year: 2010, runtime: 148, minAge: 12, genres: ["scifi", "thriller", "action"], moods: ["thrilling", "thoughtful"], services: ["netflix", "hbo", "kinopoisk", "okko", "wink"] },
  { id: "interstellar", title: "Интерстеллар", original: "Interstellar", year: 2014, runtime: 169, minAge: 12, genres: ["scifi", "drama"], moods: ["thoughtful", "epic"], services: ["prime", "kinopoisk", "okko", "ivi", "paramount", "skyshowtime"] },
  { id: "arrival", title: "Прибытие", original: "Arrival", year: 2016, runtime: 116, minAge: 12, genres: ["scifi", "drama"], moods: ["thoughtful"], services: ["prime", "netflix", "kinopoisk", "start"] },
  { id: "get-out", title: "Прочь", original: "Get Out", year: 2017, runtime: 104, minAge: 16, genres: ["horror", "thriller"], moods: ["thrilling"], services: ["prime", "okko", "skyshowtime"] },
  { id: "quiet-place", title: "Тихое место", original: "A Quiet Place", year: 2018, runtime: 90, minAge: 16, genres: ["horror", "scifi"], moods: ["thrilling"], services: ["prime", "netflix", "paramount", "skyshowtime"] },
  { id: "la-la-land", title: "Ла-Ла Ленд", original: "La La Land", year: 2016, runtime: 128, minAge: 12, genres: ["romance", "drama"], moods: ["romantic"], services: ["netflix", "prime", "kinopoisk", "okko", "elisa"] },
  { id: "about-time", title: "Бойфренд из будущего", original: "About Time", year: 2013, runtime: 123, minAge: 12, genres: ["romance", "comedy"], moods: ["romantic", "cozy"], services: ["netflix", "prime", "kinopoisk", "ivi", "viaplay", "skyshowtime"] },
  { id: "mad-max", title: "Безумный Макс: Дорога ярости", original: "Mad Max: Fury Road", year: 2015, runtime: 120, minAge: 16, genres: ["action", "adventure"], moods: ["epic", "thrilling"], services: ["hbo", "kinopoisk", "wink", "telia", "amediateka"] },
  { id: "dune", title: "Дюна", original: "Dune", year: 2021, runtime: 155, minAge: 12, genres: ["scifi", "adventure"], moods: ["epic"], services: ["hbo", "netflix", "kinopoisk", "okko", "go3"] },
  { id: "eeaao", title: "Всё везде и сразу", original: "Everything Everywhere All at Once", year: 2022, runtime: 139, minAge: 16, genres: ["scifi", "comedy", "action"], moods: ["funny", "thoughtful"], services: ["prime", "mubi"] },
  { id: "martian", title: "Марсианин", original: "The Martian", year: 2015, runtime: 144, minAge: 12, genres: ["scifi", "adventure"], moods: ["epic", "funny"], services: ["disney", "kinopoisk", "kion", "telia"] },
  { id: "soul", title: "Душа", original: "Soul", year: 2020, runtime: 100, minAge: 0, genres: ["animation", "family"], moods: ["thoughtful", "cozy"], services: ["disney"] },
  { id: "coco", title: "Тайна Коко", original: "Coco", year: 2017, runtime: 105, minAge: 0, genres: ["animation", "family"], moods: ["cozy"], services: ["disney", "kinopoisk"] },
  { id: "spider-verse", title: "Человек-паук: Через вселенные", original: "Spider-Man: Into the Spider-Verse", year: 2018, runtime: 117, minAge: 0, genres: ["animation", "action"], moods: ["epic", "funny"], services: ["netflix"] },
  { id: "parasite", title: "Паразиты", original: "Parasite", year: 2019, runtime: 132, minAge: 16, genres: ["thriller", "drama"], moods: ["thrilling", "thoughtful"], services: ["hbo", "prime", "kinopoisk", "premier", "elisa", "mubi"] },
  { id: "prisoners", title: "Пленницы", original: "Prisoners", year: 2013, runtime: 153, minAge: 16, genres: ["thriller", "mystery"], moods: ["thrilling"], services: ["netflix", "hbo", "kinopoisk", "start"] },
  { id: "intouchables", title: "1+1", original: "The Intouchables", year: 2011, runtime: 112, minAge: 12, genres: ["comedy", "drama"], moods: ["cozy", "thoughtful"], services: ["netflix", "prime", "kinopoisk", "okko", "ivi", "premier", "elisa", "telia", "jupiter"] },
  { id: "wilderpeople", title: "Охота на дикарей", original: "Hunt for the Wilderpeople", year: 2016, runtime: 101, minAge: 12, genres: ["comedy", "adventure"], moods: ["funny", "cozy"], services: ["prime", "start"] },
  { id: "palm-springs", title: "Палм-Спрингс", original: "Palm Springs", year: 2020, runtime: 90, minAge: 16, genres: ["romance", "comedy", "scifi"], moods: ["funny", "romantic"], services: ["hbo", "prime", "amediateka"] },
  { id: "edge-of-tomorrow", title: "Грань будущего", original: "Edge of Tomorrow", year: 2014, runtime: 113, minAge: 12, genres: ["scifi", "action"], moods: ["thrilling", "epic"], services: ["hbo", "netflix", "kinopoisk", "wink", "go3"] },
  { id: "ford-ferrari", title: "Ford против Ferrari", original: "Ford v Ferrari", year: 2019, runtime: 152, minAge: 12, genres: ["drama", "action"], moods: ["epic"], services: ["disney", "kinopoisk", "kion"] },
  { id: "klaus", title: "Клаус", original: "Klaus", year: 2019, runtime: 96, minAge: 0, genres: ["animation", "family", "comedy"], moods: ["cozy", "funny"], services: ["netflix"], noRental: true },
  { id: "mitchells", title: "Митчеллы против машин", original: "The Mitchells vs. the Machines", year: 2021, runtime: 113, minAge: 0, genres: ["animation", "comedy", "family"], moods: ["funny"], services: ["netflix"], noRental: true },
  { id: "coda", title: "CODA: Ребёнок глухих родителей", original: "CODA", year: 2021, runtime: 111, minAge: 12, genres: ["drama", "family"], moods: ["thoughtful", "cozy"], services: ["apple"], noRental: true },
  { id: "wolfwalkers", title: "Легенда о волках", original: "Wolfwalkers", year: 2020, runtime: 103, minAge: 0, genres: ["animation", "adventure"], moods: ["cozy", "epic"], services: ["apple"], noRental: true },
  { id: "greyhound", title: "Грейхаунд", original: "Greyhound", year: 2020, runtime: 91, minAge: 12, genres: ["action", "drama"], moods: ["thrilling", "epic"], services: ["apple"], noRental: true },

  // Russian-language films: `original` is the Russian title, so searches work on Russian services.
  { id: "going-vertical", title: "Движение вверх", original: "Движение вверх", year: 2017, runtime: 133, minAge: 6, genres: ["drama", "adventure"], moods: ["epic", "thoughtful"], services: ["kinopoisk", "okko", "ivi", "start", "wink", "kion"] },
  { id: "kholop", title: "Холоп", original: "Холоп", year: 2019, runtime: 109, minAge: 16, genres: ["comedy"], moods: ["funny"], services: ["kinopoisk", "okko", "start", "wink", "premier"] },
  { id: "cheburashka", title: "Чебурашка", original: "Чебурашка", year: 2022, runtime: 113, minAge: 6, genres: ["family", "comedy"], moods: ["cozy", "funny"], services: ["kinopoisk", "okko", "wink", "kion"] },
  { id: "yolki", title: "Ёлки", original: "Ёлки", year: 2010, runtime: 90, minAge: 6, genres: ["comedy", "family"], moods: ["cozy", "funny"], services: ["kinopoisk", "ivi", "start", "wink", "premier"] },
  { id: "legend-17", title: "Легенда №17", original: "Легенда №17", year: 2013, runtime: 134, minAge: 12, genres: ["drama", "action"], moods: ["epic"], services: ["kinopoisk", "okko", "ivi", "kion"] },
  { id: "major-grom", title: "Майор Гром: Чумной Доктор", original: "Майор Гром: Чумной Доктор", year: 2021, runtime: 137, minAge: 16, genres: ["action", "thriller"], moods: ["thrilling", "epic"], services: ["kinopoisk", "okko", "start", "wink"] },

  // Estonian films.
  { id: "seltsimees-laps", title: "Товарищ ребёнок", original: "Seltsimees laps", year: 2018, runtime: 99, minAge: 12, genres: ["drama", "family"], moods: ["thoughtful"], services: ["jupiter", "go3", "elisa"] },
  { id: "kevade", title: "Весна", original: "Kevade", year: 1969, runtime: 84, minAge: 0, genres: ["comedy", "drama"], moods: ["cozy", "thoughtful"], services: ["jupiter"], noRental: true },
];
