"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ProfileStore } = require('../../src/server/profiles/profile-store');
const { OwnerService } = require('../../src/server/admin/owner-service');
const { GameGrants, acknowledge, validate } = require('../../src/server/admin/game-grants');
function fixture(t) {
  let at = Date.UTC(2026, 10, 15, 9);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-player-tabs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'profiles.json');
  const profiles = new ProfileStore({ filePath, now: () => at });
  const accounts = Array.from({ length: 4 }, () => profiles.open());
  const owner = profiles.find(accounts[0].token), access = { isOwner: p => p?.id === owner.id };
  const busy = new Set(), online = new Set(); profiles.isOnline = id => online.has(id);
  const options = { profiles, access, inArena: id => busy.has(id), now: () => at };
  const service = new OwnerService(options), grants = new GameGrants(options);
  const input = { title: 'Спасибо за тест!', message: 'Подарок всем игрокам.', rewards: [
    { kind: 'currency', id: 'crystals', amount: 100 }, { kind: 'booster', id: 'candy', amount: 2 },
    { kind: 'account', id: 'vip', amount: 3 },
  ] };
  const prepare = () => ({ previewId: grants.preview(owner, input).previewId, requestId: randomUUID(), confirmed: true });
  return { profiles, accounts, owner, access, service, grants, busy, online, input, prepare, filePath,
    advance: ms => at += ms, now: () => at };
}
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
test('directory sorts actual online humans, searches unicode, and filters current violations without writing', t => {
  const f = fixture(t), people = f.accounts.map(a => f.profiles.find(a.token));
  ['Зоя', 'Mr Lāйfēr', 'Аня', 'Бот'].forEach((name, i) => { people[i].name = name; people[i].level = [20,12,7,50][i]; });
  people[3].testBot = true;
  f.online.add(people[0].id); f.online.add(people[3].id); f.busy.add(people[1].id);
  const before = structuredClone(f.profiles.data);
  assert.deepEqual(f.service.players('', 1, { view:'online',sort:'level',order:'asc' }).players.map(p=>p.name), ['Mr Lāйfēr','Зоя']);
  assert.equal(f.service.players('lāй', 1, {view:'online'}).total, 1);
  assert.deepEqual(f.profiles.data, before);
  people[0].chatModeration = { version:1, flood:{count:2,lastAt:f.now()},profanity:{count:0,lastAt:0},mute:null };
  people[1].moderation = {version:1,ban:{reason:'Тест',by:f.owner.id,at:f.now()-1,until:null}};
  assert.equal(f.service.players('',1,{view:'violators'}).total,2);
  f.advance(7*86400000); assert.deepEqual(f.service.players('',1,{view:'violators'}).players.map(p=>p.id),[people[1].id]);
  assert.throws(()=>f.service.players('',1,{view:'invalid'}),/параметры/);
});
test('registrations use saved account dates, exclude bots, page and sort without writing profiles', t => {
  const f = fixture(t), people = f.accounts.map(a => f.profiles.find(a.token));
  people[0].name = 'Зоя'; people[1].name = 'Mr Lāйfēr'; people[2].name = 'Без даты'; people[3].testBot = true;
  people[0].activity.registeredAt = f.now() - 2000;
  people[1].activity.registeredAt = f.now() - 1000;
  delete people[2].activity.registeredAt;
  f.online.add(people[0].id); f.busy.add(people[0].id);
  let before = structuredClone(f.profiles.data);
  const read = options => f.service.players('', 1, {view:'registrations', ...options});
  assert.deepEqual(read().players.map(p=>p.id), [people[1].id, people[0].id, people[2].id]);
  assert.deepEqual(read({order:'asc'}).players.map(p=>p.id), [people[0].id, people[1].id, people[2].id]);
  assert.equal(read().players[0].registeredAt, people[1].activity.registeredAt);
  assert.equal(read().players[2].registeredAt, null);
  assert.equal(f.service.players('lāй', 1, {view:'registrations'}).total, 1);
  assert.equal(f.service.players(people[1].id, 1, {view:'registrations'}).total, 1);
  assert.deepEqual(f.profiles.data, before);
  people[2].activity.registeredAt = f.now();
  for(let i=0;i<22;i++) { f.advance(1); f.profiles.open(); }
  before = structuredClone(f.profiles.data);
  const first=read(), second=f.service.players('', 99, {view:'registrations'});
  assert.equal(first.total,25);assert.equal(first.players.length,20);assert.equal(second.page,2);assert.equal(second.players.length,5);
  assert.equal(new Set([...first.players,...second.players].map(p=>p.id)).size,25);
  assert.deepEqual(f.profiles.data,before);
  assert.throws(()=>read({sort:'password'}),/параметры/);
  assert.throws(()=>read({order:'invalid'}),/параметры/);
  assert.throws(()=>f.service.players('',1,{view:'online',sort:'registeredAt'}),/параметры/);
  assert(!Object.hasOwn(f.service.players().players[0],'registeredAt'));
});

