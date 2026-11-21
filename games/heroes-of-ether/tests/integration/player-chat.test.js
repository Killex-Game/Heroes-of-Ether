"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { ChatService } = require("../../src/server/chat/chat-service");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service");
const { Arena } = require("../../src/server/arena/arena-simulation"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const { temporary } = require("../temp");
function world() {
  const profiles = new ProfileStore(),
    clans = new ClanService(profiles);
  const user = (name) => {
    const u = profiles.open(),
      p = profiles.find(u.token);
    p.name = name;
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 10000;
    p.account = require("../../src/server/accounts/account-benefits").fresh();
    return u;
  };
  const a = user("Глава"),
    b = user("Соклановец"),
    outsider = user("Чужой");
  const act = (u, action, extra = {}) =>
    clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  act(a, "create", { name: "Стражи чата", prefix: "CHAT", emblem: "astral", privacy: "open" });
  const clanId = profiles.find(a.token).clanId;
  act(b, "apply", { clanId });
  return { profiles, a, b, outsider, clanId, act };
}
async function setup(t, options = {}) {
  const state = world(),
    app = createGameServer({
      ...state,
      arena: new Arena({ etherCount: 0 }),
      autoTick: false,
      ...options,
    });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const headers = (u) => ({
    Cookie: `sferorumiya_session=${u.token}`,
    "Content-Type": "application/json",
  });
  const post = (u, data) =>
    fetch(url + "/api/clans/chat", {
      method: "POST",
      headers: headers(u),
      body: JSON.stringify({
        clanId: state.clanId,
        requestId: randomUUID(),
        text: "Привет!",
        ...data,
      }),
    });
  const read = (u, query = "") =>
    fetch(url + "/api/clans/chat?clanId=" + state.clanId + query, { headers: headers(u) });
  return { ...state, app, url, headers, post, read };
}
test("clan result messages are private, use system identity and remain available through delta cursors",async t=>{
  const {profiles,a,b,outsider,clanId,read}=await setup(t);
  const clan=profiles.data.clans[clanId],other={id:"rival-clan",name:"Соперники",prefix:"RIVAL"};
  require("../../src/server/clans/battle-history").append(clan,other,122,45,profiles.now()-1000);
  const first=await(await read(a)).json();assert.equal(first.messages.length,1);assert.match(first.messages[0].text,/122:45/);
  assert.equal(first.messages[0].author.id,"system:clan-battles");
  assert.deepEqual((await(await read(b)).json()).messages,first.messages);
  const delta=await(await read(a,"&after="+first.messages[0].id)).json();assert.equal(delta.reset,false);assert.equal(delta.messages.length,0);assert.equal(delta.systemMessages.length,1);
  assert.equal((await read(outsider)).status,403);
});

test('HTTP chat waits for durable message and retains author authorization with the journal enabled',async t=>{
  let cleanup;const dir=temporary({after:fn=>{cleanup=fn;}},'http-chat-journal');
  const chat=new ChatService({filePath:path.join(dir,'clan-chat.json'),journal:true});
  const f=await setup(t,{chat});t.after(()=>cleanup());
  const request={requestId:randomUUID(),text:'Сохранённое сообщение'};
  const response=await f.post(f.a,request);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.duplicate,false);
  const saved=require('../../src/server/profiles/profile-journal').recover(chat.filePath).data;
  assert.equal(saved.clans[f.clanId][0].id,body.message.id);
  assert.equal(saved.achievementCounts[f.a.profile.id],1);
  assert.equal((await(await f.post(f.a,request)).json()).duplicate,true);
  assert.equal((await f.post(f.outsider,{text:'Не должен отправиться'})).status,403);
});
test("Клановый чат: автор с сервера, только соклановцы, дельты и повтор без дубликата", async (t) => {
  const { profiles, a, b, outsider, clanId, post, read, act } = await setup(t);
  const before = structuredClone(profiles.data);
  const requestId = randomUUID(),
    sent = await post(a, { requestId, name: "Подмена", author: { id: "forged" } });
  assert.equal(sent.status, 200);
  const result = await sent.json();
  assert.equal(result.message.author.name, "Глава");
  const retry = await (await post(a, { requestId })).json();
  assert.equal(retry.message.id, result.message.id);
  assert.equal(retry.duplicate, true);
  assert.equal((await post(a, { requestId, text: "Другой текст" })).status, 409);
  const history = await (await read(b)).json();
  assert.deepEqual(history.memberHistory.entries.map((r) => r.action), ["joined", "created"]);
  assert.equal(history.memberHistory.entries[0].actor.name, "Соклановец");
  assert.deepEqual((await (await read(b, "&historyAfter=2")).json()).memberHistory.entries, []);
  assert.equal((await read(b, "&historyAfter=-1")).status, 400);
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].requestId, undefined);
  assert.deepEqual((await (await read(b, "&after=" + result.message.id)).json()).messages, []);
  assert.equal((await read(outsider)).status, 403);
  assert.equal((await post(outsider, {})).status, 403);
  assert.equal((await post(a, { clanId: "another" })).status, 403);
  const beforeAuthor = Object.values(before.profiles).find((p) => p.id === a.profile.id);
  beforeAuthor.activity.values.sociable++;
  beforeAuthor.activity.chatAccepted = 1;
  beforeAuthor.revision++;
  assert.deepEqual(profiles.data, before, "only the accepted sender's chat achievement changes");
  act(b, "leave", { clanId });
  assert.equal((await (await read(a, "&historyAfter=2")).json()).memberHistory.entries[0].action, "left");
  assert.equal((await read(b)).status, 403);
  assert.equal((await post(b, {})).status, 403);
});
test("Клановый чат проверяет членство после получения задержанного тела запроса", async (t) => {
  const { app, b, clanId, act, url, headers } = await setup(t);
  const body = JSON.stringify({ clanId, text: "Позднее сообщение", requestId: randomUUID() });
  const req = require("node:http").request(url + "/api/clans/chat", {
    method: "POST",
    headers: { ...headers(b), "Content-Length": Buffer.byteLength(body) },
  });
  t.after(() => req.destroy());
  const received = once(app.httpServer, "request");
  req.write(body.slice(0, 8));
  await received;
  act(b, "leave", { clanId });
  const response = once(req, "response");
  req.end(body.slice(8));
  const [res] = await response;
  res.resume();
  await once(res, "end");
  assert.equal(res.statusCode, 403);
});

