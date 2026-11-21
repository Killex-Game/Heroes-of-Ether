"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { copyArenaData, shareArenaData } = require("../../src/server/profiles/arena-profile-copy");
const { ProfileStore } = require("../../src/server/profiles/profile-store");

test("Arena drafts preserve persisted JSON values, including unknown fields and array holes", () => {
  const source = {
    progress: { xp: 123456, session: { id: "life", xp: 35, kills: 2 } },
    future: [{ count: 0, ok: true, title: "Герои Эфира" }, null, -12.5],
    omitted: undefined,
    holes: [undefined, , NaN, Infinity, -0],
    map: JSON.parse('{"__proto__":{"saved":true},"constructor":7}'),
    futureDate: new Date("2026-11-06T00:00:00Z"),
  };
  assert.deepEqual(copyArenaData(source), JSON.parse(JSON.stringify(source)));
});

test("Nested arena draft mutations never change committed inventory, history or future data", () => {
  const source = {
    inventory: { meat: 20 },
    progress: { recentVictims: { rival: 1000 }, session: { splitVictims: ["one"] } },
    future: [{ nested: { value: 1 } }],
  };
  const before = JSON.stringify(source);
  const draft = copyArenaData(source);
  draft.inventory.meat--;
  delete draft.progress.recentVictims.rival;
  draft.progress.session.splitVictims.push("two");
  draft.future[0].nested.value = 2;
  assert.equal(JSON.stringify(source), before);
});

test("Arena copy rejects non-JSON integer values before a draft can be committed", () => {
  assert.throws(() => copyArenaData({ future: { amount: 1n } }), TypeError);
});

test("reconciled arena drafts share only equal branches and preserve all changed JSON values", () => {
  const base={progress:{xp:10,session:{xp:2,splitVictims:['a']}},
    activity:{values:{first:1,second:2},claimed:{first:0}},quests:{items:[{id:'one',progress:0},{id:'two',progress:3}],pending:[{id:'chest'}]},
    unusual:JSON.parse('{"__proto__":{"value":1}}')};
  const saved=structuredClone(base),draft=copyArenaData(base);
  draft.progress.session.xp=7;draft.quests.items[1].progress=4;
  draft.activity.values.first=9;delete draft.activity.values.second;
  const expected=structuredClone(draft),merged=shareArenaData(base,draft);
  assert.deepEqual(merged,expected);assert.deepEqual(base,saved);
  assert.equal(merged.quests.pending,base.quests.pending);
  assert.equal(merged.quests.items[0],base.quests.items[0]);
  assert.notEqual(merged.quests.items[1],base.quests.items[1]);
  assert.equal(merged.activity.claimed,base.activity.claimed);
  assert.equal(merged.unusual,base.unusual);
  const later=copyArenaData(merged);later.quests.pending.push({id:'second'});
  assert.deepEqual(base,saved);assert.deepEqual(merged,expected);
  for(const value of [null,[],{},[1],{a:1}])for(const next of [null,[],{},[1],{a:1}])
    assert.deepEqual(shareArenaData(value,copyArenaData(next)),next);
});

test("arena degree awards and completed clan lives replace shared maps without mutating published history", () => {
  const at=Date.parse('2026-11-11T10:00:00Z'),store=new ProfileStore({now:()=>at});
  const user=store.open();store.startLife(user.profile.id,'copy-life');
  const key=Object.keys(store.data.profiles)[0],p=store.data.profiles[key];
  p.clanId='copy-clan';p.progress.session.activityClan=p.clanId;
  p.activity.arenaSeconds=24*3600-60;p.activity.values.gamer=23;
  p.activity.clanLives[p.clanId]=4;p.activity.values.for_clan=4;
  const original=structuredClone(store.data);
  function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}}
  freeze(store.data);
  const event={type:'lifeEnded',profileId:p.id,lifeId:'copy-life',durationSeconds:60,reason:'absorbed'};
  const result=store.arenaProgressDraft(store.data,'copy-awards',[event],at+60000).next.profiles[key];
  assert.deepEqual(store.data,original);
  assert.equal(result.activity.claimed.gamer,1);assert.equal(result.activity.stageSpent.gamer,24);
  assert.equal(result.activity.claimed.for_clan,1);assert.equal(result.activity.clanLives[p.clanId],5);
  assert.notEqual(result.activity.claimed,p.activity.claimed);
  assert.notEqual(result.activity.stageSpent,p.activity.stageSpent);
  assert.equal(result.activity.leagueVisits,p.activity.leagueVisits);
  assert.equal(p.activity.claimed.gamer,0);assert.equal(p.activity.clanLives[p.clanId],4);
});
