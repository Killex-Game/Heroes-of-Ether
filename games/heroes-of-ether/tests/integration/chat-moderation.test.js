"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { randomUUID } = require("node:crypto"), { once } = require("node:events"), WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { recover } = require("../../src/server/profiles/profile-journal");
const { ChatService } = require("../../src/server/chat/chat-service");
const { ChatModeration } = require("../../src/server/chat/chat-moderation");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ClanService } = require("../../src/server/clans/clan-service");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const { temporary } = require("../temp");
const HOUR = 3600000, MINUTE = 60000;
function muted(send) { try { send(); assert.fail("Expected rejection"); } catch (e) { return e; } }
test("WAL preserves censored message strikes, one hour chat mute and audit across retry and restart", async t => {
  const filePath = path.join(temporary(t, "chat-strikes"), "profiles.json");
  let at = Date.parse("2026-11-16T12:00:00Z"), profiles = new ProfileStore({ filePath, journal: true, incrementalSettlement: true, now: () => at });
  const auth = profiles.open(), other = profiles.open(), id = auth.profile.id;
  const attach = () => { const chat = new ChatService({ now: () => at }); chat.moderation = new ChatModeration({ profiles, now: () => at }); return chat; };
  let chat=attach();
  const requestId=randomUUID(),send=(text,req=randomUUID())=>chat.send(profiles.byId(id),null,"clan",{text,requestId:req});
  const otherBefore=structuredClone(profiles.byId(other.profile.id));
  assert.equal(send("сука",requestId).message.text,"***");
  assert.equal(profiles.byId(id).chatModeration.mute,null);
  at+=3000;
  const committed=profiles.data,savedWrite=profiles.writeSnapshot,failedId=randomUUID();
  profiles.writeSnapshot=()=>{throw Error("disk unavailable");};
  assert.match(muted(()=>send("пизда",failedId)).message,/disk unavailable/);
  assert.strictEqual(profiles.data,committed);
  assert.equal(Object.values(recover(filePath).data.profiles).find(p=>p.id===id).chatModeration.profanity.count,1);
  profiles.writeSnapshot=savedWrite;
  assert.equal(send("пизда",failedId).message.text,"***");
  await profiles.close();
  profiles=new ProfileStore({filePath,journal:true,incrementalSettlement:true,now:()=>at});chat=attach();
  assert.equal(send("сука",requestId).message.text,"***");
  assert.equal(profiles.byId(id).chatModeration.profanity.count,2);
  at+=3000;assert.equal(send("сука").message.text,"***");
  const punished=profiles.byId(id);
  assert.equal(punished.chatModeration.mute.until,at+HOUR);
  assert.equal(punished.moderation?.ban,undefined);
  assert.equal(muted(()=>send("Обычный текст")).code,"CHAT_MUTED");
  assert.deepEqual(profiles.byId(other.profile.id),otherBefore);
  assert.deepEqual(punished.wallet,auth.profile.wallet);
  const recovered=recover(filePath).data;
  assert.deepEqual(Object.values(recovered.profiles).find(p=>p.id===id),punished);
  assert.equal(recovered.administration.audit.at(-1).action,"chat-mute");
  assert.equal(recovered.administration.audit.at(-1).evidence.profanity,1);
  await profiles.close();
});

