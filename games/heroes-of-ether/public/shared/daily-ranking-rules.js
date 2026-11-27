/* Общие правила призов и регалий суточных рейтингов. */
"use strict";
((root, factory) => {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else root.KillexDailyRankings = rules;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const boards = Object.freeze([
    Object.freeze({
      id: "dailyKills",
      metric: "kills",
      name: "Киллы за день",
      medal: "kills",
      title: "Гроза арены",
    }),
    Object.freeze({
      id: "dailyTime",
      metric: "arenaSeconds",
      name: "Время за день",
      medal: "time",
      title: "Страж времени",
    }),
    Object.freeze({
      id: "dailyGreatness",
      metric: "greatness",
      name: "Величие за день",
      medal: "greatness",
      title: "Сияние величия",
    }),
    Object.freeze({
      id: "dailyGifts",
      metric: "giftsSent",
      name: "Подарки за день",
      medal: "gifts",
      medalArt: "kills",
      title: "Щедрое сердце",
    }),
  ]);
  const prizes = Object.freeze([
    Object.freeze({ greatness: 3, coins: 100, crystals: 10 }),
    Object.freeze({ greatness: 2, coins: 70, crystals: 7 }),
    Object.freeze({ greatness: 1, coins: 50, crystals: 5 }),
  ]);
  const eventTickets = Object.freeze([3, 2, 1]);
  const medals = Object.freeze(
    boards.flatMap((board) =>
      prizes.map((prize, index) =>
        Object.freeze({
          id: board.medal + "-" + (index + 1),
          board: board.id,
          place: index + 1,
          name: board.title + " - " + (index + 1) + " место",
          description:
            "За " + (index + 1) + " место в рейтинге «" + board.name + "» по итогам дня.",
          image: "assets/regalia/daily/" +
            (board.medal === "greatness" && index > 0 ? "canonical-star-v2/" : "") +
            (board.medalArt || board.medal) + "-" + (index + 1) + ".webp?art=20261123-interface-art",
          prize,
        }),
      ),
    ),
  );
  const prizeText = (prize) =>
    `+${prize.greatness} величия, ${prize.coins} монет, ${prize.crystals} кристаллов`;
  return Object.freeze({ boards, prizes, eventTickets, medals, prizeText });
});
