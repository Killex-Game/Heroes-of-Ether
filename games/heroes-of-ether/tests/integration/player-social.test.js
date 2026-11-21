"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  path = require("node:path"),
  { once } = require("node:events");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"),
  { temporary } = require("../temp");
const { gifts } = require("../../src/server/profiles/player-social");

test("Расторжение брака: подтверждение, обе стороны, повтор, сбой записи и новая пара", (t) => {
  const filePath = path.join(temporary(t, "divorce"), "profiles.json");
  const f = fixture(filePath), { store, a, b, c, action } = f;
  action(b, { action: "accept", invitationId: f.invite().id });
  const at = store.find(a.token).social.marriage.at;
  const command = { action: "divorce", targetId: b.profile.id, marriageAt: at, confirmed: true, requestId: randomUUID() };
  assert.throws(() => action(a, {...command, confirmed: false}), /Подтверди/);
  assert.throws(() => action(c, command), /брак/);
  const before = structuredClone(store.data), save = store.save;
  store.save = () => { throw Error("disk full"); };
  assert.throws(() => action(a, command), /disk full/); assert.deepEqual(store.data, before);
  store.save = save; action(a, command); action(a, command);
  assert.equal(store.find(a.token).social.marriage, null);
  assert.equal(store.find(b.token).social.marriage, null);
  const restored = new ProfileStore({ filePath, now: store.now });
  assert.equal(restored.find(b.token).social.marriage, null);
  const social = require("../../src/server/profiles/player-social");
  const notices = social.view(restored, restored.find(b.token), true).divorceNotices;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].from.id, a.profile.id);
  const ownNotices = social.view(restored, restored.find(a.token), true).divorceNotices;
  assert.equal(ownNotices.length, 1);
  assert.equal(ownNotices[0].from.id, b.profile.id);
  assert.equal(ownNotices[0].initiated, true);
  action(a, { action: "divorce-read", noticeId: ownNotices[0].id });
  assert.equal(store.find(a.token).social.divorceNotices.length, 0);
  assert.equal(social.view(restored, restored.find(b.token), false).divorceNotices, undefined);
  action(c, { action: "divorce-read", noticeId: notices[0].id });
  assert.equal(store.find(b.token).social.divorceNotices.length, 1);
  const read = { action: "divorce-read", noticeId: notices[0].id, requestId: randomUUID() };
  action(b, read); action(b, read);
  assert.equal(store.find(b.token).social.divorceNotices.length, 0);
  const reread = new ProfileStore({ filePath, now: store.now });
  assert.equal(reread.find(b.token).social.divorceNotices.length, 0);
  assert.equal(restored.find(a.token).activity.values.marriage, 1, "earned achievement is retained");
  f.advance(31000); action(c, { action: "invite", targetId: b.profile.id, name: "Луна" });
  action(b, { action: "accept", invitationId: store.find(b.token).social.invitations[0].id });
  action(a, command);
  assert.equal(store.find(b.token).social.marriage.partnerId, c.profile.id, "old retry cannot dissolve a new marriage");
});

test("Принятое предложение: уведомление отправителю атомарно, приватно и переживает перезапуск", t => {
  const filePath = path.join(temporary(t, "marriage-notice"), "profiles.json");
  const f = fixture(filePath), { store, a, b, c, action } = f;
  const command = { action: "accept", invitationId: f.invite().id, requestId: randomUUID() };
  const before = structuredClone(store.data), save = store.save;
  store.save = () => { throw Error("disk full"); };
  assert.throws(() => action(b, command), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save; action(b, command); action(b, command);
  const social = require("../../src/server/profiles/player-social");
  const restored = new ProfileStore({ filePath, now: store.now });
  const notices = social.view(restored, restored.find(a.token), true).marriageNotices;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].from.id, b.profile.id);
  assert.equal(social.view(restored, restored.find(a.token), false).marriageNotices, undefined);
  action(c, { action: "marriage-read", noticeId: notices[0].id });
  assert.equal(store.find(a.token).social.marriageNotices.length, 1);
  const read = { action: "marriage-read", noticeId: notices[0].id, requestId: randomUUID() };
  action(a, read); action(a, read);
  const reread = new ProfileStore({ filePath, now: store.now });
  assert.equal(social.view(reread, reread.find(a.token), true).marriageNotices.length, 0);
  assert.equal(reread.find(a.token).social.marriage.partnerId, b.profile.id);
});

