"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { OwnerAccess } = require("../../src/server/admin/owner-access");
const { OwnerService } = require("../../src/server/admin/owner-service");
const { activeBan } = require("../../src/server/admin/moderation");
const { reservedName } = require("../../src/server/admin/reserved-name");
function fixture(t) {
  let time = Date.now();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "owner-admin-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "profiles.json"),
    profiles = new ProfileStore({ filePath, now: () => time });
  const a = profiles.open(),
    b = profiles.open(),
    owner = profiles.find(a.token),
    target = profiles.find(b.token);
  const access = new OwnerAccess({ ownerId: owner.id, now: () => time });
  profiles.ownerId = owner.id;
  const service = new OwnerService({ profiles, access, now: () => time });
  const command = (extra) => ({
    action: "wallet",
    currency: "coins",
    amount: 100,
    reason: "Проверка начисления",
    targetId: target.id,
    revision: profiles.byId(target.id).revision,
    moderationRevision: profiles.byId(target.id).moderation?.version || 0,
    requestId: randomUUID(),
    ...extra,
  });
  return {
    profiles,
    owner,
    target,
    service,
    access,
    command,
    filePath,
    directory,
    a,
    b,
    advance: (ms) => (time += ms),
  };
}

test('owner greatness grant is exact, preserves other progress, awards titles and replays once after restart', t => {
  const f=fixture(t), before=structuredClone(f.profiles.byId(f.target.id));
  const cmd=f.command({action:'greatness',amount:2000000});
  const committed=f.profiles.data, save=f.profiles.save;
  f.profiles.save=()=>{throw Error('disk failure');};
  assert.throws(()=>f.service.apply(f.owner,cmd),/disk failure/);
  assert.strictEqual(f.profiles.data,committed);assert.deepEqual(f.profiles.byId(f.target.id),before);
  f.profiles.save=save;
  assert.throws(()=>f.service.apply(f.target,cmd));
  f.service.apply(f.owner,cmd);
  const p=f.profiles.byId(f.target.id);
  const expected=structuredClone(before);expected.greatness+=2000000;
  require('../../src/server/progression/title-chest-rewards').awardTitles(expected,f.profiles.now());
  assert.equal(p.greatness,expected.greatness);assert(p.honors.claimed>before.honors.claimed);
  for(const field of ['wallet','inventory','progress','clanId','alchemy','account'])assert.deepEqual(p[field],before[field],field);
  assert.equal(f.service.apply(f.owner,cmd).duplicate,true);
  const restored=new ProfileStore({filePath:f.filePath});
  assert.equal(new OwnerService({profiles:restored,access:f.access}).apply(f.owner,cmd).duplicate,true);
  assert.equal(restored.byId(p.id).greatness,p.greatness);
});

test('admin edits share unrelated profiles and isolate frozen audit/receipts on a failed save', t => {
  const f=fixture(t), idle=f.profiles.open();
  f.service.apply(f.owner,f.command({amount:1}));
  const previous=f.profiles.data, before=structuredClone(previous), other=f.profiles.find(idle.token), save=f.profiles.save;
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}};
  freeze(previous);
  const cmd=f.command({action:'inventory',boosterId:'candy',amount:5});
  f.profiles.save=()=>{throw Error('disk failure');};
  assert.throws(()=>f.service.apply(f.owner,cmd),/disk failure/);
  assert.strictEqual(f.profiles.data,previous);assert.deepEqual(previous,before);
  f.profiles.save=save;f.service.apply(f.owner,cmd);
  assert.deepEqual(previous,before);assert.strictEqual(f.profiles.find(idle.token),other);
  assert.equal(f.profiles.data.administration.audit.length,before.administration.audit.length+1);
  assert.equal(f.service.apply(f.owner,cmd).duplicate,true);
});

