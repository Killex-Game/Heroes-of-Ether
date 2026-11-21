"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");

const { findRunAt } = require("./event-run-lookup");
const { randomInt, randomUUID } = require("node:crypto");
const rules = require("../../../public/shared/easter-rules");
const { BoosterError } = require("../boosters/booster-catalog");
const stages = require("../progression/achievement-stages");
const treasury = require("../progression/treasury-capacity");
const bonuses = require("../progression/chest-bonuses");
const DAY = 86400000,
  MSK = 10800000;
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const add = (a, b) => {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw new BoosterError("Достигнут предел счётчика.", 409);
  return a + b;
};
const manifest = {
  schemaVersion: 1,
  id: "easter-hunt",
  title: "Пасхальная охота",
  description:
    "Собирай яйца на аренах, открывай сундуки со случайными фрагментами золотой коллекции. Вместе с охотой проходит Удачная неделя.",
  durationMinutes: 10080,
  contentPack: "easter-hunt-v1",
  features: { roulette: true, lite: true },
};
function runAt(manager, at) {
  return findRunAt(manager, at, manifest.contentPack);
}
function state(p, runId) {
  p.easter ||= { runs: {}, chests: [], batches: [], trophies: [] };
  return (p.easter.runs[runId] ||= {
    eggs: [0, 0, 0, 0],
    found: [0, 0, 0, 0],
    fragments: 0,
    exchanges: 0,
    chests: 0,
    games: 0,
    lives: {},
    claimed: {},
    stageSpent: Object.fromEntries(rules.achievements.map((d) => [d.id, 0])),
  });
}
function values(s) {
  return {
    easter_trail: s.found.reduce((a, b) => a + b, 0),
    easter_colors: Math.min(...s.found),
    easter_hunter: s.found.reduce((a, b) => a + b, 0),
    easter_adventure: s.games,
    easter_find: s.chests,
    easter_collection: completedCollections(s),
    easter_extra: s.exchanges,
  };
}
function award(p, s, definitions = rules.achievements) {
  const totals = values(s);
  stages.ensure(s, rules.achievements, (d) => totals[d.id]);
  for (const d of definitions) {
    let claimed = s.claimed[d.id] || 0;
    while (
      claimed < d.thresholds.length &&
      stages.current(s, d, totals[d.id]) >= d.thresholds[claimed]
    ) {
      stages.consume(s, d);
      p.greatness = add(p.greatness, d.rewards[claimed++]);
      s.claimed[d.id] = claimed;
    }
  }
}
function progress(p, manager, event, at) {
  const activeRun = runAt(manager, at);
  if (event.type === "lifeStarted" && activeRun && typeof event.lifeId === "string") {
    const s = state(p, activeRun.id);
    if (s.life?.id !== event.lifeId) s.life = { id: event.lifeId, eggs: [0, 0, 0, 0] };
  }
  if (event.type === "easterPickup") {
    const run = runAt(manager, at);
    if (
      !run ||
      run.id !== event.runId ||
      !Number.isInteger(event.eggType) ||
      event.eggType < 0 ||
      event.eggType > 3
    )
      return;
    const s = state(p, run.id);
    s.eggs[event.eggType] = add(s.eggs[event.eggType], 1);
    s.found[event.eggType] = add(s.found[event.eggType], 1);
    const day = Math.floor((at + MSK) / DAY);
    s.dailyFound ||= {};
    s.dailyFound[day] = add(s.dailyFound[day] || 0, 1);
    if (event.lifeId && p.progress.session?.id === event.lifeId) {
      if (s.life?.id !== event.lifeId) s.life = { id: event.lifeId, eggs: [0, 0, 0, 0] };
      s.life.eggs[event.eggType] = add(s.life.eggs[event.eggType], 1);
      if (s.multiplierExpiresAt > at) {
        s.life.pendingBonusEggs ||= [0, 0, 0, 0];
        s.life.pendingBonusEggs[event.eggType] = add(s.life.pendingBonusEggs[event.eggType], 2);
      }
    }
    award(p, s);
  }
  if (event.type === "lifeEnded" && typeof event.lifeId === "string") {
    settleLife(p, event.lifeId);
    const duration = event.durationMs ?? event.durationSeconds * 1000;
    if (!integer(duration)) return;
    for (const run of manager?.data.runs || []) {
      if (
        run.manifest.contentPack !== manifest.contentPack ||
        Math.min(at, run.stoppedAt ?? run.endsAt) - Math.max(at - duration, run.startsAt) < 60000
      )
        continue;
      const s = state(p, run.id);
      if (s.lives[event.lifeId]) continue;
      s.lives[event.lifeId] = true;
      s.games = add(s.games, 1);
      award(p, s);
    }
  }
}
// Pickup saves the base egg and the entitlement. Only life completion credits the bonus.
// The entitlement survives multiplier/event expiry and is cleared in the same transaction.
function settleLife(p, lifeId) {
  for (const s of Object.values(p.easter?.runs || {})) {
    if (s.life?.id !== lifeId || !s.life.pendingBonusEggs) continue;
    s.bonusEggs ||= [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const bonus = s.life.pendingBonusEggs[i];
      s.eggs[i] = add(s.eggs[i], bonus);
      s.bonusEggs[i] = add(s.bonusEggs[i], bonus);
      s.life.eggs[i] = add(s.life.eggs[i], bonus);
    }
    s.life.pendingBonusEggs = [0, 0, 0, 0];
  }
}
// Два календарных месяца, затем ближайшая следующая полночь Москвы.
function expiresAt(at) {
  const date = new Date(at + MSK),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 2);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return Math.ceil(date.getTime() / DAY) * DAY - MSK;
}
function count(p, at) {
  return (p.easter?.batches || []).filter((b) => b.expiresAt > at).reduce((n, b) => n + b.count, 0);
}
function expire(p, at) {
  if (!p.easter) return;
  p.easter.batches = p.easter.batches.filter((b) => b.expiresAt > at && b.count > 0);
  p.inventory.easter_egg = count(p, at);
  if (!p.inventory.easter_egg && p.quickSlots)
    p.quickSlots = p.quickSlots.map((id) => (id === "easter_egg" ? null : id));
}
function consume(p, at) {
  expire(p, at);
  const batch = p.easter?.batches
    .slice()
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .find((b) => b.count);
  if (!batch) throw new BoosterError("Срок хранения пасхального бустера закончился.", 409);
  batch.count--;
  p.easter.batches = p.easter.batches.filter((b) => b.count);
}
function capture(p, at) {
  if (!refreshDue(p, at)) return p;
  const next = copyProfile(p);
  expire(next, at);
  const definition = rules.achievements.find((d) => d.id === "easter_collection");
  for (const s of Object.values(next.easter.runs)) award(next, s, [definition]);
  next.revision++;
  return next;
}
function refreshDue(p, at) {
  return (
    !!p.easter &&
    (p.easter.batches.some((b) => b.expiresAt <= at) ||
      Object.values(p.easter.runs).some(
        (s) => completedCollections(s) > (s.claimed.easter_collection || 0),
      ))
  );
}
function fragmentCounts(s) {
  // Первые 12 позиций принадлежат прежнему золотому яйцу; история не сбрасывается.
  return Array.from({ length: rules.fragments }, (_, i) =>
    s?.fragmentCounts ? s.fragmentCounts[i] || 0 : i < (s?.fragments || 0) ? 1 : 0,
  );
}
function completedCollections(s) {
  const counts = fragmentCounts(s);
  return rules.collections.filter((_, index) =>
    counts
      .slice(index * rules.fragmentsPerCollection, (index + 1) * rules.fragmentsPerCollection)
      .every((n) => n > 0),
  ).length;
}
function drawFragment(s, random = randomInt) {
  const counts = fragmentCounts(s),
    owned = [],
    missing = [];
  counts.forEach((n, i) => (n ? owned : missing).push(i));
  if (!missing.length) return random(rules.fragments);
  if (!owned.length) return missing[random(missing.length)];
  // Равномерный шанс повторки минус 5 процентных пунктов. Все новые части равновероятны.
  const duplicateThreshold = Math.max(0, owned.length * 20 - rules.fragments);
  const pool = random(rules.fragments * 20) < duplicateThreshold ? owned : missing;
  return pool[random(pool.length)];
}
function albumPictures(p) {
  const target = rules.fragmentsPerCollection;
  const pictures = rules.collections.map((art) => ({ ...art, progress: 0, target, runId: null }));
  for (const [runId, state] of Object.entries(p.easter?.runs || {})) {
    const counts = fragmentCounts(state);
    pictures.forEach((art, index) => {
      const first = index * target;
      let found = 0;
      for (let i = first; i < first + target; i++) if (counts[i] > 0) found++;
      art.progress = Math.max(art.progress, found);
      if (found === target) art.runId ??= runId;
    });
  }
  return pictures;
}
function album(p, pictures = albumPictures(p)) {
  return pictures
    .filter((art) => art.runId)
    .map(({ id, name, image, runId }) => ({
      id,
      name,
      image,
      event: manifest.title,
      runId,
    }));
}
function spendEggs(s, amount) {
  for (let i = 0; i < amount; i++) {
    const max = Math.max(...s.eggs);
    s.eggs[s.eggs.indexOf(max)]--;
  }
}
function act(p, manager, input, at, random = randomInt) {
  treasury.fill(p, at);
  if (["prepare", "open"].includes(input.action)) {
    const chest = p.easter?.chests.find((c) => c.id === input.chestId);
    if (!chest || !chest.stored) throw new BoosterError("Сундук не найден в Сокровищнице.", 409);
    // Seal once, at opening. Reloads, repeated prepare requests and lost replies
    // must reveal the same fragment, including duplicates.
    if (!chest.prepared && chest.reward.version !== 3) {
      chest.reward.version = 3;
      chest.reward.coins = Math.min(chest.reward.coins, 150);
      chest.reward.boosterCount = 3;
    }
    if (chest.reward.fragmentId === undefined)
      chest.reward.fragmentId = drawFragment(state(p, chest.runId), random);
    // Старый уже показанный состав сохраняется; новый фиксируется перед показом.
    chest.reward.multiplier ??= chest.prepared ? 1 : bonuses.multiplier(p, at);
    if (input.action === "prepare") {
      chest.prepared = true;
      return;
    }
    const reward = bonuses.scale({ ...chest.reward, greatness: 5 }, chest.reward.multiplier);
    for (const currency of ["coins", "crystals"])
      p.wallet[currency] = add(p.wallet[currency], reward[currency]);
    p.greatness = add(p.greatness, reward.greatness);
    const boosterCount = reward.boosterCount ?? 1,
      deadline = expiresAt(at),
      batch = p.easter.batches.find((b) => b.expiresAt === deadline);
    if (batch) batch.count = add(batch.count, boosterCount);
    else p.easter.batches.push({ count: boosterCount, expiresAt: deadline });
    p.inventory.easter_egg = add(p.inventory.easter_egg || 0, boosterCount);
    const collection = state(p, chest.runId);
    collection.fragmentCounts = fragmentCounts(collection);
    collection.fragmentCounts[chest.reward.fragmentId] = add(
      collection.fragmentCounts[chest.reward.fragmentId],
      1,
    );
    collection.fragments = collection.fragmentCounts.filter((n) => n > 0).length;
    if (collection.fragments === rules.fragments) {
      const trophy = p.easter.trophies.find((t) => t.runId === chest.runId);
      if (trophy) trophy.collectionVersion = 2;
      else p.easter.trophies.push({ runId: chest.runId, at, collectionVersion: 2 });
    }
    award(p, collection);
    p.easter.chests = p.easter.chests.filter((c) => c !== chest);
    treasury.fill(p, at);
    return;
  }
  const run = runAt(manager, at);
  if (!run || run.id !== input.runId)
    throw new BoosterError("Этот запуск события уже завершён.", 409);
  const s = state(p, run.id);
  if (input.action === "multiplier") {
    if (s.multiplierExpiresAt > at) return;
    if (p.wallet.bucks < 250) throw new BoosterError("Для множителя нужно 250 эфира.", 409);
    p.wallet.bucks -= 250;
    s.multiplierExpiresAt = add(at, 3 * 60 * 60 * 1000);
    return;
  } else if (input.action === "exchange") {
    if (!rules.eggs.every((_, i) => s.eggs[i] >= rules.eggsPerType))
      throw new BoosterError(
        `Для сундука нужны ${rules.eggsPerChest} яиц - по ${rules.eggsPerType} каждого вида.`,
        409,
      );
    if (p.easter.chests.length >= 1000)
      throw new BoosterError("Сначала открой накопленные пасхальные сундуки.", 409);
    s.eggs = s.eggs.map((count) => count - rules.eggsPerType);
    s.chests = add(s.chests, 1);
    p.easter.chests.push({
      id: "easter-" + randomUUID(),
      runId: run.id,
      at,
      stored: false,
      reward: { version: 3, boosterCount: 3, coins: 100 + random(51), crystals: 10 + random(11) },
    });
    treasury.queue(p, p.easter.chests[p.easter.chests.length - 1], at);
    treasury.fill(p, at);
  } else if (["fragments", "fragments-all"].includes(input.action)) {
    const index = rules.collections.findIndex((c) => c.id === input.collectionId);
    if (index < 0) throw new BoosterError("Неизвестная коллекция.");
    const counts = fragmentCounts(s),
      first = index * rules.fragmentsPerCollection,
      pieces = counts.slice(first, first + rules.fragmentsPerCollection);
    if (pieces.some((n) => n < 1))
      throw new BoosterError("Сначала собери все 12 фрагментов этого изображения.", 409);
    const spare = pieces.findIndex((n) => n === Math.max(...pieces) && n > 1);
    if (spare < 0) throw new BoosterError("У этого изображения нет лишних фрагментов.", 409);
    const amount =
      input.action === "fragments-all" ? pieces.reduce((sum, n) => add(sum, n - 1), 0) : 1;
    const eggs = amount * 10;
    // Check arithmetic before consuming any pieces, including migrated balances.
    add(s.eggs.reduce(add, 0), eggs);
    add((s.exchangedEggs || [0, 0, 0, 0]).reduce(add, 0), eggs);
    if (input.action === "fragments-all")
      counts.fill(1, first, first + rules.fragmentsPerCollection);
    else counts[first + spare]--;
    s.fragmentCounts = counts;
    s.exchangedEggs ||= [0, 0, 0, 0];
    for (let i = 0; i < eggs; i++) {
      const type = random(rules.eggs.length);
      s.eggs[type] = add(s.eggs[type], 1);
      s.exchangedEggs[type] = add(s.exchangedEggs[type], 1);
    }
  } else if (input.action === "ether") {
    if (s.fragments < rules.fragments)
      throw new BoosterError("Сначала собери все четыре коллекции.", 409);
    if (s.eggs.reduce((a, b) => a + b, 0) < 100)
      throw new BoosterError("Для обмена нужно 100 яиц.", 409);
    const day = Math.floor((at + MSK) / DAY);
    p.easter.etherExchangeDays ||= {};
    const used = p.easter.etherExchangeDays[day] || 0;
    if (used >= rules.etherDailyLimit)
      throw new BoosterError("Лимит - 10 обменов в день. Новый лимит в 00:00 по Москве.", 409);
    // Сначала тратятся самые многочисленные виды, сохраняя баланс коллекции.
    spendEggs(s, 100);
    p.wallet.bucks = add(p.wallet.bucks, 5);
    s.exchanges = add(s.exchanges, 1);
    p.easter.etherExchangeDays[day] = used + 1;
  } else throw new BoosterError("Неизвестная операция пасхального события.");
  award(p, s);
}
function mutate(store, token, input) {
  if (input?.action === "notice") {
    if (typeof input.runId !== "string" || input.runId.length > 80)
      throw new BoosterError("Неверное уведомление.");
    return store.transactProfile(
      token,
      input.requestId,
      JSON.stringify(["easter-notice", input.runId]),
      (p) => {
        const trophy = p.easter?.trophies.find(
          (t) => t.runId === input.runId && t.collectionVersion === 2,
        );
        if (!trophy) throw new BoosterError("Награды коллекции ещё не получены.", 409);
        trophy.notifiedAt ??= store.now();
      },
    );
  }
  if (
    !input ||
    !["exchange", "ether", "fragments", "fragments-all", "prepare", "open", "multiplier"].includes(
      input.action,
    ) ||
    (["fragments", "fragments-all"].includes(input.action) &&
      !rules.collections.some((c) => c.id === input.collectionId)) ||
    (input.runId !== undefined && (typeof input.runId !== "string" || input.runId.length > 80)) ||
    (input.chestId !== undefined &&
      (typeof input.chestId !== "string" || input.chestId.length > 100))
  )
    throw new BoosterError("Неверная операция события.");
  return store.chestTransaction(
    token,
    input.requestId,
    JSON.stringify([
      "easter",
      input.action,
      input.runId || null,
      input.chestId || null,
      ...(["fragments", "fragments-all"].includes(input.action) ? [input.collectionId] : []),
    ]),
    (p, at) => act(p, store.events, input, at),
    input.action === "open",
  );
}
function arenaView(p, manager, at) {
  const run = runAt(manager, at);
  return {
    active: !!run,
    runId: run?.id || null,
    endsAt: run?.endsAt || null,
    lifeEggs: (run && p.easter?.runs[run.id]?.life?.eggs) || [0, 0, 0, 0],
  };
}
function view(p, manager, at, config, pictures) {
  const run = runAt(manager, at),
    s = run && p.easter?.runs[run.id];
  return {
    ...arenaView(p, manager, at),
    eggs: s?.eggs || [0, 0, 0, 0],
    etherExchange: {
      used: p.easter?.etherExchangeDays?.[Math.floor((at + MSK) / DAY)] || 0,
      limit: rules.etherDailyLimit,
      resetsAt: (Math.floor((at + MSK) / DAY) + 1) * DAY - MSK,
    },
    multiplier: {
      active: !!run && s?.multiplierExpiresAt > at,
      expiresAt: s?.multiplierExpiresAt || null,
      price: 250,
      durationSeconds: 10800,
    },
    fragments: s?.fragments || 0,
    fragmentCounts: fragmentCounts(s),
    album: album(p, pictures),
    chestContents: bonuses.preview(
      bonuses.scale(
        { coins: [100, 150], crystals: [10, 20], greatness: 5, boosterCount: 3 },
        bonuses.multiplier(p, at),
      ),
      p,
      config,
      at,
    ),
    chests: (p.easter?.chests || [])
      .filter((c) => !treasury.expired(c, at))
      .map((c) => ({
        ...c,
        reward: c.prepared
          ? bonuses.preview(
              {
                id: c.id,
                ...bonuses.scale({ ...c.reward, greatness: 5 }, c.reward.multiplier ?? 1),
                items: { easter_egg: (c.reward.boosterCount ?? 1) * (c.reward.multiplier ?? 1) },
                fragment:
                  c.reward.fragmentId === undefined
                    ? null
                    : {
                        index: c.reward.fragmentId,
                        collectionId: rules.collections[Math.floor(c.reward.fragmentId / 12)].id,
                        duplicate: fragmentCounts(p.easter.runs[c.runId])[c.reward.fragmentId] > 0,
                      },
              },
              p,
              config,
              at,
            )
          : null,
      })),
    batches: (p.easter?.batches || []).filter((b) => b.expiresAt > at).map((b) => ({ ...b })),
    trophies: (p.easter?.trophies || []).map((t) => ({ ...t })),
  };
}
function achievementView(p, manager, at) {
  const run = runAt(manager, at);
  if (!run) return [];
  const s = p.easter?.runs[run.id];
  return rules.achievements.map((d) => ({
    ...d,
    eventRunId: run.id,
    description: "Пасхальная охота. " + d.description,
    value: s ? stages.current(s, d, values(s)[d.id]) : 0,
    claimed: s?.claimed[d.id] || 0,
  }));
}
function validate(p) {
  const e = p.easter;
  if (e === undefined) return;
  if (
    !object(e) ||
    !object(e.runs) ||
    !Array.isArray(e.chests) ||
    !Array.isArray(e.batches) ||
    !Array.isArray(e.trophies)
  )
    throw Error("Повреждены данные Пасхальной охоты.");
  if (
    e.etherExchangeDays !== undefined &&
    (!object(e.etherExchangeDays) ||
      Object.entries(e.etherExchangeDays).some(
        ([day, count]) =>
          !/^\d{1,8}$/.test(day) || !integer(count) || count > rules.etherDailyLimit,
      ))
  )
    throw Error("Повреждён дневной лимит обмена яиц.");
  for (const [id, s] of Object.entries(e.runs)) {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      !object(s) ||
      ![s.eggs, s.found].every((a) => Array.isArray(a) && a.length === 4 && a.every(integer)) ||
      ![s.fragments, s.exchanges, s.games, s.chests].every(integer) ||
      s.fragments > rules.fragments ||
      !object(s.lives) ||
      !object(s.claimed) ||
      (s.exchangedEggs !== undefined &&
        (!Array.isArray(s.exchangedEggs) ||
          s.exchangedEggs.length !== 4 ||
          !s.exchangedEggs.every(integer))) ||
      (s.bonusEggs !== undefined &&
        (!Array.isArray(s.bonusEggs) ||
          s.bonusEggs.length !== 4 ||
          !s.bonusEggs.every(integer) ||
          s.bonusEggs.some((n, i) => n > s.found[i] * 2))) ||
      (s.multiplierExpiresAt !== undefined && !integer(s.multiplierExpiresAt)) ||
      (s.dailyFound !== undefined &&
        (!object(s.dailyFound) ||
          Object.entries(s.dailyFound).some(
            ([day, count]) => !/^\d{1,8}$/.test(day) || !integer(count),
          ) ||
          Object.values(s.dailyFound).reduce(add, 0) > s.found.reduce(add, 0))) ||
      s.eggs.some((n, i) => n > s.found[i] + (s.exchangedEggs?.[i] || 0) + (s.bonusEggs?.[i] || 0))
    )
      throw Error("Повреждена коллекция яиц.");
    if (
      s.life !== undefined &&
      (!object(s.life) ||
        typeof s.life.id !== "string" ||
        !s.life.id.length ||
        s.life.id.length > 100 ||
        !Array.isArray(s.life.eggs) ||
        s.life.eggs.length !== 4 ||
        !s.life.eggs.every(integer) ||
        s.life.eggs.some((n, i) => n > s.found[i] + (s.bonusEggs?.[i] || 0)) ||
        (s.life.pendingBonusEggs !== undefined &&
          (!Array.isArray(s.life.pendingBonusEggs) ||
            s.life.pendingBonusEggs.length !== 4 ||
            !s.life.pendingBonusEggs.every(integer) ||
            s.life.pendingBonusEggs.some((n, i) => n > s.life.eggs[i] * 2))))
    )
      throw Error("Повреждён счётчик яиц за жизнь.");
    if (
      s.fragmentCounts !== undefined &&
      (!Array.isArray(s.fragmentCounts) ||
        ![12, rules.fragments].includes(s.fragmentCounts.length) ||
        !s.fragmentCounts.every(integer) ||
        s.fragmentCounts.filter((n) => n > 0).length !== s.fragments)
    )
      throw Error("Повреждены фрагменты коллекции.");
    const totals = values(s);
    stages.validate(s, rules.achievements, (d) => totals[d.id]);
    for (const d of rules.achievements) {
      const c = s.claimed[d.id] || 0;
      if (
        !integer(c) ||
        c > d.thresholds.length ||
        d.thresholds.slice(0, c).reduce((a, b) => a + b, 0) > totals[d.id]
      )
        throw Error("Повреждены пасхальные достижения.");
    }
  }
  const ids = new Set();
  for (const c of e.chests) {
    if (
      !object(c) ||
      typeof c.id !== "string" ||
      ids.has(c.id) ||
      !e.runs[c.runId] ||
      !integer(c.at) ||
      typeof c.stored !== "boolean" ||
      !treasury.validStorage(c) ||
      !object(c.reward) ||
      (c.reward.multiplier !== undefined && ![1, 2, 3].includes(c.reward.multiplier)) ||
      !integer(c.reward.coins) ||
      c.reward.coins < 100 ||
      c.reward.coins > (c.reward.version >= 2 ? 150 : 159) ||
      (c.reward.version !== undefined && ![2, 3].includes(c.reward.version)) ||
      (c.reward.version === 3 ? c.reward.boosterCount !== 3 : c.reward.version === 2
        ? c.reward.boosterCount !== 10
        : c.reward.boosterCount !== undefined) ||
      !integer(c.reward.crystals) ||
      c.reward.crystals < 10 ||
      c.reward.crystals > 20 ||
      (c.reward.fragmentId !== undefined &&
        (!integer(c.reward.fragmentId) || c.reward.fragmentId >= rules.fragments))
    )
      throw Error("Повреждён пасхальный сундук.");
    ids.add(c.id);
  }
  for (const b of e.batches)
    if (!integer(b.count) || b.count < 1 || !integer(b.expiresAt) || (b.expiresAt + MSK) % DAY)
      throw Error("Повреждён срок пасхального бустера.");
  if (
    e.batches.reduce((n, b) => n + b.count, 0) !== (p.inventory.easter_egg || 0) ||
    new Set(e.trophies.map((t) => t.runId)).size !== e.trophies.length ||
    e.trophies.some(
      (t) =>
        !integer(t.at) ||
        (t.notifiedAt !== undefined && !integer(t.notifiedAt)) ||
        !e.runs[t.runId] ||
        (t.collectionVersion !== undefined && t.collectionVersion !== 2) ||
        !fragmentCounts(e.runs[t.runId])
          .slice(0, t.collectionVersion === 2 ? rules.fragments : 12)
          .every((n) => n > 0),
    )
  )
    throw Error("Повреждены пасхальные награды.");
}
module.exports = {
  manifest,
  achievements: rules.achievements,
  runAt,
  progress,
  settleLife,
  mutate,
  act,
  view,
  arenaView,
  achievementView,
  validate,
  expiresAt,
  count,
  expire,
  consume,
  capture,
  refreshDue,
  drawFragment,
  album,
  albumPictures,
};