test("Подарочное уведомление: приватность, одно прочтение, повтор и восстановление", (t) => {
  const filePath = path.join(temporary(t, "gift-notice"), "profiles.json");
  const f = fixture(filePath), { store, a, b, c, action } = f;
  const command = { action: "gift-anonymous", targetId: b.profile.id, giftId: "teddy", confirmed: true, anonymous: true, requestId: randomUUID() };
  action(a, command); action(a, command);
  const social = require("../../src/server/profiles/player-social");
  const notices = social.view(store, store.find(b.token), true).giftNotices;
  assert.equal(notices.length, 1); assert.equal(notices[0].anonymous, true);
  assert.equal(notices[0].from, undefined); assert.equal(JSON.stringify(notices).includes(a.profile.id), false);
  assert.equal(social.view(store, store.find(b.token), false).giftNotices, undefined);
  action(c, { action: "gift-read", noticeId: notices[0].id });
  assert.equal(social.view(store, store.find(b.token), true).giftNotices.length, 1);
  const ack = { action: "gift-read", noticeId: notices[0].id, requestId: randomUUID() };
  action(b, ack); action(b, ack);
  const restored = new ProfileStore({ filePath, now: store.now });
  assert.equal(social.view(restored, restored.find(b.token), true).giftNotices.length, 0);
  assert.equal(restored.find(b.token).social.gifts[0].count, 1);
});

test("Отклонённое предложение: отправитель получает одно приватное долговечное уведомление", t => {
  const filePath = path.join(temporary(t, "declined-marriage"), "profiles.json");
  const f = fixture(filePath), { store, a, b, c, action } = f;
  const invitation = f.invite(), input = { action: "decline", invitationId: invitation.id, requestId: randomUUID() };
  assert.throws(() => action(c, input), /обработано или истекло/);
  const before = structuredClone(store.data), save = store.save;
  store.save = () => { throw Error("decline fsync failure"); };
  assert.throws(() => action(b, input), /fsync failure/);
  assert.deepEqual(store.data, before, "failed write retains invitation and produces no notice");
  store.save = save;
  action(b, input); assert.equal(action(b, input).replay, true);
  assert.equal(store.find(b.token).social.invitations.length, 0);
  assert.equal(store.find(a.token).social.marriage, null);
  const disk = new ProfileStore({ filePath, now: store.now }), social = require("../../src/server/profiles/player-social");
  const notices = social.view(disk, disk.find(a.token), true).marriageDeclinedNotices;
  assert.equal(notices.length, 1); assert.equal(notices[0].from.id, b.profile.id);
  assert.equal(notices[0].at, store.now());
  assert.equal(social.view(disk, disk.find(a.token), false).marriageDeclinedNotices, undefined);
  assert.deepEqual(social.view(disk, disk.find(b.token), true).marriageDeclinedNotices, []);
  action(c, { action: "marriage-declined-read", noticeId: notices[0].id });
  assert.equal(store.find(a.token).social.marriageDeclinedNotices.length, 1);
  const read = { action: "marriage-declined-read", noticeId: notices[0].id, requestId: randomUUID() };
  store.save = () => { throw Error("read fsync failure"); };
  assert.throws(() => action(a, read), /fsync failure/);
  assert.equal(store.find(a.token).social.marriageDeclinedNotices.length, 1);
  store.save = save; action(a, read); action(a, read);
  const restored = new ProfileStore({ filePath, now: store.now });
  assert.deepEqual(social.view(restored, restored.find(a.token), true).marriageDeclinedNotices, []);
  assert.equal(restored.socialAction(b.token, input).replay, true);
  assert.deepEqual(social.view(restored, restored.find(a.token), true).marriageDeclinedNotices, []);
  assert.throws(() => action(b, { ...input, requestId: randomUUID() }), /обработано или истекло/);
});
function fixture(filePath = null) {
  let now = Date.UTC(2026, 9, 22);
  const store = new ProfileStore({ filePath, now: () => now });
  const a = store.open(),
    b = store.open(),
    c = store.open();
  for (const [session, name, gender] of [
    [a, "Алекс", "male"],
    [b, "Луна", "female"],
    [c, "Солнце", "male"],
  ]) {
    const p = store.find(session.token);
    p.name = name;
    p.personal = { nameSet: true, gender, vkUrl: "" };
    p.wallet = { coins: 10000, crystals: 1000, bucks: 1000 };
  }
  const action = (session, input) =>
    store.socialAction(session.token, { requestId: randomUUID(), ...input });
  const invite = () => {
    action(a, { action: "invite", targetId: b.profile.id, name: "Луна" });
    return store.find(b.token).social.invitations[0];
  };
  return {
    store,
    a,
    b,
    c,
    action,
    invite,
    advance: (dt) => {
      now += dt;
    },
  };
}

