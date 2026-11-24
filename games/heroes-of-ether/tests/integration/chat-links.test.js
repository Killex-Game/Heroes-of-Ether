"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { randomUUID } = require("node:crypto");
const { stripLinks } = require("../../src/server/chat/chat-links");
const { ChatService } = require("../../src/server/chat/chat-service");
const { ChatModeration } = require("../../src/server/chat/chat-moderation");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { temporary } = require("../temp");

test("links disappear while plain text, decimals and labels remain", () => {
  for (const link of ["https://example.com/a?q=1", "HTTP://example.com", "www.example.com",
    "example.com/a", "пример.рф", "xn--e1afmkfd.xn--p1ai", "https://127.0.0.1:8080/a",
    "192.168.1.1:1234", "tg://resolve?domain=test", "mailto:a@example.com", "a@example.com",
    "exam\u200bple.com", "//example.com/x"])
    assert.equal(stripLinks(`До ${link} после`), "До после", link);
  assert.equal(stripLinks("Смотри [описание](https://example.com) здесь"), "Смотри описание здесь");
  for (const text of ["Масса 100.5, XP:123", "Привет!", "1.50 → 1", "!!!", "Пример без ссылок 🙂"])
    assert.equal(stripLinks(text), text);
});

test("arena and clan messages persist without URLs, retry once and retain profanity strikes", async t => {
  const dir = temporary(t, "chat-links"); let at = Date.now();
  const profiles = new ProfileStore({ now: () => at }), auth = profiles.open();
  const chat = new ChatService({ filePath: path.join(dir, "chat.json"), now: () => at });
  chat.moderation = new ChatModeration({ profiles, now: () => at });
  t.after(async () => { await chat.close(); await profiles.close(); });
  for (const room of [null, "clan"]) {
    const requestId = randomUUID(), text = "Привет https://example.com хуй";
    const send = value => chat.send(profiles.byId(auth.profile.id), null, room, { requestId, text: value }, "arena-1");
    assert.equal((await send(text)).message.text, "Привет ***");
    assert.equal((await send(text)).duplicate, true);
    assert.throws(() => send("Привет https://different.com хуй"), /уже использован/);
    at += 3000;
  }
  assert.equal(profiles.byId(auth.profile.id).chatModeration.profanity.count, 2);
  assert.equal(chat.history("clan").messages[0].text, "Привет ***");
  assert.throws(() => chat.send(profiles.byId(auth.profile.id), null, null,
    { requestId: randomUUID(), text: "https://example.com" }, "arena-1"), /сообщение пустое/);
  assert(!require("node:fs").readFileSync(path.join(dir, "chat.json"), "utf8").includes("example.com"));
});
