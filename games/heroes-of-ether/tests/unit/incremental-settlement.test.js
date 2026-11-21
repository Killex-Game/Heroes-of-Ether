"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { SettlementCache } = require("../../src/server/profiles/settlement-cache");
const { ClanService } = require("../../src/server/clans/clan-service");
const { randomUUID } = require("node:crypto");
const AT = Date.parse("2026-11-11T12:00:00Z");
test("settlement checks only changed branch rows without hiding additions, removals or expiry", () => {
  const cache=new SettlementCache(),tables=require("../../src/server/profiles/immutable-table-delta");
  const base={a:{account:{vipUntil:AT+10},flag:false},b:{flag:true}}, next={...base,a:{...base.a,flag:true}};
  tables.remember(next,base,["a"]);
  let inspections=0,treasuries=0;
  const inspect=p=>{inspections++;return p.flag;};
  const expiry=(p,at)=>{treasuries++;return p.account?.vipUntil===at;};
  assert.deepEqual([...cache.matchingProfiles('branches',base,inspect)],["b"]);
  assert.equal(cache.worldChestExpiryDue(base,AT,expiry),false);
  assert.deepEqual([...cache.matchingProfiles('branches',next,inspect)],["b","a"]);
  assert.equal(cache.worldChestExpiryDue(next,AT,expiry),false);
  const counts=[inspections,treasuries];
  for(let i=0;i<10;i++)for(const rows of [base,next]) {
    assert.equal(cache.matchingProfiles('branches',rows,inspect).size,rows===base?1:2);
    assert.equal(cache.worldChestExpiryDue(rows,AT+1,expiry),false);
  }
  assert.equal(inspections,counts[0]+20);
  assert.equal(treasuries,counts[1]);
  assert.equal(cache.worldChestExpiryDue(base,AT+10,expiry),true);
  assert.equal(cache.worldChestExpiryDue(next,AT+10,expiry),true);
  assert.equal(cache.worldChestExpiryDue(base,AT+1,expiry),false);
  assert.equal(cache.matchingProfiles('branches',base,p=>!p.flag,'different-rule').size,1);
  const removed={a:next.a};tables.remember(removed,next,["b"]);
  assert.deepEqual([...cache.matchingProfiles('branches',removed,inspect)],["a"]);
  assert.equal(cache.worldChestExpiryDue(removed,AT+10,expiry),true);
});
function comparable(data) {
  const copy = structuredClone(data);
  for (const p of Object.values(copy.profiles))
    for (const [i, entry] of (p.transactions?.entries || []).entries()) entry.id = `entry-${i}`;
  return copy;
}

