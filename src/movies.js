// The movie catalogue. Edit this file to add or change movies.
// NOTE: which service has which movie changes often and differs by country — check before going public.

export const MOODS = {
  cozy: "уютное",
  funny: "посмеяться",
  thrilling: "пощекотать нервы",
  thoughtful: "подумать",
  romantic: "романтика",
  epic: "большое приключение",
};

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

// Where the "watch" button sends people. `{q}` is replaced by the movie title.
// `tagVar` names a variable in wrangler.jsonc whose value is added as an affiliate tag.
export const SERVICES = {
  netflix: { name: "Netflix", url: "https://www.netflix.com/search?q={q}" },
  prime: {
    name: "Prime Video",
    url: "https://www.amazon.com/s?k={q}&i=instant-video",
    tagVar: "AMAZON_TAG",
    tagParam: "tag",
  },
  disney: { name: "Disney+", url: "https://www.disneyplus.com/" },
  apple: { name: "Apple TV+", url: "https://tv.apple.com/search?term={q}" },
  hbo: { name: "HBO Max", url: "https://www.hbomax.com/" },
};

// minAge: 0 = for everyone, 12, 16, 18. Runtime in minutes.
export const MOVIES = [
  { id: "grand-budapest", title: "Отель «Гранд Будапешт»", original: "The Grand Budapest Hotel", year: 2014, runtime: 99, minAge: 12, genres: ["comedy", "adventure"], moods: ["funny", "cozy"], services: ["disney"] },
  { id: "paddington-2", title: "Приключения Паддингтона 2", original: "Paddington 2", year: 2017, runtime: 104, minAge: 0, genres: ["family", "comedy"], moods: ["cozy", "funny"], services: ["netflix", "prime"] },
  { id: "spirited-away", title: "Унесённые призраками", original: "Spirited Away", year: 2001, runtime: 125, minAge: 0, genres: ["animation", "adventure"], moods: ["cozy", "epic"], services: ["netflix", "hbo"] },
  { id: "totoro", title: "Мой сосед Тоторо", original: "My Neighbor Totoro", year: 1988, runtime: 86, minAge: 0, genres: ["animation", "family"], moods: ["cozy"], services: ["netflix", "hbo"] },
  { id: "knives-out", title: "Достать ножи", original: "Knives Out", year: 2019, runtime: 130, minAge: 12, genres: ["mystery", "comedy"], moods: ["thrilling", "funny"], services: ["prime"] },
  { id: "glass-onion", title: "Достать ножи: Стеклянная луковица", original: "Glass Onion", year: 2022, runtime: 139, minAge: 12, genres: ["mystery", "comedy"], moods: ["funny", "thrilling"], services: ["netflix"] },
  { id: "inception", title: "Начало", original: "Inception", year: 2010, runtime: 148, minAge: 12, genres: ["scifi", "thriller", "action"], moods: ["thrilling", "thoughtful"], services: ["netflix", "hbo"] },
  { id: "interstellar", title: "Интерстеллар", original: "Interstellar", year: 2014, runtime: 169, minAge: 12, genres: ["scifi", "drama"], moods: ["thoughtful", "epic"], services: ["prime"] },
  { id: "arrival", title: "Прибытие", original: "Arrival", year: 2016, runtime: 116, minAge: 12, genres: ["scifi", "drama"], moods: ["thoughtful"], services: ["prime", "netflix"] },
  { id: "get-out", title: "Прочь", original: "Get Out", year: 2017, runtime: 104, minAge: 16, genres: ["horror", "thriller"], moods: ["thrilling"], services: ["prime"] },
  { id: "quiet-place", title: "Тихое место", original: "A Quiet Place", year: 2018, runtime: 90, minAge: 16, genres: ["horror", "scifi"], moods: ["thrilling"], services: ["prime", "netflix"] },
  { id: "la-la-land", title: "Ла-Ла Ленд", original: "La La Land", year: 2016, runtime: 128, minAge: 12, genres: ["romance", "drama"], moods: ["romantic"], services: ["netflix", "prime"] },
  { id: "about-time", title: "Бойфренд из будущего", original: "About Time", year: 2013, runtime: 123, minAge: 12, genres: ["romance", "comedy"], moods: ["romantic", "cozy"], services: ["netflix", "prime"] },
  { id: "mad-max", title: "Безумный Макс: Дорога ярости", original: "Mad Max: Fury Road", year: 2015, runtime: 120, minAge: 16, genres: ["action", "adventure"], moods: ["epic", "thrilling"], services: ["hbo"] },
  { id: "dune", title: "Дюна", original: "Dune", year: 2021, runtime: 155, minAge: 12, genres: ["scifi", "adventure"], moods: ["epic"], services: ["hbo", "netflix"] },
  { id: "eeaao", title: "Всё везде и сразу", original: "Everything Everywhere All at Once", year: 2022, runtime: 139, minAge: 16, genres: ["scifi", "comedy", "action"], moods: ["funny", "thoughtful"], services: ["prime"] },
  { id: "martian", title: "Марсианин", original: "The Martian", year: 2015, runtime: 144, minAge: 12, genres: ["scifi", "adventure"], moods: ["epic", "funny"], services: ["disney"] },
  { id: "soul", title: "Душа", original: "Soul", year: 2020, runtime: 100, minAge: 0, genres: ["animation", "family"], moods: ["thoughtful", "cozy"], services: ["disney"] },
  { id: "coco", title: "Тайна Коко", original: "Coco", year: 2017, runtime: 105, minAge: 0, genres: ["animation", "family"], moods: ["cozy"], services: ["disney"] },
  { id: "spider-verse", title: "Человек-паук: Через вселенные", original: "Spider-Man: Into the Spider-Verse", year: 2018, runtime: 117, minAge: 0, genres: ["animation", "action"], moods: ["epic", "funny"], services: ["netflix"] },
  { id: "parasite", title: "Паразиты", original: "Parasite", year: 2019, runtime: 132, minAge: 16, genres: ["thriller", "drama"], moods: ["thrilling", "thoughtful"], services: ["hbo", "prime"] },
  { id: "prisoners", title: "Пленницы", original: "Prisoners", year: 2013, runtime: 153, minAge: 16, genres: ["thriller", "mystery"], moods: ["thrilling"], services: ["netflix", "hbo"] },
  { id: "intouchables", title: "1+1", original: "The Intouchables", year: 2011, runtime: 112, minAge: 12, genres: ["comedy", "drama"], moods: ["cozy", "thoughtful"], services: ["netflix", "prime"] },
  { id: "wilderpeople", title: "Охота на дикарей", original: "Hunt for the Wilderpeople", year: 2016, runtime: 101, minAge: 12, genres: ["comedy", "adventure"], moods: ["funny", "cozy"], services: ["prime"] },
  { id: "palm-springs", title: "Палм-Спрингс", original: "Palm Springs", year: 2020, runtime: 90, minAge: 16, genres: ["romance", "comedy", "scifi"], moods: ["funny", "romantic"], services: ["hbo", "prime"] },
  { id: "edge-of-tomorrow", title: "Грань будущего", original: "Edge of Tomorrow", year: 2014, runtime: 113, minAge: 12, genres: ["scifi", "action"], moods: ["thrilling", "epic"], services: ["hbo", "netflix"] },
  { id: "ford-ferrari", title: "Ford против Ferrari", original: "Ford v Ferrari", year: 2019, runtime: 152, minAge: 12, genres: ["drama", "action"], moods: ["epic"], services: ["disney"] },
  { id: "klaus", title: "Клаус", original: "Klaus", year: 2019, runtime: 96, minAge: 0, genres: ["animation", "family", "comedy"], moods: ["cozy", "funny"], services: ["netflix"] },
  { id: "mitchells", title: "Митчеллы против машин", original: "The Mitchells vs. the Machines", year: 2021, runtime: 113, minAge: 0, genres: ["animation", "comedy", "family"], moods: ["funny"], services: ["netflix"] },
  { id: "coda", title: "CODA: Ребёнок глухих родителей", original: "CODA", year: 2021, runtime: 111, minAge: 12, genres: ["drama", "family"], moods: ["thoughtful", "cozy"], services: ["apple"] },
  { id: "wolfwalkers", title: "Легенда о волках", original: "Wolfwalkers", year: 2020, runtime: 103, minAge: 0, genres: ["animation", "adventure"], moods: ["cozy", "epic"], services: ["apple"] },
  { id: "greyhound", title: "Грейхаунд", original: "Greyhound", year: 2020, runtime: 91, minAge: 12, genres: ["action", "drama"], moods: ["thrilling", "epic"], services: ["apple"] },
];
