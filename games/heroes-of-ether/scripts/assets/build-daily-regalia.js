/* Регалии суточных топов: объёмная эмаль, чеканный металл и спокойный лавровый венок. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { medals } = require("../../public/shared/daily-ranking-rules");
const metals = [
  ["#fff7ce", "#ffdb65", "#ce8a20", "#784015"],
  ["#f8ffff", "#daebf3", "#8ea8bd", "#455e7a"],
  ["#ffe6bf", "#edb47c", "#b96c38", "#693b27"],
];
const faces = {
  kills: ["#f37c91", "#b5264b", "#58152d"],
  time: ["#79d7ed", "#287fb1", "#183b6b"],
  greatness: ["#c79bea", "#8150b3", "#402461"],
};
function artwork(medal) {
  const category = medal.id.split("-")[0],
    place = medal.place;
  const [shine, light, mid, dark] = metals[place - 1],
    [faceLight, face, faceDark] = faces[category];
  const motif =
    category === "kills"
      ? `<path d="m53 27 23 23m-4-26-23 27m-2-7 8 7m15-7 8 7" fill="none" stroke="${shine}" stroke-width="3.2" stroke-linecap="round"/><path d="m50 24 7 3-4 4Zm28-3-3 7-4-4Z" fill="${shine}"/>`
      : category === "time"
        ? `<path d="M55 25h18M55 49h18M57 26c0 6 2 8 7 11-5 3-7 5-7 11m14-22c0 6-2 8-7 11 5 3 7 5 7 11" fill="none" stroke="${shine}" stroke-width="2.5" stroke-linecap="round"/><path d="m60 29 4 5 4-5Zm-1 16h10l-5-5Z" fill="${light}"/>`
        : `<path d="m64 23 4 8 9 1-7 7 2 10-8-5-8 5 2-10-7-7 9-1Z" fill="url(#metal)" stroke="${shine}" stroke-width="1"/><path d="m64 27 1 9-5 3Z" fill="${shine}" opacity=".8"/>`;
  // Крупные листья читаются и при уменьшении до размера строки топа.
  const laurel = `<path d="M43 108Q13 96 15 57" fill="none" stroke="${mid}" stroke-width="2.5"/>
    <path d="M17 77Q4 73 8 60q11 3 9 17Zm5 14Q8 90 8 77q12 0 14 14Zm9 11Q16 105 13 92q13-3 18 10Zm12 7Q31 116 24 105q11-7 19 4Z"/>
    <path d="M17 78q-3-14 9-20 4 13-9 20Zm5 13q-3-13 7-20 6 12-7 20Zm9 11q-5-12 4-20 8 10-4 20Z"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 132"><title>${medal.name}</title>
  <defs>
    <linearGradient id="metal" x1=".15" y1="0" x2=".8" y2="1"><stop stop-color="${shine}"/><stop offset=".25" stop-color="${light}"/><stop offset=".48" stop-color="${mid}"/><stop offset=".64" stop-color="${shine}"/><stop offset=".8" stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></linearGradient>
    <linearGradient id="bevel" x2=".3" y2="1"><stop stop-color="${mid}"/><stop offset=".5" stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient>
    <radialGradient id="enamel" cx=".35" cy=".18" r=".9"><stop stop-color="${faceLight}"/><stop offset=".45" stop-color="${face}"/><stop offset="1" stop-color="${faceDark}"/></radialGradient>
    <linearGradient id="gloss" x2=".3" y2="1"><stop stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <path d="m40 96-7 31 16-7 12 7 4-29m23-2 7 31-16-7-12 7-4-29" fill="${faceDark}" stroke="${dark}" stroke-width="1.5"/>
  <path d="m42 104-4 16 10-5m38-11 4 16-10-5" fill="none" stroke="${mid}" stroke-width="2"/>
  <path d="m64 6 34 14 16 35-10 40-40 24-40-24-10-40 16-35Z" fill="url(#metal)" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
  <path d="m64 11 31 13 14 32-9 36-36 22-36-22-9-36 14-32Z" fill="url(#bevel)" stroke="${shine}" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="m64 16 27 11 13 30-9 32-31 19-31-19-9-32 13-30Z" fill="url(#enamel)" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>
  <path d="m64 19 25 10 11 25Q63 42 29 59l11-29Z" fill="url(#gloss)"/>
  <path d="M37 31 64 20l25 11M33 84l7 9 24 14 24-14 7-9" fill="none" stroke="${shine}" stroke-width="1" opacity=".65" stroke-linecap="round"/>
  ${motif}
  <g fill="url(#metal)" stroke="${dark}" stroke-width=".7" stroke-linejoin="round">${laurel}<g transform="translate(128 0) scale(-1 1)">${laurel}</g></g>
  <text x="64" y="92" text-anchor="middle" font-family="Georgia,serif" font-size="49" font-weight="bold" fill="${faceDark}" stroke="${faceDark}" stroke-width="4">${place}</text>
  <text x="64" y="90" text-anchor="middle" font-family="Georgia,serif" font-size="49" font-weight="bold" fill="url(#metal)" stroke="${dark}" stroke-width=".7">${place}</text>
  <path d="m60 109 4-3 4 3-4 4Z" fill="${shine}" stroke="${mid}"/>
  <path d="m31 23 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z" fill="${shine}"/>
  </svg>\n`;
}
for (const medal of medals) {
  const target = path.resolve(__dirname, "../../public", medal.image);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, artwork(medal));
}
console.log("Создано регалий: " + medals.length);