function earnEventGifts({ store, a }) {
  const { EventManager } = require("../../src/server/events/event-manager"),
    easter = require("../../src/server/events/easter-hunt"),
    friday = require("../../src/server/events/black-friday");
  const events = new EventManager({ now: store.now });
  store.events = events;
  events.apply("test", "start", { eventId: easter.manifest.id, revision: events.data.revision, requestId: randomUUID() });
  const runId = events.active().id, lifeId = "earned-gifts-fixture", at = store.now();
  store.startLife(a.profile.id, lifeId);
  store.applyArenaProgress(randomUUID(), [{ type: "easterPickup", eggType: 0, lifeId, runId, profileId: a.profile.id }], at);
  store.applyArenaProgress(randomUUID(), [{ type: "lifeEnded", lifeId, durationSeconds: 0, reason: "left", profileId: a.profile.id }], at);
  store.transact(a.token, randomUUID(), "earned-event-gifts-fixture", p => {
    const state = p.easter.runs[runId], days = {}, date = friday.day(at);
    state.fragmentCounts = Array(48).fill(0);
    state.fragmentCounts.fill(1, 0, 12);
    state.fragments = 12;
    for (let i = 0; i < 5; i++) days[date - i] = {
      food: 150, mass: 5000, life: 1, claimed: ["food", "mass", "life"], exchanges: { coins: 2 },
    };
    p.blackFriday = { runs: { "completed-legacy-friday": {
      tokens: 150, completedOrders: 15, days, purchases: {}, finalAt: at - 1,
    } } };
  });
  events.apply("test", "stop", { runId, revision: events.data.revision, requestId: randomUUID() });
}