test("daily projections do not schedule a second personal capture for unchanged Easter inputs", () => {
  let at = AT;
  const full = new ProfileStore({now: () => at});
  const auth = Array.from({length: 12}, () => full.open());
  const fast = new ProfileStore({now: () => at, incrementalSettlement: true});
  fast.data = structuredClone(full.data);
  full.save(full.data); fast.save(fast.data);
  for (let i = 0; i < auth.length; i++) {
    at = AT + i * 50;
    const event = {type: "lifeStarted", profileId: auth[i].profile.id, lifeId: "capture-" + i};
    full.applyArenaProgress("start-" + i, [event], at);
    fast.applyArenaProgress("start-" + i, [event], at);
  }
  for (let second = 1; second <= 4; second++) {
    for (let i = 0; i < auth.length; i++) {
      at = AT + second * 1000 + i * 10;
      const event = {type: "lifeTime", profileId: auth[i].profile.id,
        lifeId: "capture-" + i, durationSeconds: second};
      full.applyArenaProgress(`time-${second}-${i}`, [event], at);
      fast.applyArenaProgress(`time-${second}-${i}`, [event], at);
      assert.deepEqual(comparable(fast.data), comparable(full.data));
      const p = fast.byId(event.profileId);
      assert.equal(fast.settlementCache.needs(p, p, at), false);
      assert.equal(fast.settlementCache.worlds.get(fast.data.profiles).pending.size, 0);
    }
  }
  // The optimization cannot hide a later calendar award or its new inputs.
  at = Date.parse("2026-11-11T21:00:00Z");
  full.save(full.data); fast.save(fast.data);
  assert.deepEqual(comparable(fast.data), comparable(full.data));
  at++;
  full.save(full.data); fast.save(fast.data);
  assert.deepEqual(comparable(fast.data), comparable(full.data));
});
test("Easter due cache preserves collection rewards, egg expiry and backward time", () => {
  const cache=new SettlementCache(), easter=require("../../src/server/events/easter-hunt");
  const tables=require("../../src/server/profiles/immutable-table-delta");
  let rows={a:{easter:{batches:[{expiresAt:AT+30}],runs:{}}},b:{}};
  const check=at=>assert.equal(cache.easterRefreshDue(rows,at,easter.refreshDue),
    Object.values(rows).some(p=>easter.refreshDue(p,at)));
  check(AT);check(AT+29);check(AT+30);
  let next={b:rows.b};tables.remember(next,rows,["a"]);rows=next;check(AT+31);
  next={...rows,b:{easter:{batches:[],runs:{x:{fragments:24,claimed:{}}}}}};
  tables.remember(next,rows,["b"]);rows=next;check(AT+32);
  check(AT-1);rows=structuredClone(rows);check(AT+1);
});
test("settlement cache respects exact expiry, midnight, clock reversal and changed identities", () => {
  const cache = new SettlementCache();
  const p = {account:{vipUntil:AT+7, premiumUntil:AT+11},appearance:{grants:{silver:AT+5}},easter:{batches:[{expiresAt:AT+3}]}};
  assert.equal(cache.needs(p,p,AT),true);
  cache.remember(p,AT);
  assert.equal(cache.needs(p,p,AT+2),false);
  assert.equal(cache.needs(p,p,AT+3),true);
  assert.equal(cache.needs(p,p,AT-1),false); // same validity interval, older room sample
  assert.equal(cache.needs(p,p,AT-86400000),true); // earlier calendar interval
  assert.equal(cache.needs({...p},p,AT+1),true);
  cache.remember(p,AT+3);
  assert.equal(cache.needs(p,p,AT+4),false);
  assert.equal(cache.needs(p,p,AT+5),true);
  cache.remember(p,AT+11);
  const midnight=Date.parse("2026-11-11T21:00:00Z");
  assert.equal(cache.needs(p,p,midnight-1),false);
  assert.equal(cache.needs(p,p,midnight),true);
});
test("published treasury cache rechecks queue, account, notice deadlines and replacement rows", () => {
  const {needsExpiry}=require("../../src/server/clans/clan-chest-rewards");
  const cache=new SettlementCache(); let calls=0;
  const inspect=(p,at)=>{calls++;return needsExpiry(p,at);};
  const p={account:{vipUntil:AT+10,premiumUntil:0},
    clanChests:{items:[],notices:[{at:AT-86400000+20}]},
    quests:{pending:[{stored:false,waitingSince:AT-86400000+30,
      waitingHours:24,expiresAt:AT+30,receivedAt:null}]}};
  assert.equal(cache.chestExpiryDue(p,AT,inspect),false);
  assert.equal(cache.chestExpiryDue(p,AT+9,inspect),false);
  assert.equal(calls,1);
  assert.equal(cache.chestExpiryDue(p,AT+10,inspect),true); // account shortening
  assert.equal(calls,2);
  const q={...p,account:{vipUntil:AT+100,premiumUntil:0}};
  assert.equal(cache.chestExpiryDue(q,AT+11,inspect),false);
  assert.equal(cache.chestExpiryDue(q,AT+19,inspect),false);
  assert.equal(calls,3);
  assert.equal(cache.chestExpiryDue(q,AT+20,inspect),true); // expired notice
  const r={...q,clanChests:{items:[],notices:[]}};
  assert.equal(cache.chestExpiryDue(r,AT+21,inspect),false);
  assert.equal(cache.chestExpiryDue(r,AT+29,inspect),false);
  assert.equal(cache.chestExpiryDue(r,AT+30,inspect),true); // expired queue
  const before=calls;
  assert.equal(cache.chestExpiryDue(r,AT,inspect),false); // backward clock
  assert.equal(calls,before); // earlier timestamp still within the same account/expiry interval
  const replaced={...r,quests:{pending:[{...r.quests.pending[0],receivedAt:AT}]}};
  assert.equal(cache.chestExpiryDue(replaced,AT+1,inspect),true); // newly received
});