test('admin level edit preserves progress and possessions, saves atomically and skips earned-level rewards', t => {
  const f = fixture(t), xp = require('../../src/server/progression/experience-progression');
  const before = structuredClone(f.profiles.byId(f.target.id));
  const cmd = f.command({ action: 'level', level: 126 });
  f.service.apply(f.owner, cmd);
  const p = f.profiles.byId(f.target.id);
  assert.equal(p.level, 126); assert.equal(p.progress.xp, xp.xpForLevel(126));
  assert.equal(p.progress.arenaXpTarget, null);
  for (const key of ['wallet', 'inventory', 'account', 'activity', 'quests', 'greatness', 'promotions', 'easter', 'blackFriday', 'alchemy'])
    assert.deepEqual(p[key], before[key], key);
  assert.deepEqual(p.progress, { ...before.progress, xp: xp.xpForLevel(126), arenaXpTarget: null });
  assert.deepEqual(p.roulette, { ...before.roulette, levelGrantedThrough: 126 });
  assert.deepEqual(f.profiles.data.administration.audit[0].before, { level: 1, xp: 0 });
  assert.deepEqual(f.profiles.data.administration.audit[0].after, { level: 126, xp: xp.xpForLevel(126) });
  assert.equal(f.service.apply(f.owner, cmd).duplicate, true);
  const restored = new ProfileStore({ filePath: f.filePath });
  assert.equal(restored.byId(p.id).progress.xp, xp.xpForLevel(126));
  assert.equal(new OwnerService({ profiles: restored, access: f.access }).apply(f.owner, cmd).duplicate, true);
  const arena = structuredClone(p);
  xp.applyEvent(arena, { type: 'lifeStarted', lifeId: 'level-edit-test' }, Date.now());
  assert.equal(arena.progress.arenaXpTarget, xp.xpForLevel(127));
  assert.equal(arena.roulette.tickets, before.roulette.tickets);
  assert.deepEqual(arena.wallet, before.wallet);
});

test('admin lower level unequips locked boosters without removing inventory or previously earned tickets', t => {
  const f = fixture(t), p = f.profiles.byId(f.target.id);
  const xp = require('../../src/server/progression/experience-progression');
  const { BOOSTERS } = require('../../src/server/boosters/booster-catalog');
  const locked = [...BOOSTERS.values()].find(b => b.ready && b.tier !== 'potion' && b.useLevel > 1);
  p.level = 126; p.progress.xp = xp.xpForLevel(126) + 40; p.progress.arenaXpTarget = xp.xpForLevel(127);
  p.progress.levelOffers = { 100: Date.now() };
  p.roulette.levelGrantedThrough = 126; p.inventory[locked.id] = 9; p.quickSlots = [locked.id, null, null, 'candy'];
  const inventory = structuredClone(p.inventory);
  f.service.apply(f.owner, f.command({ action: 'level', level: 2 }));
  const changed = f.profiles.byId(p.id);
  assert.equal(changed.progress.xp, 500); assert.deepEqual(changed.quickSlots, [null, null, null, null]);
  assert.deepEqual(changed.inventory, inventory); assert.equal(changed.roulette.levelGrantedThrough, 126);
  assert.deepEqual(changed.progress.levelOffers, {});
  const snapshot = structuredClone(f.profiles.data);
  assert.throws(() => f.service.apply(f.owner, f.command({ action: 'level', level: 2 })), /уже установлен/);
  assert.deepEqual(f.profiles.data, snapshot);
});

test('admin level edit rejects invalid, stale, arena, unsettled and clan-ineligible requests', t => {
  const f = fixture(t);
  for (const level of [0, -1, 1.5, '12', null, Number.MAX_SAFE_INTEGER, Infinity])
    assert.throws(() => f.service.apply(f.owner, f.command({ action: 'level', level })), /Уровень|уровень/);
  assert.throws(() => f.service.apply(f.target, f.command({ action: 'level', level: 12 })), /Нет права/);
  assert.throws(() => f.service.apply(f.owner, f.command({ action: 'level', level: 12, revision: 999 })), /изменились/);
  f.service.inArena = () => true;
  assert.throws(() => f.service.apply(f.owner, f.command({ action: 'level', level: 12 })), /выйти с арены/);
  f.service.inArena = () => false;
  const p = f.profiles.byId(f.target.id);
  p.progress.session = { id: 'pending' };
  assert.throws(() => f.service.apply(f.owner, f.command({ action: 'level', level: 12 })), /сохранения прогресса/);
  p.progress.session = null; p.clanId = 'existing-clan';
  assert.throws(() => f.service.apply(f.owner, f.command({ action: 'level', level: 2 })), /ниже 12/);
});

