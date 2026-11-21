"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs"), path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { prepareBronzePopulation } = require("../../src/server/testing/bronze-population");
const { LobbyBots } = require("../../src/server/testing/lobby-bots");
const { createGameServer } = require("../../src/server/game-server");
const { temporary } = require("../temp");

test("Bronze population preserves humans, creates 1280 unique bots in 128 bronze clans, repeats safely", () => {
  const store = new ProfileStore(), human = store.open();
  const before = structuredClone(store.find(human.token));
  const result = prepareBronzePopulation(store.data);
  assert.equal(result.summary.addedBots, 1280);
  assert.equal(result.summary.addedClans, 128);
  assert.deepEqual(Object.values(result.data.profiles).find(p => p.id === before.id), before);
  assert.equal(new Set(result.sessions.map(s => s.id)).size, 1280);
  assert.ok(Object.values(result.data.clans).every(c => c.members.length === 10 && c.competition.league === 0));
  const levels = result.sessions.map(s => Object.values(result.data.profiles).find(p => p.id === s.id).level);
  assert.equal(Math.min(...levels), 12);
  assert(result.sessions.every(s => ["male", "female"].includes(Object.values(result.data.profiles).find(p => p.id === s.id).personal.gender)));
  assert.equal(Math.max(...levels), 500);
  const repeat = prepareBronzePopulation(result.data);
  assert.equal(repeat.sessions.length, 0);
  assert.deepEqual(repeat.data, result.data);
});

test("Lobby bots spend real balances via HTTP; preserve human and active arena profiles", async t => {
  const dir = temporary(t, "lobby-bots"), store = new ProfileStore();
  const human = store.open(), before = structuredClone(store.find(human.token));
  const result = prepareBronzePopulation(store.data, Date.now(), 2);
  store.save(result.data);
  const configPath = path.join(dir, "bots.json"), sessionsPath = path.join(dir, "sessions.json");
  fs.writeFileSync(configPath, JSON.stringify({ enabled: true, lobbyEnabled: true }));
  fs.writeFileSync(sessionsPath, JSON.stringify(result.sessions));
  const app = createGameServer({ profiles: store, autoTick: false });
  app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
  t.after(() => app.close());
  const busyId = result.sessions[0].id;
  const bots = new LobbyBots({ profiles: store, configPath, sessionsPath,
    baseUrl: () => "http://127.0.0.1:" + app.httpServer.address().port,
    occupied: id => id === busyId, enabled: () => true, random: () => 0 });
  const activeBefore = structuredClone(store.byId(busyId));
  await bots.act();
  assert.equal(bots.stats.gifts, 1);
  assert.equal(store.byId(result.sessions[1].id).wallet.coins, 1750);
  assert.deepEqual(store.byId(busyId), activeBefore);
  assert.deepEqual(store.find(human.token), before);
  await bots.act(); await bots.act();
  assert.equal(bots.stats.outfits, 1);
  // Pick a non-head and allow clan departure/join through normal service.
  bots.cursor = 19;
  await bots.act();
  assert.equal(bots.stats.transfers, 0); // Exactly ten: do not make a clan ineligible.
  assert.equal(bots.busy.size, 0);
  fs.writeFileSync(configPath, JSON.stringify({ enabled: false, lobbyEnabled: true }));
  const stopped = structuredClone(store.data);
  await bots.act();
  assert.deepEqual(store.data, stopped);
  await bots.close();
});

test("Server lobby bots pause without humans, resume on presence, and stop after presence expires", async t => {
 const dir=temporary(t,'lobby-bots-presence');let at=Date.now();const store=new ProfileStore({now:()=>at}),human=store.open();
 const seeded=prepareBronzePopulation(store.data,at,1);store.save(seeded.data);
 const configPath=path.join(dir,'bots.json'),sessionsPath=path.join(dir,'sessions.json');
 fs.writeFileSync(configPath,JSON.stringify({enabled:true,lobbyEnabled:true}));fs.writeFileSync(sessionsPath,JSON.stringify(seeded.sessions));
 const app=createGameServer({profiles:store,wallNow:()=>at,autoTick:false,testBots:{configPath,sessionsPath}});
 await new Promise(r=>app.httpServer.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const balances=()=>seeded.sessions.map(s=>store.byId(s.id).wallet.coins),before=balances();
 await new Promise(r=>setTimeout(r,5300));assert.deepEqual(balances(),before,'empty game must not generate bot transactions');
 const response=await fetch('http://127.0.0.1:'+app.httpServer.address().port+'/api/presence',{headers:{cookie:'sferorumiya_session='+human.token}});assert.equal(response.status,200);
 await new Promise(r=>setTimeout(r,5300));assert.notDeepEqual(balances(),before,'human presence resumes ordinary bot actions');
 at+=60001;const paused=balances();await new Promise(r=>setTimeout(r,5300));assert.deepEqual(balances(),paused,'expired presence pauses again');
});

test("Lobby event bots claim completed orders and exchange tokens through the real HTTP transaction", async t=>{
 const fixture=require("../helpers/black-friday-fixture")(),{store,manager}=fixture;
 const {MARKER}=require("../../src/server/testing/arena-test-bots");
 const user=fixture.user,p=store.find(user.token);p.testBot=MARKER;
 fixture.life();
 const dir=temporary(t,"event-bots"),app=createGameServer({profiles:store,events:manager,wallNow:fixture.now,autoTick:false});
 app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");t.after(()=>app.close());
 const bots=new LobbyBots({profiles:store,baseUrl:()=>"http://127.0.0.1:"+app.httpServer.address().port,random:()=>0});
 const s={id:p.id,token:user.token};
 const ready=fixture.view().orders.filter(o=>!o.claimed&&o.progress>=o.target);assert(ready.length);
 const initial=fixture.view().completedOrders;
 assert(await bots.eventAction(s,store.find(user.token)));assert.equal(fixture.view().completedOrders,initial+1);
 // Repeated visits can only claim the remaining actually completed orders.
 for(let i=1;i<ready.length;i++)await bots.eventAction(s,store.find(user.token));
 assert.equal(fixture.view().completedOrders,initial+ready.length);
 const before=fixture.view().tokens;assert(before>0);
 assert(await bots.eventAction(s,store.find(user.token)));assert(fixture.view().tokens<before);
 assert.equal(store.find(user.token).testBot,MARKER);
 await bots.close();
});
test("Offline bot names are unique, preserve human profiles and repeat without changes",()=>{
 const {renamePopulation}=require("../../src/server/testing/population-names"),store=new ProfileStore(),human=store.open();
 const seed=prepareBronzePopulation(store.data),r=renamePopulation(seed.data);
 const bots=Object.values(r.data.profiles).filter(p=>p.testBot);
 assert.equal(new Set(bots.map(p=>p.name)).size,bots.length);assert(bots.every(p=>!/Бот\s?\d/i.test(p.name)&&p.name.length<=16));
 assert(bots.some(p=>!p.name.includes(' ')));assert(bots.some(p=>p.name.includes(' ')));
 assert(bots.some(p=>/[A-Za-z]/.test(p.name)));assert(bots.some(p=>/[А-Яа-яЁё]/.test(p.name)));
 assert.deepEqual([...new Set(Object.values(r.data.clans).map(c=>[...c.prefix].length))].sort(),[1,2,3,4]);
 assert.deepEqual(r.data.profiles[Object.keys(store.data.profiles)[0]],store.find(human.token));
 assert.equal(new Set(Object.values(r.data.clans).map(c=>c.name)).size,128);
 assert.deepEqual(renamePopulation(r.data).data,r.data);
});