test("Ценные: четыре усилителя супругу, без повторов, декора, дебаффов, себе и посторонним", (t) => {
  const filePath = path.join(temporary(t, "valuable"), "profiles.json");
  const f = fixture(filePath), { store, a, b, c, action } = f;
  action(b, { action: "accept", invitationId: f.invite().id });
  const send = (giftId, targetId = b.profile.id, requestId = randomUUID()) =>
    action(a, { action: "gift", giftId, targetId, confirmed: true, requestId });
  for (const id of ["clover", "swift_boot", "booster_crystal", "ward_shield"]) {
    const requestId = randomUUID();
    send(id, b.profile.id, requestId); send(id, b.profile.id, requestId);
  }
  assert.equal(store.find(a.token).activity.values.valuable, 4);
  for (const id of ["teddy", "skull", "shackles", "venom", "black_mark"]) send(id);
  send("clover", a.profile.id); send("clover", c.profile.id);
  assert.equal(store.find(a.token).activity.values.valuable, 4);
  assert.equal(store.find(b.token).activity.values.valuable, 0, "achievement belongs to giver");
  for (let i = 0; i < 6; i++) send("ward_shield");
  assert.equal(store.find(a.token).activity.values.valuable, 10);
  assert.equal(store.find(a.token).activity.claimed.valuable, 1);
  const before = structuredClone(store.data), save = store.save;
  store.save = () => { throw Error("disk full"); };
  assert.throws(() => send("clover"), /disk full/);
  assert.deepEqual(store.data, before); store.save = save;
  const restored = new ProfileStore({ filePath, now: store.now });
  assert.equal(restored.find(a.token).activity.values.valuable, 10);
  assert.equal(restored.find(a.token).activity.claimed.valuable, 1);
  // Simulate the old unavailable counter; recover only documented spouse gifts.
  restored.find(a.token).activity.values.valuable = 0;
  delete restored.find(a.token).activity.marriageProgressVersion;
  const social = require("../../src/server/profiles/player-social");
  assert.equal(social.migrateValuable(restored.data), true);
  assert.equal(restored.find(a.token).activity.values.valuable, 10);
  assert.equal(social.migrateValuable(restored.data), false);
});

