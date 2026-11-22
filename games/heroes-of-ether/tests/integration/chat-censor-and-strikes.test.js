"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ChatService } = require("../../src/server/chat/chat-service");
const { ChatModeration } = require("../../src/server/chat/chat-moderation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { censorProfanity } = require("../../src/server/chat/profanity");
const { createGameServer } = require("../../src/server/game-server");
const { recover } = require("../../src/server/profiles/profile-journal");
const { temporary } = require("../temp");

test("Censor only offending Unicode spans and retain ordinary words and punctuation", () => {
  assert.equal(censorProfanity("Привет, ХУЙ! Страхуй меня, х.у.й и су\u200bка."), "Привет, ***! Страхуй меня, *** и ***.");
  assert.equal(censorProfanity("х*й, бл**дь, с*ка и корабля"), "***, ***, *** и корабля");
  assert.equal(censorProfanity("🙂 fuck\u0301!"), "🙂 ***!");
});
test("One strike per message, third is delivered censored and mutes chat only for one hour", async t => {
  const dir = temporary(t, "chat-censor"), file = path.join(dir, "profiles.json");
  let at = Date.now(), profiles = new ProfileStore({ filePath: file, now: () => at, journal: true });
  const auth = profiles.open(), id = auth.profile.id;
  let chat;
  const attach = () => { chat = new ChatService({ now: () => at });
    chat.moderation = new ChatModeration({ profiles, now: () => at, onBan: () => assert.fail("No account ban") }); };
  attach();
  const send = (text, requestId = randomUUID()) => chat.send(profiles.byId(id), null, "clan", { text, requestId });
  for (let count = 1; count <= 6; count++) {
    const requestId = randomUUID();
    const response = await send("Пример " + count + " хуй сука блядь", requestId);
    assert.equal(response.message.text, "Пример " + count + " *** *** ***");
    assert.equal(profiles.byId(id).chatModeration.profanity.count, count);
    assert.equal(profiles.byId(id).moderation?.ban, undefined);
    assert.equal((await send("Пример " + count + " хуй сука блядь", requestId)).duplicate, true);
    assert.equal(profiles.byId(id).chatModeration.profanity.count, count);
    if (count % 3 === 0) {
      const until = at + 3600000;
      assert.equal(profiles.byId(id).chatModeration.mute.until, until);
      assert.throws(() => send("Обычное сообщение"), error => error.code === "CHAT_MUTED");
      at = until - 1;
      assert.throws(() => send("Рано"), error => error.code === "CHAT_MUTED");
      at = until;
      await profiles.close();
      profiles = new ProfileStore({ filePath: file, now: () => at, journal: true }); attach();
      assert.equal(profiles.byId(id).chatModeration.profanity.count, count);
    } else { assert.equal(profiles.byId(id).chatModeration.mute?.until > at, false); at += 3000; }
  }
  await profiles.close();
});
test("Asynchronous strike publication precedes censored message; failed chat write retries without another strike", async t => {
  let cleanup;
  const dir = temporary({ after: fn => { cleanup = fn; } }, "chat-censor-async");
  let at = Date.now();
  const file = path.join(dir, "profiles.json");
  const profiles = new ProfileStore({ filePath: file, journal: true, incrementalSettlement: true, now: () => at });
  const auth = profiles.open();
  const chat = new ChatService({ filePath: path.join(dir, "chat.json"), journal: true, now: () => at });
  const app = createGameServer({ profiles, chat, autoTick: false, wallNow: () => at, testBots: { enabled: false } });
  t.after(async () => { try { await app.close(); } finally { cleanup(); } });
  await chat.writer.tail;
  const requestId = randomUUID(), send = () => chat.send(profiles.byId(auth.profile.id), null, "clan",
    { text: "Текст хуй", requestId });
  let entered, release;
  const entry = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const original = profiles.journal.stage.bind(profiles.journal);
  const stage = t.mock.method(profiles.journal, "stage", async (...args) => { entered(); await hold; return original(...args); });
  const failure = t.mock.method(chat.writer, "commit", async () => { throw Error("chat disk failed"); });
  const pending = send(); const rejected = assert.rejects(pending, /chat disk failed/);
  await entry;
  assert.equal(profiles.byId(auth.profile.id).chatModeration, undefined);
  assert.equal(chat.history("clan").messages.length, 0);
  release(); await rejected; stage.mock.restore(); failure.mock.restore();
  assert.equal(profiles.byId(auth.profile.id).chatModeration.profanity.count, 1);
  assert.equal(chat.history("clan").messages.length, 0);
  assert.equal((await send()).message.text, "Текст ***");
  assert.equal(profiles.byId(auth.profile.id).chatModeration.profanity.count, 1);
  assert.equal((await send()).duplicate, true);
  assert.equal(Object.values(recover(file).data.profiles).find(p => p.id === auth.profile.id).chatModeration.profanity.count, 1);
});
