"use strict";
// An optional immutable starting world for paired load runs. Game timers and
// socket scheduling still run in real time; matching seeds do not imply replay.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {fromStart}=require("./game-clock.cjs");
const MARKER="database-capacity-20261110",MAX_BYTES=64*1024*1024;
const hash=value=>createHash("sha256").update(value).digest("hex");
function validate(fixture){
  const profiles=fixture?.data?.profiles,clans=fixture?.data?.clans,tokens=fixture?.tokens;
  assert(profiles&&clans&&Array.isArray(tokens),"Invalid synthetic seed");
  assert.equal(Object.keys(profiles).length,1280);assert.equal(tokens.length,1280);
  assert.equal(new Set(tokens).size,1280);assert.equal(Object.keys(clans).length,128);
  for(const token of tokens){assert.equal(typeof token,"string");assert.equal(profiles[hash(token)]?.testFixture,MARKER);}
  assert.equal(new Set(Object.values(profiles).map(p=>p.id)).size,1280);
  assert(Object.values(clans).every(c=>c.testSeedKey===MARKER&&c.members.length===10));
  assert(!fixture.summary?.retainedHistory,"Seed must precede history extension and lobby detachment");
}
function save(file,start,realNow=Date.now()){
  const clock=fromStart(start,realNow);assert(start&&clock.gameStartAt===start,"Exact synthetic game start required");
  const fixture=require("./database-room-fixture.cjs").createFixture(Date.parse(start));validate(fixture);
  const sha256=hash(JSON.stringify(fixture)),envelope={version:1,kind:"synthetic-capacity-seed",gameStartAt:start,sha256,fixture};
  fs.writeFileSync(file,JSON.stringify(envelope),{flag:"wx",mode:0o600});return {sha256,gameStartAt:start,bytes:fs.statSync(file).size};
}
function read(file,gameClock){
  assert(fs.statSync(file).size<=MAX_BYTES,"Oversized synthetic seed");
  const envelope=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(envelope.version,1);assert.equal(envelope.kind,"synthetic-capacity-seed");
  assert.equal(envelope.gameStartAt,gameClock.gameStartAt,"Synthetic seed calendar mismatch");
  assert.equal(hash(JSON.stringify(envelope.fixture)),envelope.sha256,"Synthetic seed checksum mismatch");
  validate(envelope.fixture);
  return {fixture:envelope.fixture,proof:{sha256:envelope.sha256,gameStartAt:envelope.gameStartAt,
    scope:"Identical starting profiles, clans and calendar only; live timing and combat remain nondeterministic"}};
}
if(require.main===module){const [file,start]=process.argv.slice(2);assert(file&&start);console.log(JSON.stringify(save(path.resolve(file),start)));}
module.exports={save,read};