test("Развод сбрасывает только текущие степени обоих супругов; повторный брак начинает полный срок заново", t => {
  const filePath = path.join(temporary(t, "marriage-progress-reset"), "profiles.json"), f = fixture(filePath);
  const { store, a, b, action } = f, activity = require("../../src/server/progression/activity-achievements"),
    lucky = require("../../src/server/events/lucky-week"), { EventManager } = require("../../src/server/events/event-manager");
  const events = new EventManager({ now: store.now }); store.events = events;
  events.apply("test", "start", { eventId: lucky.manifest.id, revision: events.data.revision, requestId: randomUUID() });
  const run = events.active(), ids = ["strong_love", "always_together", "loving", "valuable"];
  action(b, { action: "accept", invitationId: f.invite().id });
  for (const who of [a, b]) store.transact(who.token, randomUUID(), "earned-marriage-progress", p => {
    Object.assign(p.activity.values, { strong_love: 70, always_together: 23, loving: 17, valuable: 15 });
    lucky.record(p, run, "lucky_marriage_games", 15);
    p.eventAchievements.archived = structuredClone(p.eventAchievements[run.id]);
  });
  const progress = (s, who = a) => activity.publicExtra(s.find(who.token)).filter(d => ids.includes(d.id));
  assert.deepEqual(progress(store).map(d => d.value), [40, 7, 2, 5]);
  const before = structuredClone(store.data), claims = {}, greatness = {}, wallets = {};
  for (const who of [a, b]) {
    const p = store.find(who.token); claims[p.id] = { ...p.activity.claimed }; greatness[p.id] = p.greatness; wallets[p.id] = { ...p.wallet };
  }
  const input = { action: "divorce", targetId: b.profile.id, marriageAt: store.find(a.token).social.marriage.at, confirmed: true, requestId: randomUUID() };
  const save = store.save; store.save = () => { throw Error("reset fsync failure"); };
  assert.throws(() => action(a, input), /fsync failure/); assert.deepEqual(store.data, before);
  store.save = save; action(a, input); assert.equal(action(a, input).replay, true);
  for (const who of [a, b]) {
    const p = store.find(who.token);
    assert(progress(store, who).every(d => d.value === 0)); assert.deepEqual(p.activity.claimed, claims[p.id]);
    assert.equal(p.greatness, greatness[p.id]); assert.deepEqual(p.wallet, wallets[p.id]);
    assert.equal(lucky.view(p, events, store.now()).find(d => d.id === "lucky_marriage_games").value, 0);
    assert.equal(p.eventAchievements[run.id].claimed.lucky_marriage_games, 1);
    assert.equal(p.eventAchievements.archived.values.lucky_marriage_games, 15);
  }
  f.advance(31000); action(b, { action: "accept", invitationId: f.invite().id });
  assert(progress(store).every(d => d.value === 0), "same partner, same day starts at zero");
  action(a, { action: "gift", targetId: b.profile.id, giftId: "clover", confirmed: true });
  assert.equal(progress(store).find(d => d.id === "valuable").value, 1);
  action(a, input);
  assert.equal(progress(store).find(d => d.id === "valuable").value, 1, "retry of an old divorce cannot reset a newer marriage");
  const restored = new ProfileStore({ filePath, now: store.now }); restored.events = events;
  assert.equal(progress(restored).find(d => d.id === "valuable").value, 1);
  assert.equal(progress(restored).find(d => d.id === "strong_love").value, 0);
  f.advance(59 * 86400000); restored.refreshCompetition();
  assert.equal(progress(restored).find(d => d.id === "strong_love").value, 59);
  assert.equal(restored.find(a.token).activity.claimed.strong_love, 1);
  f.advance(86400000); restored.refreshCompetition();
  assert.equal(restored.find(a.token).activity.claimed.strong_love, 2);
  assert.equal(progress(restored).find(d => d.id === "strong_love").value, 0);
  assert.match(progress(restored).find(d => d.id === "strong_love").description, /с одним игроком/);
});
test("Брак: точный ник, противоположный пол, согласие адресата, повтор и симметрия", () => {
  const f = fixture(),
    { store, a, b, c, action } = f;
  assert.throws(
    () => action(a, { action: "invite", targetId: b.profile.id, name: "луна" }),
    /точный/,
  );
  assert.throws(
    () => action(a, { action: "invite", targetId: c.profile.id, name: "Солнце" }),
    /противоположного/,
  );
  const invitation = f.invite();
  assert.equal(store.find(a.token).social.marriage, null);
  assert.throws(() => action(c, { action: "accept", invitationId: invitation.id }), /Приглашение/);
  const input = { action: "accept", invitationId: invitation.id, requestId: randomUUID() };
  action(b, input);
  assert.equal(action(b, input).replay, true);
  assert.equal(store.find(a.token).social.marriage.partnerId, b.profile.id);
  assert.equal(store.find(b.token).social.marriage.partnerId, a.profile.id);
  assert.equal(store.publicPlayer(a.profile.id).social.marriage.partner.name, "Луна");
  assert.equal(store.find(a.token).activity.values.marriage, 1);
  assert.throws(
    () => action(c, { action: "invite", targetId: b.profile.id, name: "Луна" }),
    /уже состоит/,
  );
});
test("Отказ, истечение, повторное приглашение и изменение пола до принятия", () => {
  const f = fixture(),
    i = f.invite();
  f.action(f.b, { action: "decline", invitationId: i.id });
  assert.equal(f.store.find(f.b.token).social.invitations.length, 0);
  assert.throws(() => f.invite(), /30 секунд/);
  f.advance(30000);
  const next = f.invite();
  f.store.find(f.b.token).personal.gender = "male";
  assert.throws(
    () => f.action(f.b, { action: "accept", invitationId: next.id }),
    /противоположный/,
  );
  f.advance(7 * 86400000);
  assert.equal(f.store.socialState(f.b.token).social.invitations.length, 0);
  assert.throws(() => f.action(f.b, { action: "accept", invitationId: next.id }), /истекло/);
});
test("Подарки за три валюты: точная цена, один расход при повторе, витрина и отказ при нехватке", () => {
  const f = fixture();
  earnEventGifts(f);
  for (const gift of gifts) {
    const before = f.store.find(f.a.token).wallet[gift.currency];
    const input = {
      action: "gift",
      targetId: f.b.profile.id,
      giftId: gift.id,
      confirmed: true,
      requestId: randomUUID(),
      price: 0,
    };
    f.action(f.a, input);
    assert.equal(f.action(f.a, input).replay, true);
    assert.equal(f.store.find(f.a.token).wallet[gift.currency], before - gift.price);
    assert.equal(
      f.store.publicPlayer(f.b.profile.id).social.gifts.find((g) => g.id === gift.id).count,
      1,
    );
  }
  const gift = gifts[0];
  f.store.find(f.a.token).wallet.coins = 0;
  assert.throws(
    () =>
      f.action(f.a, { action: "gift", targetId: f.b.profile.id, giftId: gift.id, confirmed: true }),
    /Недостаточно/,
  );
  assert.throws(
    () =>
      f.action(f.a, { action: "gift", targetId: f.a.profile.id, giftId: gift.id, confirmed: true }),
    /Недостаточно/,
  );
});
test("Брак и подарки: отказ записи откатывает обе стороны; повтор после перезапуска не дублирует", (t) => {
  const filePath = path.join(temporary(t, "social"), "profiles.json"),
    f = fixture(filePath),
    i = f.invite();
  const input = { action: "accept", invitationId: i.id, requestId: randomUUID() },
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.action(f.b, input), /disk full/);
  assert.equal(f.store.find(f.a.token).social.marriage, null);
  f.store.save = save;
  f.action(f.b, input);
  const gift = {
    action: "gift",
    targetId: f.b.profile.id,
    giftId: gifts[0].id,
    confirmed: true,
    requestId: randomUUID(),
  };
  const before = structuredClone(f.store.data);
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.action(f.a, gift), /disk full/);
  assert.deepEqual(f.store.data, before);
  f.store.save = save;
  f.action(f.a, gift);
  const disk = new ProfileStore({ filePath, now: f.store.now });
  assert.equal(disk.socialAction(f.a.token, gift).replay, true);
  assert.equal(disk.socialAction(f.b.token, input).replay, true);
  assert.equal(disk.publicPlayer(f.b.profile.id).social.gifts[0].count, 1);
  assert.equal(disk.find(f.a.token).activity.values.loving, 1);
});
test("Каждый подарок исчезает ровно через 48 часов, повтор запроса не продлевает срок", (t) => {
  const filePath = path.join(temporary(t, "gift-expiry"), "profiles.json"),
    f = fixture(filePath);
  const input = {
    action: "gift",
    targetId: f.b.profile.id,
    giftId: gifts[0].id,
    confirmed: true,
    requestId: randomUUID(),
  };
  f.action(f.a, input);
  const first = f.store.publicPlayer(f.b.profile.id).social.gifts[0].history[0];
  assert.equal(first.expiresAt - first.at, 48 * 3600000);
  f.advance(24 * 3600000);
  f.action(f.a, { ...input, requestId: randomUUID() });
  f.advance(24 * 3600000 - 1);
  assert.equal(f.store.publicPlayer(f.b.profile.id).social.gifts[0].count, 2);
  f.advance(1);
  assert.equal(f.store.publicPlayer(f.b.profile.id).social.gifts[0].count, 1);
  const saved = structuredClone(f.store.data);
  assert.equal(f.action(f.a, input).replay, true);
  assert.equal(f.store.socialState(f.b.token).social.gifts[0].count, 1);
  assert.deepEqual(f.store.data, saved);
  const restored = new ProfileStore({ filePath, now: f.store.now });
  assert.equal(restored.publicPlayer(f.b.profile.id).social.gifts[0].count, 1);
  f.advance(24 * 3600000);
  assert.deepEqual(restored.publicPlayer(f.b.profile.id).social.gifts, []);
  assert.equal(restored.find(f.b.token).social.gifts[0].count, 2, "История получения сохраняется");
  assert.deepEqual(f.store.data, saved, "Чтение витрины не изменяет сохранения");
});
test("Витрина сохраняет все свежие подарки сверх 20, старые не возвращаются при новом подарке", () => {
  const f = fixture();
  f.store.find(f.a.token).wallet.coins = 100000;
  const input = { action: "gift", targetId: f.b.profile.id, giftId: gifts[0].id, confirmed: true };
  for (let i = 0; i < 25; i++) f.action(f.a, input);
  assert.equal(f.store.publicPlayer(f.b.profile.id).social.gifts[0].count, 25);
  assert.equal(f.store.find(f.b.token).social.gifts[0].history.length, 25);
  f.advance(48 * 3600000);
  assert.deepEqual(f.store.publicPlayer(f.b.profile.id).social.gifts, []);
  f.action(f.a, input);
  assert.equal(f.store.publicPlayer(f.b.profile.id).social.gifts[0].count, 1);
  assert.equal(f.store.find(f.b.token).social.gifts[0].count, 26);
  assert.equal(f.store.find(f.b.token).social.gifts[0].history.length, 20);
  const selfGift = gifts.find((g) => g.currency === "bucks");
  f.action(f.a, { ...input, targetId: f.a.profile.id, giftId: selfGift.id });
  f.advance(48 * 3600000);
  assert.deepEqual(f.store.view(f.store.find(f.a.token)).social.gifts, []);
});
test("Подарки себе: все валюты, точная цена, повтор и восстановление после ошибки записи", (t) => {
  const filePath = path.join(temporary(t, "self-gifts"), "profiles.json"),
    f = fixture(filePath);
  earnEventGifts(f);
  f.store.save(f.store.data);
  for (const gift of gifts) {
    const input = {
      action: "gift",
      targetId: f.a.profile.id,
      giftId: gift.id,
      confirmed: true,
      requestId: randomUUID(),
      currency: "bucks",
      price: 0,
    };
    const before = structuredClone(f.store.data),
      wallet = { ...f.store.find(f.a.token).wallet };
    const save = f.store.save;
    f.store.save = () => {
      throw Error("disk full");
    };
    assert.throws(() => f.action(f.a, input), /disk full/);
    assert.deepEqual(f.store.data, before);
    f.store.save = save;
    f.action(f.a, input);
    assert.equal(f.action(f.a, input).replay, true);
    const disk = new ProfileStore({ filePath, now: f.store.now });
    assert.equal(disk.socialAction(f.a.token, input).replay, true);
    assert.deepEqual(disk.find(f.a.token).wallet, {
      ...wallet,
      [gift.currency]: wallet[gift.currency] - gift.price,
    });
    const received = disk.publicPlayer(f.a.profile.id).social.gifts.find((g) => g.id === gift.id);
    assert.equal(received.count, 1);
    assert.equal(received.history.length, 1);
    assert.equal(received.history[0].fromId, f.a.profile.id);
    assert.equal(disk.find(f.a.token).activity.values.loving, 0);
  }
  const gift = gifts.find((g) => g.currency === "bucks"),
    input = { action: "gift", targetId: f.a.profile.id, giftId: gift.id };
  assert.throws(() => f.action(f.a, input), /Подтверди/);
  f.store.find(f.a.token).wallet.bucks = gift.price - 1;
  const before = structuredClone(f.store.data);
  assert.throws(() => f.action(f.a, { ...input, confirmed: true }), /Недостаточно/);
  assert.deepEqual(f.store.data, before);
});
test("HTTP social: авторизация, чужой Origin и приглашение доступны только адресату", async (t) => {
  const app = createGameServer({ autoTick: false });
  t.after(() => app.close());
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  assert.equal((await fetch(url + "/api/social")).status, 401);
  const res = await fetch(url + "/api/profile"),
    cookie = res.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(url + "/api/social", { headers: { Cookie: cookie } })).status, 200);
  const body = { action: "gift", requestId: randomUUID(), confirmed: true };
  const denied = await fetch(url + "/api/social/action", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://evil.invalid" },
    body: JSON.stringify(body),
  });
  assert.equal(denied.status, 403);
});
