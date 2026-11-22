"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { countProfanity } = require("../../src/server/chat/profanity");
const { WEEK, decision, counter, validate, REASONS } = require("../../src/server/chat/chat-rules");
const { ChatService } = require("../../src/server/chat/chat-service");
const MINUTE = 60000, HOUR = 60 * MINUTE;
function fixture() {
  let at = 100000;
  const profile = { id: "a", name: "Игрок", receipts: {} }, chat = new ChatService({ now: () => at });
  const send = (text, requestId = randomUUID(), room = null) => chat.send(profile, null, room, { requestId, text });
  const reject = (...args) => { try { send(...args); assert.fail("Must reject"); } catch (e) { assert(e.code || e.status); return e; } };
  return { chat, profile, send, reject, advance: ms => at += ms, now: () => at };
}
test("whole-word screening counts occurrences, obfuscations and five words in one message", () => {
  for (const word of ["хуй", "хуя", "нахуй", "пизда", "пиздец", "ебать", "заебал", "блядь", "блять", "бля", "ёбаный", "ебнутый", "fuck", "shit", "blyad", "pizda", "ebat", "хyй", "xуй", "х.у.й", "х у й", "х\u200bуй", "хуууй", "х*й", "бл**дь"])
    assert.equal(countProfanity(word), 1, word);
  assert.equal(countProfanity("хуй пизда блядь ебать хуй"), 5);
  assert.equal(countProfanity("ХУЙ! хуй, хуя. хуй"), 4);
});
test("the explicitly requested suka family and disguises count whole words", () => {
  for (const word of ["сука", "суки", "суке", "суку", "сукой", "суками", "СУКА", "сууука", "cукa", "суkа", "с.у.к.а", "с у к а", "с*ка", "suka", "suki", "су\u200bка"])
    assert.equal(countProfanity(word), 1, word);
  assert.equal(countProfanity("сука сука сука"), 3);
});
test("ordinary words, names and substrings do not create profanity strikes", () => {
  assert.equal(countProfanity("б л я х а"), 0);
  for (const text of ["Страхуй меня!", "Подстрахуй", "учебник", "употреблять", "рубля", "корабля", "бляха", "хулиган", "педикюр", "мандат", "команда", "небо", "ребёнок", "ебеновый", "мебель", "Scunthorpe", "ассистент", "барсука", "барсуки", "сук", "сучок", "суканый", "х у л и г а н", "обновление", "Не работает кнопка. Игра тормозит", "я за честную игру"])
    assert.equal(countProfanity(text), 0, text);
});
test("profanity counts messages; every third message mutes only chat", () => {
  let state, at = 1000;
  for (let i = 1; i <= 25; i++) {
    const d = decision(state, { profanity: 1 }, at++); state = d.next;
    if (i % 3) assert.equal(d.punishment, null);
    else {
      assert.equal(d.punishment.minutes, 60);
      assert.equal(d.punishment.account, false);
    }
  }
  const jump = decision(null, { profanity: 15 }, at);
  assert.equal(jump.punishment, null);
  assert.equal(jump.next.profanity.count, 1);
  for (const count of [1, 2, 3, 4, 6, 9]) {
    const d = decision(null, { profanity: count }, at);
    assert.equal(d.punishment, null);
    assert.equal(d.next.profanity.count, 1);
  }
});
test("flood: 5 minutes, 30 minutes, one hour and one hour again", () => {
  let state;
  for (const [i, minutes] of [5, 30, 60, 60, 60].entries()) {
    const d = decision(state, { flood: true }, 1000 + i * HOUR); state = d.next;
    assert.equal(d.punishment.minutes, minutes);
    assert.equal(d.punishment.account, i >= 2);
  }
});
test("each category expires only after its own seven quiet days; exact boundary", () => {
  let state = decision(null, { flood: true }, 1000).next;
  state = decision(state, { profanity: 1 }, 1000 + WEEK - 1).next;
  let d = decision(state, { flood: true }, 1000 + WEEK);
  assert.equal(d.next.flood.count, 1); assert.equal(d.next.profanity.count, 1);
  assert.equal(counter(d.next.profanity, 1000 + 2 * WEEK - 2).count, 1);
  assert.equal(counter(d.next.profanity, 1000 + 2 * WEEK - 1).count, 0);
});
test("all channels share flood history and mutes; muted requests are cheap and do not extend strikes", () => {
  const f = fixture();
  f.send("повтор", undefined, "one"); f.send("Повтор!", undefined, "two"); f.send("повтор.");
  const e = f.reject("повтор"); assert.equal(e.code, "CHAT_MUTED");
  const before = structuredClone(f.profile), scans = f.chat.moderation.scans;
  f.advance(1000);
  for (let i = 0; i < 100; i++) assert.equal(f.reject("хуй", undefined, "future-channel").code, "CHAT_MUTED");
  assert.equal(f.chat.moderation.scans, scans); assert.deepEqual(f.profile, before);
  f.advance(5 * MINUTE); assert.doesNotThrow(() => f.send("Теперь можно"));
  assert.equal(f.profile.chatModeration.flood.count, 1);
});
test("fast varied messages also detect flood, not only duplicate text", () => {
  const f = fixture();
  for (let i = 0; i < 7; i++) { try { f.send("Сообщение " + i); } catch (e) { assert.equal(e.status, 429); } }
  assert.equal(f.reject("Сообщение восемь").chatModeration.reason, REASONS.flood);
  assert.equal(f.profile.chatModeration.flood.count, 1);
});
test("censored messages are delivered once and request replay never adds a strike", () => {
  const f = fixture(), id = randomUUID();
  assert.equal(f.send("блядь", id).message.text, "***");
  for (let i = 0; i < 10; i++) assert.equal(f.send("блядь", id).duplicate, true);
  assert.equal(f.profile.chatModeration.profanity.count, 1);
  assert.equal(f.chat.history().messages.length, 1);
  f.advance(15 * MINUTE);
  assert.equal(f.reject("пизда", id).status, 409);
  f.advance(WEEK + 1); f.send("блядь", id);
  assert.equal(f.profile.chatModeration.profanity.count, 1, "old receipt survives the strike window");
  f.send("хуй"); assert.equal(f.profile.chatModeration.profanity.count, 2, "message strikes survive quiet weeks");
});
test("many words are one strike, third message mutes chat, sixth repeats the one hour mute", () => {
  const f = fixture();
  for(let i=1;i<=6;i++) {
    assert.equal(f.send(i + " сука хуй").message.text, i + " *** ***");
    assert.equal(f.profile.chatModeration.profanity.count, i);
    assert.equal(f.profile.moderation?.ban, undefined);
    if(i%3===0) {
      assert.equal(f.profile.chatModeration.mute.until, f.now()+HOUR);
      assert.equal(f.reject("Чистое сообщение").code, "CHAT_MUTED");
      f.advance(HOUR);
    } else f.advance(3000);
  }
  assert.equal(f.profile.chatModeration.profanity.count, 6);
});
test("retrying a rate-limited request cannot replace its text and bypass screening", () => {
  const f = fixture(); f.send("Один"); f.send("Два"); f.send("Три");
  const id = randomUUID(); f.reject("Четыре", id); f.advance(2500);
  assert.equal(f.reject("хуй", id).status, 409);
  assert.equal(f.profile.chatModeration, undefined);
});
test("reading history and long idle intervals do not run screening or mutate a clean profile", () => {
  const f = fixture(), before = structuredClone(f.profile);
  f.send("Привет всем"); const scans = f.chat.moderation.scans;
  for (let i = 0; i < 100; i++) { f.chat.history(); f.chat.moderation.status(f.profile); }
  f.advance(30 * WEEK);
  assert.equal(f.chat.moderation.scans, scans); assert.deepEqual(f.profile, before);
});
test("invalid moderation data fails closed instead of silently resetting strikes", () => {
  assert.doesNotThrow(() => validate({}));
  const good = decision(null, { flood: true }, 1000).next;
  assert.doesNotThrow(() => validate({ chatModeration: good }));
  assert.throws(() => validate({ chatModeration: { ...good, profanity: { count: -1, lastAt: 0 } } }), /Повреждены/);
});
