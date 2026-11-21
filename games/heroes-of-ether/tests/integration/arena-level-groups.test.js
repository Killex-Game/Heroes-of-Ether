"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const policy = { ...require("../../config/arena-rooms.json"), levelGroups: true };

async function setup(t, filePath = null) {
  let at = 5000;
  const start = Date.now();
  const profiles = new ProfileStore({ filePath, now: () => start + at });
  const app = createGameServer({
    profiles,
    arenaPolicy: policy,
    autoTick: false,
    now: () => at,
    httpLimits: Object.fromEntries(
      Object.keys(require("../../src/server/http/request-rate-limits").HTTP_LIMITS).map((key) => [
        key,
        { capacity: 1000, perSecond: 1000 },
      ]),
    ),
    wallNow: () => start + at,
    testBots: { enabled: false },
  });
  const sockets = [];
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
  });
  const player = () => {
    const auth = profiles.open();
    return { ...auth, cookie: `sferorumiya_session=${auth.token}` };
  };
  const api = async (auth, path, input) => {
    const response = await fetch(url + path, {
      method: input ? "POST" : "GET",
      headers: {
        Cookie: auth?.cookie || "",
        ...(input ? { "Content-Type": "application/json" } : {}),
      },
      body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const reserve = (auth, preferredArenaId = null, requestId = randomUUID()) =>
    api(auth, "/api/arena-reservations", { preferredArenaId, requestId });
  const connect = (auth, reservation, overridePath) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(
        url.replace("http:", "ws:") + (overridePath || reservation.wsPath),
        [`ticket.${reservation.ticket}`],
        { headers: { Cookie: auth.cookie } },
      );
      sockets.push(ws);
      const messages = [];
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const value = JSON.parse(raw.toString());
        messages.push(value);
        if (value.type === "welcome") resolve({ ws, messages, welcome: value });
      });
      ws.on("close", (code) => {
        if (!messages.some((m) => m.type === "welcome")) reject(Error(`Closed ${code}`));
      });
    });
  const join = async (auth, room) => {
    const response = await reserve(auth, room);
    assert.equal(response.status, 200);
    return connect(auth, response.body);
  };
  return {
    app,
    profiles,
    api,
    player,
    reserve,
    connect,
    join,
    advance: (ms) => {
      at += ms;
    },
  };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Expected server message was not received");
}