test("unchanged treasury inputs survive unrelated progress but purchases and chest changes recheck", () => {
  const {needsExpiry}=require("../../src/server/clans/clan-chest-rewards");
  const cache=new SettlementCache(); let calls=0;
  const inspect=(p,at)=>{calls++;return needsExpiry(p,at);};
  const p={clanChests:{items:[],notices:[]},account:{vipUntil:0,premiumUntil:0},quests:{pending:[]}};
  assert.equal(cache.chestExpiryDue(p,AT,inspect),false);
  let next={...p,level:50,quests:{...p.quests,session:{lifeId:'next'}}};
  assert.equal(cache.chestExpiryDue(next,AT+1,inspect),false); assert.equal(calls,1);
  next={...next,account:{vipUntil:AT+10,premiumUntil:0}};
  assert.equal(cache.chestExpiryDue(next,AT+2,inspect),false); assert.equal(calls,2);
  assert.equal(cache.chestExpiryDue({...next},AT+10,inspect),false); assert.equal(calls,3);
  for(const field of ['quests','easter','blackFriday']) {
    const key=field==='quests'?'pending':'chests';
    const changed={...next,[field]:{[key]:[{stored:false,receivedAt:null,waitingSince:AT-86400000,
      waitingHours:24,expiresAt:AT}]}};
    assert.equal(cache.chestExpiryDue(changed,AT+3,inspect),true);
    assert.equal(cache.chestExpiryDue({...changed},AT+4,inspect),true); // never cache a due result
  }
  const notice={...next,clanChests:{items:[],notices:[{at:AT-86400000}]}};
  assert.equal(cache.chestExpiryDue(notice,AT+3,inspect),true);
});

