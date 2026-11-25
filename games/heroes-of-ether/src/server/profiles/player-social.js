/* Приглашения в брак и подарки: обе стороны меняются одной транзакцией. */
"use strict";
const { randomUUID } = require("node:crypto");
const { BoosterError } = require("../boosters/booster-catalog");
const { gifts, retired } = require("./gift-catalog");
const giftHistory = require("./gift-history");
const GIFT_SHOWCASE_MS = 48 * 60 * 60 * 1000;
const VALUABLE_GIFTS = new Set(["clover", "swift_boot", "booster_crystal", "ward_shield"]);
const NOTICE_ACTIONS = {
  "divorce-read": "divorceNotices",
  "marriage-read": "marriageNotices",
  "marriage-declined-read": "marriageDeclinedNotices",
};
const NOTICE_FIELDS = Object.values(NOTICE_ACTIONS);

const fail = (message) => {
  throw new BoosterError(message, 409);
};
const data = (p) => (p.social ||= { marriage: null, invitations: [], gifts: [], inviteReadyAt: 0 });
function validate(p) {
  if (!p.social) return;
  const s = p.social,
    integer = (n) => Number.isSafeInteger(n) && n >= 0;
  if (
    !Array.isArray(s.invitations) ||
    s.invitations.length > 10 ||
    !Array.isArray(s.gifts) ||
    s.gifts.length > gifts.length + retired.length ||
    !integer(s.inviteReadyAt) ||
    NOTICE_FIELDS.map(key => s[key]).some(notices => notices !== undefined &&
      (!Array.isArray(notices) || new Set(notices.map(n => n?.id)).size !== notices.length || notices.some(n =>
        !n || typeof n.id !== "string" || typeof n.fromId !== "string" ||
        n.fromId === p.id || typeof n.fromName !== "string" || !integer(n.at) ||
        (n.initiated !== undefined && typeof n.initiated !== "boolean")))) ||
    s.invitations.some(
      (i) =>
        typeof i.id !== "string" ||
        typeof i.fromId !== "string" ||
        !integer(i.at) ||
        !integer(i.until),
    ) ||
    s.gifts.some(
      (g) =>
        (!gifts.some((item) => item.id === g.id) && !retired.includes(g.id)) ||
        !integer(g.count) ||
        (g.noticeThrough !== undefined && (!integer(g.noticeThrough) || g.noticeThrough > g.count)) ||
        !Array.isArray(g.history) ||
        g.history.length > g.count ||
        g.history.some(
          (h) => typeof h.fromId !== "string" || typeof h.fromName !== "string" || !integer(h.at) ||
            (h.ordinal !== undefined && (!integer(h.ordinal) || h.ordinal < 1 || h.ordinal > g.count)) ||
            (h.anonymous !== undefined && typeof h.anonymous !== "boolean") ||
            (h.id !== undefined && typeof h.id !== "string") ||
            (h.readAt !== undefined && !integer(h.readAt)),
        ),
    ) ||
    (s.giftEffects &&
      (typeof s.giftEffects !== "object" ||
        Array.isArray(s.giftEffects) ||
        Object.entries(s.giftEffects).some(
          ([id, until]) => !gifts.some((g) => g.id === id && (g.stat || g.bundlePercent)) || !integer(until),
        ))) ||
    (s.marriage &&
      (typeof s.marriage.partnerId !== "string" ||
        s.marriage.partnerId === p.id ||
        !integer(s.marriage.at)))
  )
    throw Error("Повреждены браки или подарки. Сохранение не перезаписано.");
}
function view(store, p, privateView = false) {
  const s = p.social,
    at = store.now(),
    partner = s?.marriage && store.byId(s.marriage.partnerId);
  const overview = giftHistory.overview(s, at), identities = new Map();
  const giftNotice = ({ row: h, gift }) => {
    if (!h.anonymous && !identities.has(h.fromId)) {
      const sender = store.byId(h.fromId);
      identities.set(h.fromId, { id: h.fromId, ...(sender ? store.identity(sender) : { name: h.fromName }) });
    }
    return { id: h.id, at: h.at, gift,
      ...(h.anonymous ? { anonymous: true } : { from: identities.get(h.fromId) }) };
  };
  return {
    marriage: partner
      ? { at: s.marriage.at, partner: { id: partner.id, ...store.identity(partner) } }
      : null,
    effects: gifts
      .filter((g) => (g.stat || g.bundlePercent) && s?.giftEffects?.[g.id] > at)
      .map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        description: g.description,
        stat: g.stat,
        percent: g.percent,
        ...(g.bundlePercent ? { bundlePercent: g.bundlePercent,
          active: require("./gift-effects").modifiers(p, at).visual === g.id } : {}),
        until: s.giftEffects[g.id],
      })),
    gifts: overview.gifts,
    ...(privateView
      ? {
          ...Object.fromEntries(NOTICE_FIELDS.map(key => [key, (s?.[key] || []).map(n => ({
            id: n.id, at: n.at, ...(n.initiated ? { initiated: true } : {}),
            from: { id: n.fromId, ...(store.byId(n.fromId)
              ? store.identity(store.byId(n.fromId)) : { name: n.fromName }) },
          }))])),
          giftSummary: { total: overview.total, groups: overview.pending },
          // Bounded compatibility for an already open, older client.
          giftNotices: overview.notices.map(giftNotice).sort((a,b) => a.at - b.at),
          invitations: (s?.invitations || [])
            .filter((i) => i.until > at)
            .flatMap((i) => {
              const from = store.byId(i.fromId);
              return from ? [{ ...i, from: { id: from.id, ...store.identity(from) } }] : [];
            }),
        }
      : {}),
  };
}
function mutationParticipants(sender, world, input, at) {
  const ids = new Set();
  if (["gift", "invite", "divorce"].includes(input.action)) ids.add(input.targetId);
  if (input.action === "accept" || input.action === "decline") {
    const invitation = sender.social?.invitations.find(i => i.id === input.invitationId && i.until > at);
    if (invitation) {
      ids.add(invitation.fromId);
      if (input.action === "accept") {
        // Acceptance also removes invitations sent by either spouse. Scan the
        // small invitation lists, cloning only profiles that contain one.
        for (const p of Object.values(world.profiles))
          if (p.social?.invitations.some(i => i.fromId === sender.id || i.fromId === invitation.fromId)) ids.add(p.id);
      }
    }
  }
  return { profileIds: [...ids], profileDraft: "owned" };
}
function mutate(store, token, input) {
  // A separate operation fails closed on older servers that do not understand
  // anonymity. Normalize before signing so retries from the previous client
  // retain their receipt and never charge or send twice.
  if (input.action === "gift-anonymous") {
    if (input.anonymous !== true) fail("Неверная настройка анонимности подарка.");
    input = { ...input, action: "gift" };
  }
  const allowed = ["invite", "accept", "decline", "gift", "divorce", "gift-read", "gifts-seen", ...Object.keys(NOTICE_ACTIONS)];
  if (!allowed.includes(input.action)) fail("Неизвестное действие.");
  if (input.action === "gift" && input.anonymous !== undefined && typeof input.anonymous !== "boolean")
    fail("Неверная настройка анонимности подарка.");
  if (input.action === "gifts-seen" && (!Array.isArray(input.through) || !input.through.length ||
      input.through.length > gifts.length || new Set(input.through.map(g => g?.giftId)).size !== input.through.length ||
      input.through.some(g => !g || !gifts.some(item => item.id === g.giftId) ||
        !Number.isSafeInteger(g.through) || g.through < 1))) fail("Неверное уведомление о подарках.");
  const signature = JSON.stringify([
    "social",
    input.action,
    input.targetId,
    input.name,
    input.invitationId,
    input.giftId,
    input.confirmed,
    // Keep the existing signature for named gifts and old retries.
    ...(input.action === "gift" && input.anonymous === true ? [true] : []),
    ...(input.action === "divorce" ? [input.marriageAt] : []),
    ...(input.action === "gift-read" || Object.hasOwn(NOTICE_ACTIONS, input.action) ? [input.noticeId] : []),
    ...(input.action === "gifts-seen" ? [input.through.map(g => [g.giftId, g.through])] : []),
  ]);
  return store.transactWorld(token, input.requestId, signature, (sender, world, participants) => {
    const at = store.now(),
      profiles = participants,
      state = data(sender);
    const byId = (id) => profiles.find((p) => p.id === id);
    if (input.action === "divorce") {
      if (input.confirmed !== true) fail("Подтверди расторжение брака.");
      const marriage = state.marriage;
      if (!marriage || marriage.partnerId !== input.targetId || marriage.at !== input.marriageAt)
        fail("Этот брак уже расторгнут. Обнови профиль.");
      const partner = byId(marriage.partnerId);
      if (partner?.social?.marriage?.partnerId !== sender.id || partner.social.marriage.at !== marriage.at)
        fail("Не удалось проверить брак. Обнови профиль.");
      state.marriage = null;
      partner.social.marriage = null;
      for (const person of [sender, partner])
        require("../progression/marriage-progress").reset(person, store.events, at);
      (partner.social.divorceNotices ||= []).push({
        id: randomUUID(), fromId: sender.id, fromName: sender.name, at,
      });
      (state.divorceNotices ||= []).push({
        id: randomUUID(), fromId: partner.id, fromName: partner.name, at, initiated: true,
      });
    } else if (Object.hasOwn(NOTICE_ACTIONS, input.action)) {
      if (typeof input.noticeId !== "string") fail("Неизвестное уведомление.");
      const key = NOTICE_ACTIONS[input.action];
      state[key] = (state[key] || []).filter(n => n.id !== input.noticeId);
    } else if (input.action === "gifts-seen") {
      for (const mark of input.through) {
        const entry = state.gifts.find(g => g.id === mark.giftId);
        if (!entry || mark.through > entry.count) fail("Обнови список подарков.");
        entry.noticeThrough = Math.max(entry.noticeThrough || 0, mark.through);
      }
    } else if (input.action === "gift-read") {
      if (typeof input.noticeId !== "string") fail("Неизвестное уведомление.");
      let notice;
      for (const gift of state.gifts) { notice = gift.history.find(h => h.id === input.noticeId); if (notice) break; }
      if (notice) notice.readAt ||= at;
    } else if (input.action === "invite") {
      const target = byId(input.targetId);
      if (!target || target.id === sender.id) fail("Выбери другого игрока.");
      if (typeof input.name !== "string" || input.name.trim() !== target.name)
        fail("Введи точный ник выбранного игрока.");
      const recipient = data(target);
      if (state.marriage || recipient.marriage) fail("Один из игроков уже состоит в браке.");
      const a = sender.personal?.gender,
        b = target.personal?.gender;
      if (!["male", "female"].includes(a) || !["male", "female"].includes(b))
        fail("Оба игрока должны указать пол в личных данных.");
      if (a === b) fail("По правилам игры брак доступен игрокам противоположного пола.");
      recipient.invitations = recipient.invitations.filter((i) => i.until > at);
      if (recipient.invitations.some((i) => i.fromId === sender.id))
        fail("Приглашение уже отправлено.");
      if (state.inviteReadyAt > at) fail("Следующее приглашение можно отправить через 30 секунд.");
      if (recipient.invitations.length >= 10)
        fail("У игрока слишком много приглашений. Попробуй позже.");
      recipient.invitations.push({
        id: randomUUID(),
        fromId: sender.id,
        at,
        until: at + 7 * 86400000,
      });
      state.inviteReadyAt = at + 30000;
    } else if (input.action === "accept" || input.action === "decline") {
      const invite = state.invitations.find((i) => i.id === input.invitationId && i.until > at);
      if (!invite) fail("Приглашение уже обработано или истекло.");
      if (input.action === "accept") {
        const partner = byId(invite.fromId);
        if (!partner || state.marriage || data(partner).marriage)
          fail("Один из игроков уже состоит в браке.");
        const a = sender.personal?.gender,
          b = partner.personal?.gender;
        if (!["male", "female"].includes(a) || !["male", "female"].includes(b) || a === b)
          fail("Для брака нужен противоположный пол, указанный в личных данных.");
        for (const person of [sender, partner])
          require("../progression/marriage-progress").reset(person, store.events, at);
        state.marriage = { partnerId: partner.id, at };
        data(partner).marriage = { partnerId: sender.id, at };
        (partner.social.marriageNotices ||= []).push({
          id: randomUUID(), fromId: sender.id, fromName: sender.name, at,
        });
        sender.activity.values.marriage++;
        partner.activity.values.marriage++;
        for (const p of profiles)
          if (p.social)
            p.social.invitations =
              p.id === sender.id || p.id === partner.id
                ? []
                : p.social.invitations.filter(
                    (i) => i.fromId !== sender.id && i.fromId !== partner.id,
                  );
      } else {
        const inviter = byId(invite.fromId);
        if (inviter) (data(inviter).marriageDeclinedNotices ||= []).push({
          id: randomUUID(), fromId: sender.id, fromName: sender.name, at,
        });
        state.invitations = state.invitations.filter((i) => i.id !== invite.id);
      }
    } else {
      const target = byId(input.targetId),
        gift = gifts.find((g) => g.id === input.giftId);
      if (!target || !gift) fail("Выбери подарок и получателя.");

      if (input.confirmed !== true) fail("Подтверди отправку и стоимость подарка.");
      if (!require("./event-gift-unlocks").unlocked(sender, gift)) fail(gift.unlockHint);
      if (sender.wallet[gift.currency] < gift.price) fail("Недостаточно валюты для подарка.");
      const list = data(target).gifts;
      let entry = list.find((g) => g.id === gift.id);
      if (!entry) {
        entry = { id: gift.id, count: 0, history: [] };
        list.push(entry);
      }
      if (!Number.isSafeInteger(entry.count + 1)) fail("Достигнут предел подарков.");
      sender.wallet[gift.currency] -= gift.price;
      require("../progression/activity-achievements").spend(sender, gift.currency, gift.price, at);
      if (gift.stat || gift.bundlePercent) {
        const effects = (data(target).giftEffects ||= {});
        const until = Math.max(at, effects[gift.id] || 0) + gift.durationMs;
        if (!Number.isSafeInteger(until)) fail("Достигнут предел срока подарка.");
        effects[gift.id] = until;
      }
      for (let i = 0; i < entry.history.length; i++) entry.history[i].ordinal ??= entry.count - i;
      entry.count++;
      entry.history.unshift({ id: randomUUID(), ordinal: entry.count, fromId: sender.id, fromName: sender.name, at,
        ...(input.anonymous === true ? { anonymous: true } : {}) });
      // Храним все ещё видимые подарки, даже если за 48 часов получено больше двадцати.
      // Последние 20 записей остаются историей после исчезновения из витрины.
      entry.history = entry.history.filter(
        (h, index) => index < 20 || h.at + GIFT_SHOWCASE_MS > at,
      );
      require("../clans/daily-quests/service").gift(world, sender, at);
      require("../events/black-friday").activity(sender, store.events, { giftsGiven: 1 }, at);
      require("../events/black-friday").activity(target, store.events, { giftsReceived: 1 }, at);
      if (sender.id !== target.id) {
        sender.activity.values.generous++;
        target.activity.values.needed++;
      }
      if (state.marriage?.partnerId === target.id) {
        sender.activity.values.loving++;
        if (VALUABLE_GIFTS.has(gift.id)) sender.activity.values.valuable++;
      }
    }
    for (const p of profiles) validate(p);
  }, (sender, world) => mutationParticipants(sender, world, input, store.now()));
}
// Restore only gifts evidenced by the retained recipient history, during the
// same marriage. Old truncated history cannot safely be guessed or re-awarded.
function migrateValuable(world) {
  const people = new Map(Object.values(world.profiles).map((p) => [p.id, p]));
  let changed = false;
  for (const sender of people.values()) {
    if (sender.activity.marriageProgressVersion === 1) continue;
    const marriage = sender.social?.marriage;
    if (!marriage) continue;
    const partner = people.get(marriage.partnerId);
    if (partner?.social?.marriage?.partnerId !== sender.id) continue;
    let confirmed = 0;
    for (const gift of partner.social.gifts || [])
      if (VALUABLE_GIFTS.has(gift.id))
        for (const event of gift.history)
          if (event.fromId === sender.id && event.at >= marriage.at) confirmed++;
    if (confirmed > sender.activity.values.valuable) {
      sender.activity.values.valuable = confirmed;
      sender.revision++;
      changed = true;
    }
  }
  return changed;
}
module.exports = { gifts, validate, view, mutate, migrateValuable };
