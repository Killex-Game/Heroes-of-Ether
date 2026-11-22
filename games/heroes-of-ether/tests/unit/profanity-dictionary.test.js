"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { countProfanity } = require("../../src/server/chat/profanity");
const { ChatService } = require("../../src/server/chat/chat-service");

test("eblo family: inflections, suffixes, prefixes and existing related forms", () => {
  for (const word of ["ебло", "ебла", "еблу", "еблом", "ебле", "еблы", "еблам", "еблами", "еблах",
    "еблище", "еблища", "еблищу", "еблищем", "еблищами", "еблина", "еблиной", "еблица", "еблицы",
    "еблан", "ебланы", "ебланка", "ебланами", "ебланский", "ебланство", "ебланить", "ебланишь",
    "ебланиться", "ебланский", "ебловый", "еблоид", "еблень", "ебля", "еблёй", "еблю",
    "уеблище", "уеблищный", "заебло", "заебли", "съеблись", "объебли", "проебли", "переебли",
    "ебальник", "ебальники", "ебальником"]) {
    for (const variant of [word, word.replace(/е(?=б)/gu, "ё"), word.toUpperCase()])
      assert.equal(countProfanity(variant), 1, variant);
  }
});

test("eblo family: transliteration, lookalikes, accents, repeat and separated letters", () => {
  for (const word of ["eblo", "yeblo", "yoblo", "joblo", "eblom", "eblishche", "eblan", "ueblishe",
    "zaeblo", "eблo", "е6л0", "ЕБЛООО", "переeбли", "е\u0301бло", "е\u200bбло", "е.б.л.о", "е б л о", "e b l o"])
    assert.equal(countProfanity(word), 1, word);
  assert.equal(countProfanity("ебло, ёблище; eblo"), 3);
});

test("selected dictionary families and compound yo forms", () => {
  for (const word of ["выблядок", "выблядки", "выблядков", "выблядовал", "выблядовывать",
    "выебон", "выебоны", "выебонами", "выёбывается", "выёбываться", "выебываешься",
    "долбоёб", "долбоёбы", "мозгоёб", "дармоёб", "долбоёбский"])
    assert.equal(countProfanity(word), 1, word);
});

test("ordinary ebl substrings and dictionary explanatory words stay allowed", () => {
  for (const text of ["стебли", "стебля", "стебло", "стеблей", "колеблется", "колеблюсь", "колеблющийся",
    "потреблять", "употребление", "истребление", "истреблять", "потребление", "леблонд", "деблокировать",
    "неблагодарный", "ебеновый", "ебеновая", "корабль", "рубль", "выбрать", "бляха", "хулиган",
    "страхуй", "сук", "барсука", "изучение", "поведение", "физика", "герой", "бустер", "количество",
    "стебли колеблются, можно употреблять в пищу", "к о л е б л е т с я"])
    assert.equal(countProfanity(text), 0, text);
});

test("new family is censored and request replay adds no strike", () => {
  let at = 100000;
  const p = { id: "dictionary-test", name: "Игрок", receipts: {} }, chat = new ChatService({ now: () => at });
  const send = (text, id) => chat.send(p, null, null, { text, requestId: id });
  assert.equal(send("ебло", "11111111-1111-4111-8111-111111111111").message.text, "***");
  assert.equal(p.chatModeration.profanity.count, 1);
  assert.equal(p.chatModeration.mute, null);
  assert.equal(send("ебло", "11111111-1111-4111-8111-111111111111").duplicate, true);
  assert.equal(p.chatModeration.profanity.count, 1);
  at += 15 * 60000 + 1;
  assert.equal(send("выёбываешься", "22222222-2222-4222-8222-222222222222").message.text, "***");
  assert.equal(p.chatModeration.profanity.count, 2);
  assert.equal(p.chatModeration.mute, null);
});