test("world treasury expiry cannot be skipped by deltas, removal, clock reversal or unknown worlds", () => {
  const {needsExpiry}=require("../../src/server/clans/clan-chest-rewards");
  const tables=require("../../src/server/profiles/immutable-table-delta");
  const cache=new SettlementCache();
  const p={account:{vipUntil:0,premiumUntil:0},clanChests:{items:[],notices:[]},
    quests:{pending:[{stored:false,waitingSince:AT-10800000+30,waitingHours:3,
      expiresAt:AT+30,receivedAt:null}]}};
  let rows={one:p,two:{...p,quests:{pending:[]}}};
  const check=time=>assert.equal(cache.worldChestExpiryDue(rows,time,needsExpiry),
    Object.values(rows).some(x=>needsExpiry(x,time)));
  check(AT);check(AT+10);
  let next={...rows,two:{...rows.two,level:2}};
  tables.remember(next,rows,["two"]); rows=next;check(AT+20);check(AT+30);
  next={two:rows.two};tables.remember(next,rows,["one"]);rows=next;
  check(AT+31);check(AT-1);
  rows=structuredClone({one:p});check(AT+29);check(AT+30);
  next={...rows,one:{...p,quests:{pending:[]}}};tables.remember(next,rows,["one"]);rows=next;
  check(AT+31);check(AT+100);
});
test("out-of-order room samples reuse only the exact treasury validity interval", () => {
  const {needsExpiry}=require("../../src/server/clans/clan-chest-rewards");
  const cache=new SettlementCache();let checks=0;
  const inspect=(p,at)=>{checks++;return needsExpiry(p,at);};
  const p={account:{vipUntil:AT+10,premiumUntil:0},quests:{pending:[{
    stored:false,waitingSince:AT,waitingHours:3,expiresAt:AT+10800000,receivedAt:null,
  }]}};
  const rows={a:p};
  for(const at of [AT+12,AT+11,AT+15,AT+10,AT+13]){
    assert.equal(cache.worldChestExpiryDue(rows,at,inspect),false);
    assert.equal(needsExpiry(p,at),false);
  }
  assert.equal(checks,1);
  assert.equal(cache.worldChestExpiryDue(rows,AT+9,inspect),true); // VIP was still active
  assert.equal(checks,2);
  assert.equal(cache.worldChestExpiryDue(rows,AT+10800000,inspect),true);
});
test("incremental captures match the full calculation through progress, idle expiry and midnight", () => {
  let at=AT;
  const full=new ProfileStore({now:()=>at});
  const fast=new ProfileStore({now:()=>at,incrementalSettlement:true});
  const auth=Array.from({length:18},()=>full.open());
  const seeded=structuredClone(full.data);
  const keys=Object.keys(seeded.profiles), selected=seeded.profiles[keys[0]];
  selected.account={vipUntil:AT+5000,premiumUntil:0};
  selected.appearance.arenaFrame="vip";
  full.save(seeded); fast.data=structuredClone(full.data);
  const check=()=>assert.deepEqual(comparable(fast.data),comparable(full.data));
  // Fill the cache without changing values, including newly loaded profiles.
  full.save(full.data); fast.save(fast.data); check();
  for (let i=1;i<=30;i++) {
    at=AT+i*250;
    const before=structuredClone(fast.data), old=fast.data;
    const a=auth[i%auth.length];
    const events=[{type:"massPeak",profileId:a.profile.id,mass:1000+i}];
    full.applyArenaProgress(`sample-${i}`,events,at);
    fast.applyArenaProgress(`sample-${i}`,events,at);
    check(); assert.deepEqual(old,before);
  }
  assert.equal(fast.data.profiles[keys[0]].appearance.arenaFrame,"default");
  for (const time of ["2026-11-11T20:59:59.999Z","2026-11-11T21:00:00Z","2026-11-12T02:00:00Z"]) {
    at=Date.parse(time); full.save(full.data); fast.save(fast.data); check();
  }
});
test("incremental competition invalidates cached participation after membership and league-visit edits", () => {
  const full=new ProfileStore({now:()=>AT}), service=new ClanService(full);
  const owner=full.open();
  full.transact(owner.token,randomUUID(),"fund",p=>{p.level=12;p.wallet.coins=10000;});
  service.mutate(owner.token,{action:"create",requestId:randomUUID(),name:"Тест",prefix:"TST",emblem:"astral",privacy:"open"});
  const fast=new ProfileStore({now:()=>AT,incrementalSettlement:true});
  fast.data=structuredClone(full.data);
  const check=()=>assert.deepEqual(comparable(fast.data),comparable(full.data));
  for (let i=0;i<4;i++) {full.save(full.data);fast.save(fast.data);check();}
  const key=Object.keys(full.data.profiles)[0], clanId=full.data.profiles[key].clanId;
  // Removing a previously validated visit must restore it through the full path.
  for (const store of [full,fast]) {
    const p=store.data.profiles[key];
    store.save({...store.data,profiles:{...store.data.profiles,[key]:{...p,activity:{...p.activity,leagueVisits:[]}}}});
  }
  check(); assert.ok(fast.data.profiles[key].activity.leagueVisits.length);
  for (const store of [full,fast]) {
    const p=store.data.profiles[key], c=store.data.clans[clanId];
    store.save({...store.data,profiles:{...store.data.profiles,[key]:{...p,clanId:null}},clans:{...store.data.clans,[clanId]:{...c,members:[]}}});
  }
  check();
});

test("scoped settlement preserves untouched spouse rewards and newly loaded worlds", () => {
  let at=AT;
  const full=new ProfileStore({now:()=>at}), fast=new ProfileStore({now:()=>at,incrementalSettlement:true});
  full.open(); full.open(); full.open();
  const keys=Object.keys(full.data.profiles), initial=structuredClone(full.data);
  const a=initial.profiles[keys[0]], b=initial.profiles[keys[1]];
  a.social={marriage:{partnerId:b.id,at:AT-86400000}};
  b.social={marriage:{partnerId:a.id,at:AT-86400000}};
  full.save(initial); fast.data=structuredClone(initial);
  const check=()=>assert.deepEqual(comparable(fast.data),comparable(full.data));
  fast.save(fast.data); check();
  for(const store of [full,fast]) store.save(store.data);
  check();
  // The second spouse is unchanged by this request but must refresh its key.
  for(const store of [full,fast]) {
    const p=store.data.profiles[keys[0]];
    store.save({...store.data,profiles:{...store.data.profiles,[keys[0]]:{...p,social:{...p.social,marriage:{...p.social.marriage,at:AT}}}}});
  }
  check();
  for(const time of [AT+86400000,AT-1,AT+2*86400000]) {
    at=time; full.save(full.data); fast.save(fast.data); check();
  }
  // An externally loaded object must not inherit a previous world's cache.
  fast.data=structuredClone(full.data);
  at+=86400000; full.save(full.data); fast.save(fast.data); check();
  assert.ok(fast.data.profiles[keys[1]].activity.values.strong_love>0);
});

