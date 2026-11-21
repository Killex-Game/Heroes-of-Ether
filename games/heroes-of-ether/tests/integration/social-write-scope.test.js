"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { temporary } = require("../temp");
function setup(options = {}) {
  const store = new ProfileStore({ now: () => Date.UTC(2026, 10, 12, 12), ...options });
  const a = store.open(), b = store.open(), idle = store.open();
  store.transact(a.token, randomUUID(), "seed", p => { p.wallet.coins = 10000; });
  store.save(structuredClone(store.data));
  return { store, a, b, idle };
}
function gift(b) { return { action: "gift", targetId: b.profile.id, giftId: "teddy", confirmed: true, requestId: randomUUID() }; }
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value); for (const v of Object.values(value)) freeze(v);
}

test("marriage acceptance touches spouses and invitation recipients only, including rollback and replay", () => {
  let at = Date.UTC(2026, 10, 16, 10);
  const store = new ProfileStore({ now: () => at, incrementalSettlement: true });
  const people = Array.from({ length: 5 }, () => store.open()), [a,b,c,d,idle] = people;
  for (const [i, who] of people.entries()) store.transact(who.token, randomUUID(), "fixture", p => {
    p.personal = { ...p.personal, gender: ["male","female","female","male","male"][i] };
  });
  const invite = (from,to) => store.socialAction(from.token, { action:"invite",targetId:to.profile.id,name:store.find(to.token).name,requestId:randomUUID() });
  invite(a,b); at += 31000; invite(a,c); invite(d,c); invite(b,d);
  const command = { action:"accept", invitationId:store.find(b.token).social.invitations[0].id,requestId:randomUUID() };
  const previous = store.data, snapshot = structuredClone(previous), idleBefore = store.find(idle.token), save = store.save;
  freeze(previous);
  store.save = () => { throw Error("disk failure"); };
  assert.throws(() => store.socialAction(b.token,command), /disk failure/);
  assert.strictEqual(store.data,previous); assert.deepEqual(previous,snapshot);
  store.save = save;
  store.socialAction(b.token,command);
  assert.strictEqual(store.find(idle.token),idleBefore);
  assert.deepEqual(previous,snapshot);
  assert.equal(store.find(a.token).social.marriage.partnerId,b.profile.id);
  assert.equal(store.find(b.token).social.marriage.partnerId,a.profile.id);
  assert.deepEqual(store.find(c.token).social.invitations.map(i=>i.fromId),[d.profile.id]);
  assert.deepEqual(store.find(d.token).social.invitations,[]);
  assert.equal(store.socialAction(b.token,command).replay,true);
});
test("Gifts preserve unrelated profiles and cannot mutate committed snapshots on a failed save", () => {
  const {store,a,b,idle}=setup(), previous=store.data, input=gift(b), save=store.save;
  freeze(previous);
  store.save=()=>{throw Error("disk full");};
  assert.throws(()=>store.socialAction(a.token,input),/disk full/);
  assert.strictEqual(store.data,previous);
  store.save=save;
  store.socialAction(a.token,input);
  assert.strictEqual(store.find(idle.token),Object.values(previous.profiles).find(p=>p.id===idle.profile.id));
  const balance=store.find(a.token).wallet.coins;
  assert.equal(store.find(b.token).social.gifts[0].count,1);
  assert.equal(store.socialAction(a.token,input).replay,true);
  assert.equal(store.find(a.token).wallet.coins,balance);
  assert.equal(store.find(b.token).social.gifts[0].count,1);
  assert.throws(()=>store.socialAction(a.token,{...input,targetId:a.profile.id}),/номер/);
});
test("Gift, self-gift and read receipts survive journal recovery without duplicate charges", async t => {
  const filePath=path.join(temporary(t,"gift-scope"),"profiles.json");
  const {store,a,b,idle}=setup({filePath,journal:true});
  let restored;
  try {
    const input=gift(b), balance=store.find(a.token).wallet.coins;
    const original=store.data, sync=fs.fsyncSync;
    let failOnce=true;
    const mock=t.mock.method(fs,"fsyncSync",fd=>{if(failOnce){failOnce=false;throw Error("sync failed");}return sync(fd);});
    assert.throws(()=>store.socialAction(a.token,input),/sync failed/);
    assert.strictEqual(store.data,original);
    mock.mock.restore(); assert.equal(fs.fsyncSync,sync);
    store.socialAction(a.token,input);
    const notice=store.find(b.token).social.gifts[0].history[0].id;
    const ack={action:"gift-read",noticeId:notice,requestId:randomUUID()};
    store.socialAction(b.token,ack);
    store.socialAction(a.token,gift(a));
    const saved=structuredClone(store.data);
    await store.close();
    restored=new ProfileStore({filePath,journal:true,now:store.now});
    const recovered=structuredClone(restored.data);
    assert.ok(Number.isSafeInteger(recovered._journalRevision));
    delete recovered._journalRevision;
    delete saved._journalRevision;
    assert.deepEqual(recovered,saved);
    assert.equal(restored.socialAction(a.token,input).replay,true);
    assert.equal(restored.socialAction(b.token,ack).replay,true);
    assert.equal(restored.find(b.token).social.gifts[0].count,1);
    assert.ok(restored.find(b.token).social.gifts[0].history[0].readAt);
    assert.ok(restored.find(a.token).wallet.coins<balance);
    assert.equal(restored.find(idle.token).social,undefined);
  } finally { await (restored||store).close(); }
});
test("A gift racing an arena flush preserves both the gift and retried battle progress", async t => {
  const filePath=path.join(temporary(t,"gift-arena-race"),"profiles.json");
  const {store,a,b}=setup({filePath,journal:true});
  try {
    store.startLife(b.profile.id,"life");
    const event={type:"absorbed",profileId:b.profile.id,victimProfileId:"opponent",gain:35,lifeId:"life"};
    const flush=fs.fsync; let finish;
    const mock=t.mock.method(fs,"fsync",(fd,callback)=>{finish=()=>flush(fd,callback);});
    const writing=store.applyArenaProgress("gift-race",[event],store.now(),true);
    const input=gift(b);
    store.socialAction(a.token,input);
    assert.equal(store.find(b.token).social.gifts[0].count,1);
    finish(); assert.equal(await writing,null,"stale arena draft must not overwrite gift");
    mock.mock.restore();
    assert.deepEqual(await store.applyArenaProgress("gift-race",[event],store.now(),true),[b.profile.id]);
    assert.deepEqual(await store.applyArenaProgress("gift-race",[event],store.now(),true),[]);
    assert.equal(store.socialAction(a.token,input).replay,true);
    assert.equal(store.find(b.token).progress.absorbedMass,35);
    assert.equal(store.find(b.token).social.gifts[0].count,1);
    const recovered=require("../../src/server/profiles/profile-journal").recover(filePath).data;
    assert.deepEqual(Object.values(recovered.profiles).find(p=>p.id===b.profile.id),store.find(b.token));
  } finally { await store.close(); }
});
