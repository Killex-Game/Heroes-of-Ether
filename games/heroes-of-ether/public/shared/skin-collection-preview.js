/* Shared permanent avatar collections and authoritative base prices. */
(function (root) {
  const comparePrice = (a, b) =>
    ["coins", "crystals", "bucks"].indexOf(a.currency) -
      ["coins", "crystals", "bucks"].indexOf(b.currency) || a.price - b.price;
  const collections = [
    {"id":"army","name":"Защитники","currency":"coins","price":2500,"members":[{"id":"army-commander","name":"Командир"},{"id":"army-sapper","name":"Сапёр"},{"id":"army-scout","name":"Разведчица"},{"id":"army-scout-falcon","name":"Сокол-разведчик"},{"id":"army-service-dog","name":"Служебная овчарка"}]},
    {"id":"hospital","name":"Весёлая больница","currency":"crystals","price":250,"members":[{"id":"hospital-chief-doctor","name":"Главврач"},{"id":"hospital-helper-cat","name":"Кот-помощник"},{"id":"hospital-nurse","name":"Медсестра"},{"id":"hospital-paramedic","name":"Фельдшер"},{"id":"hospital-surgeon","name":"Хирург"}]},
    {"id":"norse","name":"Скандинавия","currency":"bucks","price":200,"members":[{"id":"norse-freyja","name":"Фрейя"},{"id":"norse-hugin","name":"Хугин, ворон Одина"},{"id":"norse-loki","name":"Локи"},{"id":"norse-odin","name":"Один"},{"id":"norse-thor","name":"Тор"}]},
    {
      id: "forest",
      name: "Лесные тропы",
      members: [
        {
          id: "forest-fox",
          name: "Лиса-проводница",
        },
        {
          id: "forest-owl",
          name: "Лесная сова",
        },
        {
          id: "forest-badger",
          name: "Лесничий",
        },
        {
          id: "forest-deer",
          name: "Хранительница рощи",
        },
        {
          id: "forest-squirrel",
          name: "Лесной картограф",
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
          name: "Морской штурман",
        },
        {
          id: "sea-octopus",
          name: "Морская алхимичка",
        },
        {
          id: "sea-seahorse",
          name: "Хранительница приливов",
        },
        {
          id: "sea-turtle",
          name: "Черепаха-летописец",
        },
        {
          id: "sea-otter",
          name: "Морская выдра",
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
          name: "Небесный грифон",
        },
        {
          id: "cloud-pegasus",
          name: "Небесная посланница",
        },
        {
          id: "cloud-ibex",
          name: "Проводник вершин",
        },
        {
          id: "cloud-whale",
          name: "Облачный кит",
        },
        {
          id: "cloud-lynx",
          name: "Провидица облаков",
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
          name: "Снежная лисица",
        },
        {
          id: "snow-hare",
          name: "Целительница снегов",
        },
        {
          id: "snow-bear",
          name: "Страж перевала",
        },
        {
          id: "snow-walrus",
          name: "Северный штурман",
        },
        {
          id: "snow-ermine",
          name: "Горностай-картограф",
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
          name: "Фенек-путешественник",
        },
        {
          id: "desert-cat",
          name: "Караванщик",
        },
        {
          id: "desert-gazelle",
          name: "Газель оазиса",
        },
        {
          id: "desert-beetle",
          name: "Хранительница скарабея",
        },
        {
          id: "desert-jackal",
          name: "Следопыт барханов",
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
          name: "Енот-мастер",
        },
        {
          id: "workshop-hedgehog",
          name: "Часовщик",
        },
        {
          id: "workshop-beaver",
          name: "Мастер-плотник",
        },
        {
          id: "workshop-mole",
          name: "Ювелир",
        },
        {
          id: "workshop-robin",
          name: "Белка-ремесленница",
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
          name: "Лунный мотылёк",
        },
        {
          id: "twilight-frog",
          name: "Сумеречный чародей",
        },
        {
          id: "twilight-gecko",
          name: "Сумеречный дозорный",
        },
        {
          id: "twilight-bat",
          name: "Сумеречная летучая мышь",
        },
        {
          id: "twilight-panda",
          name: "Сумеречная травница",
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
          name: "Заклинательница пламени",
        },
        {
          id: "flame-ferret",
          name: "Разведчик углей",
        },
        {
          id: "flame-ram",
          name: "Мастер горна",
        },
        {
          id: "flame-dragon",
          name: "Огненный дракон",
        },
        {
          id: "flame-marten",
          name: "Куница углей",
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
          name: "Хранитель дубравы",
        },
        {
          id: "grove-dryad",
          name: "Травница рощи",
        },
        {
          id: "grove-faun",
          name: "Лесной следопыт",
        },
        {
          id: "grove-spirit",
          name: "Собирательница грибов",
        },
        {
          id: "grove-hedgehog",
          name: "Ёж-хранитель",
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
          name: "Звёздный мудрец",
        },
        {
          id: "stars-koi",
          name: "Звёздная астрологиня",
        },
        {
          id: "stars-raven",
          name: "Звёздный ворон",
        },
        {
          id: "stars-dolphin",
          name: "Лунная навигаторша",
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
