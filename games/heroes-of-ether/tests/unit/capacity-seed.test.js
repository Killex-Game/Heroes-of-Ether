"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {createHash}=require("node:crypto"),seed=require("../../scripts/benchmarks/capacity-seed.cjs"),{fromStart}=require("../../scripts/benchmarks/game-clock.cjs");
const at="2026-11-24T09:00:00.000Z",clock=()=>fromStart(at,Date.parse("2026-11-25T00:00:00.000Z"));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"heroether-seed-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,"seed.json");return {file,proof:seed.save(file,at,Date.parse(at))};}
test("paired load runs reuse the same starting world while private drafts and retained histories stay separate",t=>{
 const {file,proof}=fixture(t),bytes=fs.readFileSync(file),first=seed.read(file,clock()),second=seed.read(file,clock());
 assert.deepEqual(first,second);assert.equal(first.proof.sha256,proof.sha256);
 const key=Object.keys(first.fixture.data.profiles)[0];first.fixture.data.profiles[key].wallet.coins++;
 assert.notEqual(first.fixture.data.profiles[key].wallet.coins,second.fixture.data.profiles[key].wallet.coins);
 require("../../scripts/benchmarks/realistic-lobby-plan.cjs").detachLobby(first.fixture,60,5,2);
 require("../../scripts/benchmarks/retained-capacity-fixture.cjs").extend(first.fixture,{active:65,activeReceipts:2,dormantReceipts:0});
 assert.equal(first.fixture.summary.retainedHistory.total,130);assert(!second.fixture.summary.retainedHistory);
 assert.deepEqual(fs.readFileSync(file),bytes);assert.throws(()=>seed.save(file,at,Date.parse(at)),{code:"EEXIST"});
});
test("seed loader rejects wrong dates, changed bytes and non-synthetic players even with a refreshed checksum",t=>{
 const {file}=fixture(t),original=fs.readFileSync(file),envelope=JSON.parse(original);
 assert.throws(()=>seed.read(file,fromStart("2026-11-24T18:00:00.000Z",Date.parse(at))),/calendar mismatch/);
 const key=Object.keys(envelope.fixture.data.profiles)[0];envelope.fixture.data.profiles[key].wallet.coins++;
 fs.writeFileSync(file,JSON.stringify(envelope));assert.throws(()=>seed.read(file,clock()),/checksum mismatch/);
 delete envelope.fixture.data.profiles[key].testFixture;
 envelope.sha256=createHash("sha256").update(JSON.stringify(envelope.fixture)).digest("hex");
 fs.writeFileSync(file,JSON.stringify(envelope));assert.throws(()=>seed.read(file,clock()));
 fs.writeFileSync(file,original);const changed=JSON.parse(original);changed.fixture.tokens[0]=changed.fixture.tokens[1];
 changed.sha256=createHash("sha256").update(JSON.stringify(changed.fixture)).digest("hex");
 fs.writeFileSync(file,JSON.stringify(changed));assert.throws(()=>seed.read(file,clock()));
});