test("Подпись чата: серверный уровень, приоритет Premium и истёкший статус", async (t) => {
  const { profiles, a, b, post, read } = await setup(t);
  const p = profiles.find(a.token);
  p.account.vipUntil = Date.now() + 60000;
  p.account.premiumUntil = Date.now() + 60000;
  const first = await (await post(a, { author: { level: 999, status: "vip" } })).json();
  assert.equal(first.message.author.level, 12);
  assert.equal(first.message.author.status, "premium");
  profiles.find(a.token).account.premiumUntil = Date.now() - 1;
  const second = await (await post(a, {})).json();
  assert.equal(second.message.author.status, "vip");
  profiles.find(a.token).account.vipUntil = Date.now() - 1;
  const third = await (await post(a, {})).json();
  assert.equal(third.message.author.status, "basic");
  const history = await (await read(b)).json();
  assert.equal(history.messages[0].author.status, "basic");
  assert.equal(history.messages[0].author.level, 12);
});

test("Старая история получает уровень и статус без изменения сохранённой переписки", (t) => {
  const filePath = path.join(temporary(t, "chat-author"), "chat.json");
  const saved = JSON.stringify({
    version: 1,
    clans: {
      c: [
        {
          id: randomUUID(),
          requestId: randomUUID(),
          at: 1000,
          author: { id: "a", name: "Игрок", clanTag: "TAG" },
          text: "Старая запись",
        },
      ],
    },
  });
  fs.writeFileSync(filePath, saved);
  const chat = new ChatService({ filePath, now: () => 2000 });
  chat.profileFor = () => ({ level: 46, account: { vipUntil: 3000, premiumUntil: 4000 } });
  const result = chat.history("c").messages[0];
  assert.equal(result.author.level, 46);
  assert.equal(result.author.status, "premium");
  assert.equal(result.requestId, undefined);
  assert.equal(fs.readFileSync(filePath, "utf8"), saved);
});
test("Чат: валидация, ограничение частоты и ограниченная история", () => {
  let at = 10000;
  const chat = new ChatService({ now: () => at }),
    profile = { id: "one", name: "Игрок" };
  const send = (text = "Привет") =>
    chat.send(profile, null, null, { requestId: randomUUID(), text });
  assert.throws(() => send("  "), /Напиши/);
  assert.throws(() => send("а".repeat(281)), /280/);
  assert.throws(() => chat.send(null, null, null, {}), /войти|войди/);
  send();
  send();
  send();
  assert.throws(() => send("Другое сообщение"), /Слишком часто/);
  at += 30000;
  for (let i = 0; i < 105; i++) {
    at += 2100;
    send("Сообщение " + i);
  }
  assert.equal(chat.history().messages.length, 100);
  assert.equal(chat.history().messages.at(-1).text, "Сообщение 104");
});
test("История клана переживает перезапуск; отказ записи не подтверждает и не дублирует сообщение", (t) => {
  const dir = temporary(t, "clan-chat"),
    filePath = path.join(dir, "chat.json");
  const chat = new ChatService({ filePath }),
    p = { id: "a", name: "Игрок" },
    request = { requestId: randomUUID(), text: "Сохранено" };
  const first = chat.send(p, null, "clan", request);
  const restored = new ChatService({ filePath });
  assert.equal(restored.history("clan").messages[0].id, first.message.id);
  assert.equal(restored.send(p, null, "clan", request).duplicate, true);
  assert.equal(restored.history().messages.length, 0);
  fs.mkdirSync(filePath + ".tmp");
  const next = { requestId: randomUUID(), text: "Повтор после сбоя" };
  assert.throws(() => restored.send(p, null, "clan", next), /Не удалось сохранить/);
  assert.equal(restored.history("clan").messages.length, 1);
  assert.equal(new ChatService({ filePath }).history("clan").messages.length, 1);
  fs.rmdirSync(filePath + ".tmp");
  restored.send(p, null, "clan", next);
  assert.equal(restored.send(p, null, "clan", next).duplicate, true);
  assert.equal(new ChatService({ filePath }).history("clan").messages.length, 2);
});
test("Арена: мгновенная доставка, история после переподключения и повтор без второго сообщения", async (t) => {
  const { app, profiles, url, a, b, headers } = await setup(t);
  profiles.find(a.token).account.vipUntil = Date.now() + 60000;
  profiles.find(a.token).account.premiumUntil = Date.now() + 60000;
  const connect = async (u) => {
    const socket = new WebSocket(url, { headers: headers(u) }),
      messages = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw)));
    await once(socket, "open");
    return { socket, messages };
  };
  const until = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("No chat packet");
  };
  const one = await connect(a),
    two = await connect(b);
  const message = {
    type: "chatSend",
    requestId: randomUUID(),
    text: "Привет арене",
    author: { name: "Подмена" },
  };
  one.socket.send(JSON.stringify(message));
  await until(() => two.messages.some((p) => p.type === "chatMessage"));
  assert.equal(two.messages.find((p) => p.type === "chatMessage").message.author.name, "Глава");
  assert.equal(two.messages.find((p) => p.type === "chatMessage").message.author.level, 12);
  assert.equal(two.messages.find((p) => p.type === "chatMessage").message.author.status, "premium");
  one.socket.send(JSON.stringify(message));
  await until(() => one.messages.filter((p) => p.type === "chatResult").length === 2);
  assert.equal(two.messages.filter((p) => p.type === "chatMessage").length, 1);
  const closed = once(one.socket, "close");
  one.socket.close();
  await closed;
  await until(() => [...app.arena.players.values()].filter((p) => !p.isRemnant).length === 1);
  const again = await connect(a);
  await until(() => again.messages.some((p) => p.type === "chatHistory"));
  assert.equal(again.messages.find((p) => p.type === "chatHistory").messages.length, 1);
});