const {freshProgress}=require('../../src/server/progression/experience-progression');
test('Комнаты создаются с лимитами частей 8/12/16 и ботов 10/20/30',async t=>{
 const env=await setup(t);
 const populated=require('../../src/server/testing/bronze-population').prepareBronzePopulation(env.profiles.data,Date.now(),30).data;
 env.profiles.save(require('../../src/server/testing/sandbox-population').prepareSandboxPopulation(populated,Date.now()).data);
 for(const group of require('../../public/shared/arena-names').groups){
  const user=env.player();level(env,user,group.minLevel);
  const reservation=(await env.reserve(user)).body;await env.connect(user,reservation);
  const room=env.app.rooms.get(reservation.arenaId);
  assert.ok(group);assert.equal(room.arena.maxParts,group.maxParts);
  assert.equal(room.bots.roomBotLimit,group.maxBots);
  room.bots.enabled=true;room.bots.maxActive=30;room.bots.update(5000,Date.now(),35);
  const bots=[...room.arena.players.values()].filter(p=>p.isTestBot&&!p.dead);
  assert.equal(bots.length,group.maxBots);
  assert.ok(bots.every(p=>{const n=env.profiles.byId(p.profileId).level;return n>=group.minLevel&&n<=group.maxLevel;}));
 }
});
function level(env, user, value) { const p=env.profiles.find(user.token); p.level=value; p.progress=freshProgress(value); }
test('Уровни 1/11, 12/120, 121/500 видят только свои комнаты; чужая бронь запрещена', async t=>{
 const env=await setup(t), groups=['sandbox','sandbox','glade','glade','arena','arena'];
 for(const [i,n] of [1,11,12,120,121,500].entries()){
  const user=env.player();level(env,user,n);
  const list=await env.api(user,'/api/arenas');assert.equal(list.status,200);assert.equal(list.body.group.id,groups[i]);
  assert.ok(list.body.arenas.length>0);assert.ok(list.body.arenas.every(r=>r.group===groups[i]));assert.equal(list.body.arenas[0].name,'Альфа');
  for(const foreign of [...env.app.rooms.keys()].filter(id=>!list.body.arenas.some(r=>r.id===id))){
   const r=await env.reserve(user,foreign);assert.notEqual(r.status,200);assert.match(r.body.error,/комнату своего уровня/);
  }
  const r=await env.reserve(user);assert.equal(r.status,200);await env.connect(user,r.body);
 }
 assert.equal((await env.api(null,'/api/arenas')).status,401);
});
test('Повышение уровня сохраняет текущую жизнь, новая жизнь и билет проверяют новую группу', async t=>{
 for(const [before,after] of [[11,12],[120,121]]){
  const env=await setup(t), user=env.player();level(env,user,before);
  const reservation=(await env.reserve(user)).body, actor=await env.connect(user,reservation);
  const p=env.app.rooms.get(reservation.arenaId).arena.players.get(actor.welcome.id),serial=p.spawnSerial;
  level(env,user,after);env.app.tick();assert.equal(p.dead,false);assert.equal(p.spawnSerial,serial);
  actor.ws.send(JSON.stringify({type:'leaveLife',spawnSerial:serial}));await until(()=>actor.messages.some(m=>m.type==='lifeEnded'));
  actor.ws.send(JSON.stringify({type:'continueLife',lifeId:p.lifeId}));await until(()=>actor.messages.some(m=>m.type==='continueResult'));
  assert.equal(actor.messages.find(m=>m.type==='continueResult').ok,false);assert.equal(p.dead,true);
  actor.ws.close();await once(actor.ws,'close');await new Promise(r=>setTimeout(r,15));
  const next=await env.reserve(user);assert.equal(next.status,200);assert.notEqual(next.body.arenaId,reservation.arenaId);
  level(env,user,before);await assert.rejects(env.connect(user,next.body));
 }
});
test('Расширение одной группы не открывает её комнаты другой, бронь не дублируется', async t=>{
 const env=await setup(t);let first;
 for(let i=0;i<36;i++){const u=env.player();if(!first)first=u;const id=randomUUID(),r=await env.reserve(u,null,id);assert.equal(r.status,200);assert.deepEqual((await env.reserve(u,null,id)).body,r.body);}
 const a=(await env.api(first,'/api/arenas')).body.arenas;assert.ok(a.length>=3);assert.ok(a.every(r=>r.group==='sandbox'&&r.reserved<=35));
 const high=env.player();level(env,high,121);const b=(await env.api(high,'/api/arenas')).body.arenas;assert.equal(b.length,1);assert.equal(b[0].reserved,0);
});

test('Песочницы вдвое меньше по сторонам при создании и расширении; клиент получает реальные границы', async t=>{
 const env=await setup(t), expected={sandbox:{width:3060,height:2040},glade:{width:6120,height:4080},arena:{width:6120,height:4080}};
 for(const group of require('../../public/shared/arena-names').groups){
  const user=env.player();level(env,user,group.minLevel);
  const reservation=(await env.reserve(user)).body, actor=await env.connect(user,reservation);
  const simulation=env.app.rooms.get(reservation.arenaId).arena;
  assert.deepEqual(simulation.world,expected[group.id]);
  assert.deepEqual(actor.welcome.world,expected[group.id]);
  assert.ok(simulation.ether.length>0);
  assert.ok(simulation.ether.every(f=>f.x>=0&&f.y>=0&&f.x<=simulation.world.width&&f.y<=simulation.world.height));
 }
 for(let i=0;i<36;i++) assert.equal((await env.reserve(env.player())).status,200);
 env.app.tick();
 const sandbox=(await env.api(env.player(),'/api/arenas')).body.arenas.map(r=>env.app.rooms.get(r.id));
 assert.ok(sandbox.length>1);
 for(const room of sandbox){
  assert.deepEqual(room.arena.world,expected.sandbox);
  assert.ok(room.arena.ether.every(f=>f.x>=0&&f.y>=0&&f.x<=3060&&f.y<=2040));
  const hazard=room.arena.hazards;
  if(room.arena.players.size){
   hazard.replenish(5000);
   assert.ok(hazard.items.length>0);
   assert.ok(hazard.items.every(h=>h.x>=0&&h.y>=0&&h.x<=3060&&h.y<=2040));
  }
 }
});
