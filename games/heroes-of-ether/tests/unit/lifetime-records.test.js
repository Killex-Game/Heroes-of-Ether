"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");

test("Only the final contact with a human-controlled player marks a record event", () => {
  for (const kind of ["human","bot","remnant"]) {
    const arena = new Arena({etherCount:0});
    const eater = arena.addPlayer(0,"eater"), victim = arena.addPlayer(0,"victim");
    for (const [p,mass] of [[eater,1000],[victim,20]]) {
      Object.assign(p, {x:500,y:500,targetX:500,targetY:500,protectedUntil:0,mass,radius:radiusForMass(mass),profileId:p.id});
    }
    victim.isTestBot = kind === "bot";
    victim.isRemnant = kind === "remnant";
    const [event] = arena.resolveAbsorptions(5000);
    assert.equal(event.victimDefeated,true);
    assert.equal(event.humanDefeat,kind === "human");
  }
});

test("Lifetime records survive restart, ignore replay, bots, old mixed totals and passive awards", t => {
  const filePath = path.join(temporary(t,"records"),"profiles.json");
  const store = new ProfileStore({filePath}), user = store.open(), other = store.open();
  const p = store.find(user.token);
  delete p.progress.humanAbsorptions;
  p.progress.absorptionKills = 400;
  p.progress.bestAbsorptions = 30;
  const at = Date.now();
  const send = (e,i) => store.applyArenaProgress(randomUUID(),[{profileId:p.id,...e}],at+i);
  const hit = (life,n,extra={}) => ({type:"absorbed",victimProfileId:other.profile.id,gain:10,
    eaterLifeId:life,absorptionSequence:n,victimDefeated:true,humanDefeat:true,...extra});
  send({type:"lifeStarted",lifeId:"first"},0);
  send(hit("first",1,{victimDefeated:false}),1);
  send(hit("first",2,{humanDefeat:false}),2);
  send(hit("first",3,{humanDefeat:undefined}),3);
  send(hit("first",4),4);
  send(hit("first",4),5);
  send({type:"massBonus",lifeId:"first",sequence:1,kills:20},6);
  send({type:"massPeak",mass:7400},7);
  send({type:"lifeEnded",lifeId:"first",durationSeconds:60},8);
  send({type:"lifeStarted",lifeId:"second"},9);
  send(hit("first",5),10);
  send(hit("second",1),11);
  const recovered = new ProfileStore({filePath}), service = new ClanService(recovered);
  const read = order => service.state(user.token,"",1,"",order,1,"greatness","rankings");
  const rival = recovered.find(other.token);
  rival.testBot = true;
  Object.assign(rival.progress,{maxMass:100000,humanAbsorptions:1000});
  assert.deepEqual(read("maxMass").playerLeaders.map(r=>r.recordScore),[7400]);
  assert.deepEqual(read("humanAbsorptions").playerLeaders.map(r=>r.recordScore),[2]);
  assert.equal(read("humanAbsorptions").myRank,1);
});