test('admin level disk failure leaves all profile fields and receipt untouched', t => {
  const f = fixture(t), before = structuredClone(f.profiles.data), bytes = fs.readFileSync(f.filePath);
  const command = f.command({ action: 'level', level: 120 });
  fs.mkdirSync(f.filePath + '.tmp');
  assert.throws(() => f.service.apply(f.owner, command));
  assert.deepEqual(f.profiles.data, before); assert.deepEqual(fs.readFileSync(f.filePath), bytes);
  fs.rmdirSync(f.filePath + '.tmp');
  f.service.apply(f.owner, command); assert.equal(f.profiles.byId(f.target.id).level, 120);
});

test('administrative notices persist with money, boosters and statuses; acknowledge is private and replay safe', t=>{
  const f=fixture(t), notices=require('../../src/server/admin/adjustment-notices');
  const cmds=[{amount:100},{amount:-20},{action:'inventory',boosterId:'candy',amount:3},{action:'inventory',boosterId:'candy',amount:-2},{action:'account',kind:'vip',days:7},{action:'account',kind:'vip',days:0}];
  for(const fields of cmds){const cmd=f.command(fields);f.service.apply(f.owner,cmd);f.service.apply(f.owner,cmd);}
  const rows=f.profiles.view(f.profiles.find(f.b.token)).administrativeNotices;
  assert.equal(rows.length,6);assert.equal(new Set(rows.map(n=>n.id)).size,6);
  rows.forEach((n,i)=>{assert.match(n.id,/^[2-9A-HJ-NP-Z]{6}$/);assert.equal(n.actorName,'Killex');assert.equal(n.reason,'Проверка начисления');assert.equal(f.profiles.data.administration.audit[i].operationId,n.id);});
  assert.deepEqual(rows.slice(0,4).map(n=>n.amount),[100,-20,3,-2]);assert.equal(rows[5].after,0);
  assert.equal(f.profiles.publicPlayer(f.target.id).administrativeNotices,undefined);
  notices.acknowledge(f.profiles,f.a.token,{id:rows[0].id,requestId:randomUUID()});assert.equal(f.profiles.find(f.b.token).administrativeNotices.length,6);
  const restored=new ProfileStore({filePath:f.filePath});assert.equal(restored.find(f.b.token).administrativeNotices.length,6);
  const input={id:rows[0].id,requestId:randomUUID()};notices.acknowledge(restored,f.b.token,input);notices.acknowledge(restored,f.b.token,input);
  const again=new ProfileStore({filePath:f.filePath});assert.equal(again.find(f.b.token).administrativeNotices.length,5);assert.equal(again.data.administration.audit.length,6);
});
test("Owner adjustments, audit and receipts persist atomically; replay never grants twice", (t) => {
  const f = fixture(t),
    before = structuredClone(f.profiles.data),
    cmd = f.command({});
  const result = f.service.apply(f.owner, cmd);
  assert.equal(result.player.wallet.coins, f.target.wallet.coins + 100);
  assert.equal(f.service.apply(f.owner, cmd).duplicate, true);
  assert.equal(f.profiles.data.administration.audit.length, 1);
  const restored = new ProfileStore({ filePath: f.filePath });
  const service = new OwnerService({ profiles: restored, access: f.access });
  assert.equal(service.apply(f.owner, cmd).duplicate, true);
  assert.deepEqual(
    f.profiles.byId(f.owner.id),
    Object.values(before.profiles).find((p) => p.id === f.owner.id),
  );
  assert.deepEqual(f.profiles.byId(f.target.id).progress, f.target.progress);
  assert.throws(() => service.apply(f.owner, { ...cmd, amount: 101 }), /уже использован/);
  assert.throws(() => service.apply(f.owner, f.command({ revision: 0 })), /изменились/);
});
test("A disk failure cannot grant currency or append an audit receipt", (t) => {
  const f = fixture(t),
    before = structuredClone(f.profiles.data),
    bytes = fs.readFileSync(f.filePath),
    cmd = f.command({});
  fs.mkdirSync(f.filePath + ".tmp");
  assert.throws(() => f.service.apply(f.owner, cmd));
  assert.deepEqual(f.profiles.data, before);
  assert.deepEqual(fs.readFileSync(f.filePath), bytes);
  fs.rmdirSync(f.filePath + ".tmp");
  f.service.apply(f.owner, cmd);
  assert.equal(f.profiles.data.administration.audit.length, 1);
});
test("Owner-only, bounds, reserved names, inventory and statuses", (t) => {
  const f = fixture(t);
  assert.throws(() => f.service.apply(f.target, f.command({})), /Нет права/);
  assert.throws(() => f.service.apply(f.owner, f.command({ amount: -999999 })), /отрицательным/);
  assert.throws(() => f.service.apply(f.owner, f.command({ amount: 1.5 })), /целое число/);
  assert.throws(
    () =>
      f.service.apply(
        f.owner,
        f.command({ action: "inventory", boosterId: "unknown_booster", amount: 1 }),
      ),
    /Выбери бустер/,
  );
  f.service.apply(f.owner, f.command({ action: "inventory", boosterId: "candy", amount: 3 }));
  f.profiles.byId(f.target.id).quickSlots = ["candy", null, null, null];
  f.service.apply(f.owner, f.command({ action: "inventory", boosterId: "candy", amount: -3 }));
  assert.equal(f.profiles.byId(f.target.id).quickSlots[0], null);
  f.service.apply(f.owner, f.command({ action: "account", kind: "premium", days: 7 }));
  const until = f.profiles.byId(f.target.id).account.premiumUntil;
  f.service.apply(f.owner, f.command({ action: "account", kind: "premium", days: 7 }));
  assert.equal(f.profiles.byId(f.target.id).account.premiumUntil, until + 7 * 86400000);
  f.service.apply(f.owner, f.command({ action: "account", kind: "premium", days: 0 }));
  assert.equal(f.profiles.byId(f.target.id).account.premiumUntil, 0);
  for (const name of [
    "Killex",
    "XXkIlLeXyy",
    "Ｋｉｌｌｅｘ",
    "K i l l e x",
    "Кіllех",
    "Ki\u200blléx",
  ]) {
    assert.equal(reservedName(name), true, name);
    assert.throws(
      () => f.service.apply(f.owner, f.command({ action: "rename", name })),
      { message: "Данный ник зарезервирован" },
    );
    assert.throws(
      () =>
        f.profiles.setPersonal(f.b.token, {
          name,
          gender: "male",
          expectedName: f.target.name,
          confirmed: true,
          requestId: randomUUID(),
        }),
      { message: "Данный ник зарезервирован" },
    );
  }
  f.service.apply(f.owner, f.command({ action: "rename", name: "Игрок" }));
  assert.equal(f.profiles.byId(f.target.id).name, "Игрок");
  f.profiles.setPersonal(f.a.token, {
    name: "Killex",
    gender: "male",
    expectedName: f.owner.name,
    confirmed: true,
    requestId: randomUUID(),
  });
});