test("clean messages and reads never save moderation; existing manual bans cannot be weakened", () => {
  const profiles = new ProfileStore(), auth = profiles.open(), id = auth.profile.id, p = profiles.byId(id);
  const chat = new ChatService(); chat.moderation = new ChatModeration({ profiles });
  let writes = 0; const save = profiles.save.bind(profiles); profiles.save = (...args) => { writes++; return save(...args); };
  chat.send(p, null, null, { text: "Привет, друзья!", requestId: randomUUID() });
  for (let i = 0; i < 50; i++) { chat.history(); chat.moderation.status(p); }
  assert.equal(writes, 0); assert.equal(profiles.byId(id).chatModeration, undefined);
  p.moderation = { version: 1, ban: { at: Date.now(), until: Date.now() + 24 * HOUR, reason: "Решение владельца", by: "owner" } };
  const before = structuredClone(p.moderation);
  assert.equal(muted(() => chat.send(p, null, null, { text: "хуй", requestId: randomUUID() })).code, "ACCOUNT_BANNED");
  assert.deepEqual(p.moderation, before); assert.equal(writes, 0);
});
async function fixture(t) {
  let at = Date.now();
  const profiles = new ProfileStore({ now: () => at, incrementalSettlement: true }), auth = profiles.open();
  const p = profiles.find(auth.token); p.level = 12; p.progress.xp = xpForLevel(12); p.wallet.coins = 10000; p.name = "Игрок";
  new ClanService(profiles).mutate(auth.token, { action: "create", name: "Проверка чата", prefix: "CHAT", emblem: "astral", privacy: "open", requestId: randomUUID() });
  const clanId = profiles.byId(p.id).clanId;
  const app = createGameServer({ profiles, wallNow: () => at, autoTick: false, arena: new Arena({ etherCount: 0 }), testBots: { enabled: false } });
  app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening"); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`, headers = { Cookie: `sferorumiya_session=${auth.token}`, "Content-Type": "application/json" };
  const post = async (text, requestId = randomUUID()) => { const res = await fetch(url + "/api/clans/chat", { method: "POST", headers, body: JSON.stringify({ clanId, text, requestId }) }); return { status: res.status, body: await res.json() }; };
  const get = async route => { const res = await fetch(url + route, { headers }); return { status: res.status, body: await res.json() }; };
  const connect = async () => { const ws = new WebSocket(url, { headers }), packets = []; ws.on("message", raw => packets.push(JSON.parse(raw))); await once(ws, "open"); return { ws, packets }; };
  return { profiles, auth, app, clanId, post, get, connect, advance: ms => at += ms, now: () => at };
}
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); } throw Error("Timed out"); }
test("HTTP clan and WebSocket arena share chat mute without disconnecting the player or blocking profile", async t => {
  const f=await fixture(t),{ws,packets}=await f.connect();
  t.after(()=>ws.close());
  assert.equal((await f.post("сука")).body.message.text,"***");
  f.advance(3000);
  const secondId=randomUUID();ws.send(JSON.stringify({type:"chatSend",requestId:secondId,text:"Текст хуй"}));
  await until(()=>packets.some(p=>p.requestId===secondId));
  assert.equal(f.profiles.byId(f.auth.profile.id).chatModeration.profanity.count,2);
  f.advance(3000);assert.equal((await f.post("блядь")).body.message.text,"***");
  const untilAt=f.now()+HOUR;
  const mutedId=randomUUID();ws.send(JSON.stringify({type:"chatSend",requestId:mutedId,text:"Чистое сообщение"}));
  await until(()=>packets.some(p=>p.requestId===mutedId));
  assert.equal(packets.find(p=>p.requestId===mutedId).code,"CHAT_MUTED");
  assert.equal((await f.post("Чистый текст")).body.code,"CHAT_MUTED");
  const history=await f.get("/api/clans/chat?clanId="+f.clanId);
  assert.equal(history.status,200);assert.equal(history.body.messages.length,2);
  assert.equal(history.body.chatModeration.until,untilAt);
  assert.equal(f.profiles.byId(f.auth.profile.id).chatModeration.profanity.count,3);
  assert.equal(ws.readyState,WebSocket.OPEN);assert.equal(f.app.arena.players.size,1);
  assert.equal((await f.get("/api/profile")).status,200);
  assert.equal((await f.get("/api/access")).body.blocked,false);
  assert.equal(packets.some(p=>p.type==="accountBanned"),false);
  f.advance(HOUR);assert.equal((await f.post("Снова в чате")).status,200);
});

test("flood remains one hour for every later incident and does not punish a different player", async t => {
  const f = await fixture(t);
  for (const [index, minutes] of [5, 30, 60, 60].entries()) {
    for (let i = 0; i < 3; i++) assert.equal((await f.post("повтор " + index)).status, 200);
    const result = await f.post("повтор " + index);
    assert.equal(result.body.code, index < 2 ? "CHAT_MUTED" : "ACCOUNT_BANNED");
    assert.equal(f.profiles.byId(f.auth.profile.id).chatModeration.flood.count, index + 1);
    f.advance(minutes * MINUTE + 100);
  }
  const other = f.profiles.open();
  assert.equal(f.profiles.byId(other.profile.id).chatModeration, undefined);
});