test("clan captures match uncached settlement at expiry, level changes and preview toggles", () => {
  let at=AT;
  const full=new ProfileStore({now:()=>at}), service=new ClanService(full);
  const owner=full.open();
  full.transact(owner.token,randomUUID(),"fund",p=>{p.level=12;p.wallet.coins=10000;});
  service.mutate(owner.token,{action:"create",requestId:randomUUID(),name:"Проверка",prefix:"CHK",emblem:"astral",privacy:"open"});
  const fast=new ProfileStore({now:()=>at,incrementalSettlement:true});
  fast.data=structuredClone(full.data);
  const id=Object.keys(full.data.clans)[0];
  const check=()=>{
    full.save(full.data); fast.save(fast.data);
    assert.deepEqual(comparable(fast.data),comparable(full.data));
  };
  check();
  for(const store of [full,fast]){
    const c=store.data.clans[id];
    store.save({...store.data,clans:{...store.data.clans,[id]:{...c,
      appearance:{background:"silver",grantVersion:2,grants:{silver:AT+10}},
    }}});
  }
  check();
  for(const time of [AT+9,AT+10,AT-1,AT+11]){at=time;check();}
  assert.equal(fast.data.clans[id].appearance.background,"default");
  for(const xp of [0,130000,10000000,0]){
    for(const store of [full,fast]){
      const c=store.data.clans[id];
      store.save({...store.data,clans:{...store.data.clans,[id]:{...c,xp,
        crest:{frame:"f18_trefoil",color:"c01_royal_purple",symbol:"s01_crown",metal:"gold"},
      }}});
    }
    check();
  }
  for(const unlocked of [true,false,true,false]){
    full.unlockClanCrests=fast.unlockClanCrests=unlocked;
    full.unlockLeagueBackgrounds=fast.unlockLeagueBackgrounds=unlocked;
    check();
  }
});

test("incremental event recovery finds newly added pending rewards and consumes them exactly once", () => {
  const f=require("../helpers/black-friday-fixture")();
  const lucky=require("../../src/server/events/lucky-week"), friday=require("../../src/server/events/black-friday");
  const tables=require("../../src/server/profiles/immutable-table-delta"), cache=new SettlementCache();
  let world=f.store.data;
  for(const service of [lucky,friday]) assert.equal(service.recoveryDue(world,f.manager,cache),false);
  const key=Object.keys(world.profiles)[0], p=world.profiles[key];
  const next={...world,profiles:{...world.profiles,[key]:{...p,progress:{...p.progress,lastLife:{
    pendingEventLevel:{runId:f.run.id,at:f.now()},pendingFridayLevel:{runId:f.run.id,at:f.now()},
    levelReward:{levels:1},
  }}}}};
  tables.remember(next.profiles,world.profiles,[key]);world=next;
  for(const service of [lucky,friday]) assert.equal(service.recoveryDue(world,f.manager,cache),true);
  assert.equal(friday.recover(world,null,f.now(),cache),world);
  const expected=friday.recover(lucky.recover(world,f.manager,f.now()),f.manager,f.now());
  const fast=friday.recover(lucky.recover(world,f.manager,f.now(),cache),f.manager,f.now(),cache);
  assert.deepEqual(fast,expected);
  assert.equal(fast.profiles[key].progress.lastLife.levelReward.fridayTokens,5);
  for(const service of [lucky,friday]){
    assert.equal(service.recoveryDue(fast,f.manager,cache),false);
    assert.equal(service.recover(fast,f.manager,f.now(),cache),fast);
  }
  // An unrelated snapshot and removal cannot reuse an obsolete empty result.
  const unknown=structuredClone(world);
  assert.equal(friday.recoveryDue(unknown,f.manager,cache),true);
  const empty={...unknown,profiles:{}};
  tables.remember(empty.profiles,unknown.profiles,[key]);
  assert.equal(friday.recoveryDue(empty,f.manager,cache),false);
});