test('mass gift targets real accounts including offline, defers arena, and survives restart/replay/ack', t => {
  const f=fixture(t), bot=f.profiles.find(f.accounts[3].token); bot.testBot=true;
  f.busy.add(f.profiles.find(f.accounts[1].token).id);
  const command=f.prepare(), before=structuredClone(f.profiles.data);
  freeze(f.profiles.data);
  const created=f.grants.create(f.owner,command); assert.equal(created.campaign.total,3);
  assert.equal(f.grants.create(f.owner,command).duplicate,true);
  assert.equal(f.grants.create(f.owner,{...command,requestId:randomUUID()}).duplicate,true);
  f.grants.deliver();
  assert.equal(f.grants.view(f.owner).campaigns[0].delivered,2);assert.equal(f.grants.view(f.owner).campaigns[0].pending,1);
  const restored=new ProfileStore({filePath:f.filePath,now:f.now}), grants=new GameGrants({profiles:restored,access:f.access,now:f.now});
  assert.equal(grants.create(f.owner,command).duplicate,true);grants.deliver();assert.equal(grants.deliver(),false);
  for(let i=0;i<3;i++){
    const p=restored.find(f.accounts[i].token), old=Object.values(before.profiles).find(q=>q.id===p.id);
    assert.equal(p.wallet.crystals,old.wallet.crystals+100);assert.equal(p.inventory.candy,(old.inventory.candy||0)+2);
    assert.equal(p.account.vipUntil,f.now()+3*86400000);assert.equal(p.gameGiftNotices.length,1);
    assert.deepEqual(p.quests,old.quests);assert.deepEqual(p.progress,old.progress);
  }
  assert.deepEqual(restored.byId(bot.id),bot);
  const id=created.campaign.id, ack={id,requestId:randomUUID()};
  acknowledge(restored,f.accounts[0].token,ack);acknowledge(restored,f.accounts[0].token,ack);
  assert.equal(restored.find(f.accounts[0].token).gameGiftNotices.length,0);
  assert.equal(restored.find(f.accounts[1].token).gameGiftNotices.length,1);
  assert.equal(restored.publicPlayer(f.owner.id).gameGiftNotices,undefined);
  assert.equal(grants.view(f.owner).campaigns[0].delivered,3);validate(restored.data);
});
test('gift snapshot excludes accounts created later, and only owner can preview/send/read/retry', t=>{
  const f=fixture(t), command=f.prepare(), other=f.profiles.find(f.accounts[1].token);
  const newcomer=f.profiles.open();f.grants.create(f.owner,command);f.grants.deliver();
  assert.equal(f.profiles.find(newcomer.token).gameGiftNotices,undefined);
  for(const fn of [()=>f.grants.preview(other,f.input),()=>f.grants.create(other,command),()=>f.grants.view(other),()=>f.grants.retry(other,{})])assert.throws(fn,e=>e.status===403);
  assert.throws(()=>f.grants.create(f.owner,{...command,confirmed:false}),/Подтверди/);
  const fresh=f.prepare();f.advance(600001);assert.throws(()=>f.grants.create(f.owner,fresh),/устарел/);
});
test('failed durable save does not publish rewards, notices or delivery receipts',t=>{
  const f=fixture(t);f.grants.create(f.owner,f.prepare());
  const before=structuredClone(f.profiles.data), bytes=fs.readFileSync(f.filePath);
  fs.mkdirSync(f.filePath+'.tmp');assert.throws(()=>f.grants.deliver());
  assert.deepEqual(f.profiles.data,before);assert.deepEqual(fs.readFileSync(f.filePath),bytes);
  fs.rmdirSync(f.filePath+'.tmp');f.grants.deliver();assert.equal(f.grants.view(f.owner).campaigns[0].delivered,4);
});
test('bounded gift delivery records individual balance failure and retries only failed recipients',t=>{
  const f=fixture(t), target=f.profiles.find(f.accounts[1].token);target.wallet.crystals=Number.MAX_SAFE_INTEGER;
  f.profiles.save(f.profiles.data);f.grants.create(f.owner,f.prepare());f.grants.deliver(2);
  let c=f.grants.view(f.owner).campaigns[0];assert.equal(c.delivered+c.errors.length,2);
  f.grants.deliver();c=f.grants.view(f.owner).campaigns[0];assert.equal(c.errors.length,1);assert.equal(c.delivered,3);
  const draft=structuredClone(f.profiles.data), p=Object.values(draft.profiles).find(p=>p.id===target.id);p.wallet.crystals=0;f.profiles.save(draft);
  const retry={id:c.id,requestId:randomUUID(),confirmed:true};f.grants.retry(f.owner,retry);f.grants.retry(f.owner,retry);f.grants.deliver();
  c=f.grants.view(f.owner).campaigns[0];assert.equal(c.delivered,4);assert.equal(c.errors.length,0);assert.equal(f.profiles.byId(target.id).wallet.crystals,100);
  assert.equal(f.profiles.byId(f.owner.id).gameGiftNotices.length,1);
});
