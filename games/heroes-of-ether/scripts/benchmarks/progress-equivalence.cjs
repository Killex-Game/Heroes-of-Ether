/* Deterministic old/new source oracle. Synthetic profiles; no live store. */
"use strict";
const fs = require("node:fs"), crypto = require("node:crypto");
let serial = 0, seed = 7301, at = Date.parse("2026-11-03T20:59:58Z");
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
crypto.randomUUID = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, "0")}`;
crypto.randomBytes = count => Buffer.from(Array.from({length:count}, () => Math.floor(random()*256)));
crypto.randomInt = (a,b) => b === undefined ? Math.floor(random()*a) : a+Math.floor(random()*(b-a));
Date.now = () => at;
Math.random = random;
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { awardTitles, prepareChest } = require("../../src/server/progression/title-chest-rewards");
const store = new ProfileStore({ now: () => at });
const profiles = [];
for (let i = 0; i < 12; i++) {
  const auth = store.open(), p = store.find(auth.token);
  p.account = require("../../src/server/accounts/account-benefits").fresh();
  p.account.vipUntil = i % 4 < 2 ? at + 5000 : 0;
  p.account.premiumUntil = i % 4 % 2 ? at + 15000 : 0;
  p.activity.registeredAt = at - 15*86400000 + 3000;
  p.progress.boosterUses = 99;
  if (i % 2) {
    p.greatness = 5000;
    awardTitles(p, at);
    prepareChest(p, "novice", at);
  }
  profiles.push(p.id);
}
function freeze(o) {
  if (!o || typeof o !== "object" || Object.isFrozen(o)) return;
  Object.freeze(o); for (const v of Object.values(o)) freeze(v);
}
const hashes = [], digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
for (let round = 0; round < 50; round++) {
  at += 500;
  const events = profiles.flatMap((profileId, i) => {
    const lifeId = `life-${i}`, base = { profileId, lifeId };
    if (round === 0) return [{...base,type:"lifeStarted"}];
    if (round >= 48) return [{...base,type:"lifeEnded",durationSeconds:24,reason:"left"}];
    return [
      {...base,type:"massPeak",mass:[50,150,1000,25000,40000,75000,120000,480000][round%8]},
      {...base,type:"boosterUsed",mass:25000},
      {...base,type:"lifeTime",durationSeconds:Math.floor(round/2)},
      {...base,type:"questSample",food:round*200,rank:i+1},
      {...base,type:"absorbed",victimProfileId:profiles[(i+1)%profiles.length],lifeId:`victim-${round}`,
        victimPartId:`part-${round}`,gain:1000,spaceSplit:true,victimDefeated:true},
    ];
  });
  freeze(store.data);
  const selected = process.argv.includes("--passive") ? events.filter(e => !["boosterUsed", "absorbed"].includes(e.type)) : events;
  store.applyArenaProgress(`oracle-${round}`,selected,at);
  hashes.push(digest(store.data));
}
fs.writeFileSync(process.argv[2], JSON.stringify({hashes,final:store.data}));
console.log(JSON.stringify({batches:hashes.length,profiles:profiles.length,hash:hashes.at(-1)}));
