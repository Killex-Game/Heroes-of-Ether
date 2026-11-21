"use strict";

// Local, bounded dictionary. Match complete words, never arbitrary substrings:
// страхуй, употреблять, рубля, учебник and хулиган are not profanity.
// The owner explicitly includes "сука" and its inflections in automatic screening.
const SUKA = /^(?:сук(?:а|и|е|у|ой|ою|ам|ами|ах)|suk(?:a|i|e|u|oy|oi|oyu|am|ami|ah|akh))$/u;
const RUSSIAN = /^(?:(?:(?:на|по|за|ни|до|о|вы|при|под|от))?ху(?:й[а-я]*|[яеёи][а-я]*)|(?:[а-я]{0,6})пизд[а-я]*|бля(?:д[а-я]*|ть|т[ьъ]?)?|(?:за|вы|на|по|от|до|про|пере|при|под|раз|съ|объ|у|не)?(?:еб[ауеёин][а-я]*|ёб[ауеёин][а-я]*)|(?:долбо|мозго|зло|говно|дармо)еб[а-я]*)$/u;
const LATIN = /^(?:(?:na|po|za|ni|do|o|vy|pri|pod|ot))?(?:[hk]h?u[yij][a-z]*|pizd[a-z]*|blya(?:d[a-z]*|t[a-z]*)?|(?:za|vy|na|po|ot|do|pro|pere|pri|pod|raz|u|ne)?[ey]b(?:at|an|al|nut|uch)[a-z]*)$/;
const ENGLISH = /^(?:fuck(?:ing|er|ers|ed|s)?|motherfucker[s]?|bullshit|shit(?:ty|s|ting)?)$/;
// Whole-word families, not an unanchored /ебл/: стебли, потреблять and
// колеблется must stay valid. Include inflections, suffixes and transliteration.
const EBLO = /^(?:(?:за|вы|на|по|от|до|про|пере|при|под|раз|съ|объ|у|не)?[её]бл[а-яё]*|(?:za|vy|na|po|ot|do|pro|pere|pri|pod|raz|s|ob|u|ne)?(?:e|ye|yo|jo)bl[a-z]*)$/u;
// Selected missing families reviewed against russki-mat.net/e/mat_slovar.htm.
// Do not import its definitions: they also contain perfectly ordinary words.
const DICTIONARY_ADDITIONS = /^(?:выбляд[а-яё]*|вы[её]б(?:он|ыва)[а-яё]*|(?:долбо|мозго|зло|говно|дармо)ёб[а-яё]*)$/u;
const LOOKALIKES = Object.freeze({ a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у", "0": "о", "3": "з", "4": "ч", "6": "б" });
function letters(word) {
  return word.replace(/[abcehkmoptxy0346]/g, c => LOOKALIKES[c]);
}
function bad(word) {
  const simple = word.replace(/(.)\1+/gu, "$1");
  if (/^ебенов(?:ый|ого|ому|ым|ом|ая|ой|ую|ые|ых|ыми|ое)$/u.test(simple)) return false;
  const mapped = letters(word), normalized = mapped.replace(/(.)\1+/gu, "$1");
  return SUKA.test(normalized) || SUKA.test(simple) || RUSSIAN.test(normalized) || LATIN.test(simple) || ENGLISH.test(word) || ENGLISH.test(simple) ||
    // A real prefix boundary can contain two е letters (пере + ебли).
    EBLO.test(mapped) || EBLO.test(word) || EBLO.test(normalized) || EBLO.test(simple) || DICTIONARY_ADDITIONS.test(normalized);
}
function countProfanity(text) {
  const clean = text.normalize("NFKC").toLowerCase().replace(/[\p{M}\p{Cf}]/gu, "");
  const tokens = [...clean.matchAll(/[\p{L}\p{N}]+/gu)];
  let count = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (bad(token[0])) { count++; continue; }
    // Explicitly separated letters: х.у.й / х у й. Do not join ordinary words.
    if (token[0].length !== 1) continue;
    let joined = token[0], end = i;
    for (let j = i + 1; j < Math.min(tokens.length, i + 16); j++) {
      if (tokens[j][0].length !== 1) break;
      const gap = clean.slice(tokens[j - 1].index + tokens[j - 1][0].length, tokens[j].index);
      if (!/^[\s.*_\-·]{1,3}$/u.test(gap)) break;
      joined += tokens[j][0];
      end = j;
    }
    if (end > i && bad(joined)) count++;
    i = end;
  }
  // These masks are unambiguous enough for automatic screening. Deliberately
  // do not infer whole words from arbitrary stars or from a single initial.
  count += [...clean.matchAll(/(?<![\p{L}\p{N}])(?:[хx][*_*·]{1,3}[йяеё]|п[*_*·]{1,3}зда|бл[*_*·]{1,3}[дт]ь|[сc][*_*·]{1,3}[кk][аa])(?![\p{L}\p{N}])/gu)].length;
  return count;
}
function fingerprint(text) {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[\p{M}\p{Cf}]/gu, "");
  return (normalized.replace(/[^\p{L}\p{N}]/gu, "") || normalized.replace(/\s+/gu, ""))
    .replace(/(.)\1{2,}/gu, "$1$1");
}
module.exports = { countProfanity, fingerprint };