test("all inventory tiers expose details and preserve atomic, bounded, replay-safe edits", t => {
  const f = fixture(t), catalog = require("../../src/server/boosters/booster-catalog").BOOSTERS;
  const view = f.service.player(f.target.id);
  assert.equal(view.boosters.length, catalog.size);
  for (const b of view.boosters) { assert(b.name && b.icon && b.effect); }
  for (const boosterId of ["clan_shield", "alchemy_strength", "easter_egg"]) {
    const before = f.profiles.byId(f.target.id).inventory[boosterId] || 0;
    const command = f.command({ action: "inventory", boosterId, amount: 2 });
    f.service.apply(f.owner, command); f.service.apply(f.owner, command);
    assert.equal(f.profiles.byId(f.target.id).inventory[boosterId], before + 2);
    assert.throws(() => f.service.apply(f.owner, f.command({ action: "inventory", boosterId, amount: -(before + 3) })), /Недостаточно/);
    f.service.apply(f.owner, f.command({ action: "inventory", boosterId, amount: -2 }));
    assert.equal(f.profiles.byId(f.target.id).inventory[boosterId], before);
  }
  f.service.inArena = () => true;
  assert.throws(() => f.service.apply(f.owner, f.command({ action: "inventory", boosterId: "clan_shield", amount: 1 })), /выйти с арены/);
});
test("Ban survives restart, expires on server time and uses independent moderation revision", (t) => {
  const f = fixture(t),
    cmd = f.command({ action: "ban", minutes: 60 });
  f.profiles.byId(f.target.id).revision += 10; // Арена обновила прогресс между открытием карточки и баном.
  const result = f.service.apply(f.owner, cmd);
  const savedBan = activeBan(new ProfileStore({ filePath: f.filePath }).byId(f.target.id));
  assert.ok(savedBan);
  assert.match(savedBan.id, /^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(f.profiles.data.administration.audit.at(-1).banId, savedBan.id);
  assert.equal(savedBan.byName, "Killex");
  assert.equal(f.service.apply(f.owner, cmd).eventId, result.eventId);
  assert.equal(f.profiles.byId(f.target.id).moderation.ban.id, savedBan.id);
  assert.throws(
    () =>
      f.service.apply(f.owner, f.command({ action: "ban", targetId: f.owner.id, minutes: null })),
    /владельца нельзя/,
  );
  assert.throws(
    () => f.service.apply(f.owner, f.command({ action: "unban", moderationRevision: 0 })),
    /изменились/,
  );
  f.advance(3600001);
  assert.equal(activeBan(f.profiles.byId(f.target.id), f.profiles.now()), null);
  f.service.apply(f.owner, f.command({ action: "unban" }));
  assert.equal(f.profiles.byId(f.target.id).moderation.ban, null);
});
test("Owner password setup, one session, expiry, local/HTTPS origin and CSRF", async (t) => {
  const f = fixture(t),
    access = f.access;
  const req = {
    method: "POST",
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
  };
  let cookie;
  const res = { setHeader: (_, v) => (cookie = v.split(";")[0]) };
  await assert.rejects(
    access.login(
      { password: "Owner password 2026", setupCode: "invalid" },
      req,
      res,
      f.owner,
      true,
    ),
    /Неверный ключ/,
  );
  const status = await access.login(
    { password: "Owner password 2026", setupCode: access.bootstrapCode },
    req,
    res,
    f.owner,
    true,
  );
  assert.equal(status.authenticated, true);
  assert.ok(!JSON.stringify(access.credentials).includes("Owner password"));
  req.headers.cookie = cookie;
  req.headers["x-owner-csrf"] = status.csrf;
  access.authorize(req);
  assert.throws(
    () => access.authorize({ ...req, headers: { ...req.headers, "x-owner-csrf": "wrong" } }),
    /Проверка запроса/,
  );
  assert.throws(
    () =>
      access.guard(
        { ...req, headers: { ...req.headers, origin: "https://evil.example" } },
        f.owner,
      ),
    /источник/,
  );
  assert.throws(
    () => access.guard({ ...req, socket: { remoteAddress: "192.168.1.2" } }, f.owner),
    /локально/,
  );
  const oldCookie = cookie;
  await access.login({ password: "Owner password 2026" }, req, res, f.owner);
  assert.equal(access.authenticated({ headers: { cookie: oldCookie } }), false);
  req.headers.cookie = cookie;
  assert.equal(access.authenticated(req), true);
  f.advance(15 * 60000 + 1);
  assert.equal(access.authenticated(req), false);
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      access.login({ password: "Wrong password 2026" }, req, res, f.owner),
      /Неверный пароль/,
    );
  await assert.rejects(
    access.login({ password: "Owner password 2026" }, req, res, f.owner),
    /15 минут/,
  );
});
test("Password survives restart and setup key cannot be replayed", async (t) => {
  const f = fixture(t),
    filePath = path.join(f.directory, "owner.json"),
    bootstrapPath = path.join(f.directory, "setup.json");
  const first = new OwnerAccess({ ownerId: f.owner.id, filePath, bootstrapPath });
  const req = {
    method: "POST",
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
  };
  const input = {
    password: "Password 2026 secure",
    setupCode: JSON.parse(fs.readFileSync(bootstrapPath)).setupCode,
  };
  await first.login(input, req, { setHeader() {} }, f.owner, true);
  const second = new OwnerAccess({ ownerId: f.owner.id, filePath, bootstrapPath });
  assert.equal(second.authenticated(req), false);
  await assert.rejects(second.login(input, req, { setHeader() {} }, f.owner, true), /недоступна/);
  assert.equal((await second.login(input, req, { setHeader() {} }, f.owner)).authenticated, true);
  assert.throws(
    () => new OwnerAccess({ ownerId: f.target.id, filePath, bootstrapPath }),
    /Неверный файл/,
  );
});
