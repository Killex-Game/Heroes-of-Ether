/* Shared permanent avatar collections and authoritative base prices. */
(function (root) {
  const comparePrice = (a, b) =>
    ["coins", "crystals", "bucks"].indexOf(a.currency) -
      ["coins", "crystals", "bucks"].indexOf(b.currency) || a.price - b.price;
  const collections = [
    {
      id: "forest",
      name: "Лесные тропы",
      members: [
        {
          id: "forest-fox",
          name: "Лис-картограф",
        },
        {
          id: "forest-owl",
          name: "Сова-травница",
        },
        {
          id: "forest-badger",
          name: "Барсук-следопыт",
        },
        {
          id: "forest-deer",
          name: "Олень-вестник",
        },
        {
          id: "forest-squirrel",
          name: "Белка-мастерица",
        },
      ],
      currency: "coins",
      price: 3500,
    },
    {
      id: "sea",
      name: "Морские легенды",
      members: [
        {
          id: "sea-seal",
          name: "Тюлень-штурман",
        },
        {
          id: "sea-octopus",
          name: "Осьминог-алхимик",
        },
        {
          id: "sea-seahorse",
          name: "Морской конёк",
        },
        {
          id: "sea-turtle",
          name: "Черепаха-сказитель",
        },
        {
          id: "sea-otter",
          name: "Выдра-жемчужница",
        },
      ],
      currency: "coins",
      price: 3500,
    },
    {
      id: "cloud",
      name: "Облачные странники",
      members: [
        {
          id: "cloud-griffin",
          name: "Грифон-почтальон",
        },
        {
          id: "cloud-pegasus",
          name: "Пегас рассвета",
        },
        {
          id: "cloud-ibex",
          name: "Серна ветров",
        },
        {
          id: "cloud-whale",
          name: "Небесный кит",
        },
        {
          id: "cloud-lynx",
          name: "Облачная рысь",
        },
      ],
      currency: "crystals",
      price: 500,
    },
    {
      id: "snow",
      name: "Снежные сказки",
      members: [
        {
          id: "snow-fox",
          name: "Полярный лис",
        },
        {
          id: "snow-hare",
          name: "Снежный заяц",
        },
        {
          id: "snow-bear",
          name: "Медвежонок севера",
        },
        {
          id: "snow-walrus",
          name: "Морж-хранитель",
        },
        {
          id: "snow-ermine",
          name: "Горностай",
        },
      ],
      currency: "crystals",
      price: 1000,
    },
    {
      id: "desert",
      name: "Пески рассвета",
      members: [
        {
          id: "desert-fennec",
          name: "Фенек-проводник",
        },
        {
          id: "desert-cat",
          name: "Барханный кот",
        },
        {
          id: "desert-gazelle",
          name: "Газель рассвета",
        },
        {
          id: "desert-beetle",
          name: "Скарабей-хранитель",
        },
        {
          id: "desert-jackal",
          name: "Шакал-искатель",
        },
      ],
      currency: "coins",
      price: 5000,
    },
    {
      id: "workshop",
      name: "Мастерская чудес",
      members: [
        {
          id: "workshop-raccoon",
          name: "Енот-механик",
        },
        {
          id: "workshop-hedgehog",
          name: "Ёж-часовщик",
        },
        {
          id: "workshop-beaver",
          name: "Бобр-изобретатель",
        },
        {
          id: "workshop-mole",
          name: "Крот-ювелир",
        },
        {
          id: "workshop-robin",
          name: "Малиновка-летописец",
        },
      ],
      currency: "coins",
      price: 3000,
    },
    {
      id: "twilight",
      name: "Сумеречный сад",
      members: [
        {
          id: "twilight-moth",
          name: "Лунная моль",
        },
        {
          id: "twilight-frog",
          name: "Лягушонок-маг",
        },
        {
          id: "twilight-gecko",
          name: "Геккон-светлячок",
        },
        {
          id: "twilight-bat",
          name: "Летучая мышь",
        },
        {
          id: "twilight-panda",
          name: "Красная панда",
        },
      ],
      currency: "crystals",
      price: 750,
    },
    {
      id: "flame",
      name: "Хранители искры",
      members: [
        {
          id: "flame-salamander",
          name: "Саламандра",
        },
        {
          id: "flame-ferret",
          name: "Огненный хорёк",
        },
        {
          id: "flame-ram",
          name: "Баран искр",
        },
        {
          id: "flame-dragon",
          name: "Медный дракон",
        },
        {
          id: "flame-marten",
          name: "Куница очага",
        },
      ],
      currency: "bucks",
      price: 500,
    },
    {
      id: "grove",
      name: "Стражи рощи",
      members: [
        {
          id: "grove-ent",
          name: "Дубовичок",
        },
        {
          id: "grove-dryad",
          name: "Цветочная дриада",
        },
        {
          id: "grove-faun",
          name: "Лесной фавн",
        },
        {
          id: "grove-spirit",
          name: "Грибной дух",
        },
        {
          id: "grove-hedgehog",
          name: "Вересковый ёж",
        },
      ],
      currency: "bucks",
      price: 500,
    },
    {
      id: "stars",
      name: "Звёздные хранители",
      members: [
        {
          id: "stars-lynx",
          name: "Звёздная рысь",
        },
        {
          id: "stars-ram",
          name: "Созвездие Овна",
        },
        {
          id: "stars-koi",
          name: "Кометный карп",
        },
        {
          id: "stars-raven",
          name: "Ворон туманности",
        },
        {
          id: "stars-dolphin",
          name: "Лунный дельфин",
        },
      ],
      currency: "bucks",
      price: 750,
    },
  ]
    .sort(comparePrice)
    .map((c) => Object.freeze({ ...c, members: Object.freeze(c.members.map(Object.freeze)) }));
  const api = Object.freeze({
    collections: Object.freeze(collections),
    comparePrice,
    get: (id) => collections.find((c) => c.id === id),
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexSkinCollections = api;
})(typeof window === "object" ? window : globalThis);
