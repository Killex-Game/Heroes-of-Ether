"use strict";
// Exact offline A/B replay. Includes empty and occupied rooms, split/W/boosters,
// but not networking, persistence, browser FPS or a capacity claim.
const fs=require("node:fs"), path=require("node:path"), Module=require("node:module");
const assert=require("node:assert/strict"), crypto=require("node:crypto");
const [baselineDirectory, output]=process.argv.slice(2);
assert(baselineDirectory&&output,"Usage: BASELINE_ARENA_DIRECTORY OUTPUT");
let serial=0, wall=1800000000000;
crypto.randomUUID=()=>"fixture-"+(++serial); Date.now=()=>wall;
const {RoomFixture}=require("./resident-room-processes/room-fixture.cjs");
const {Arena}=require("../../src/server/arena/arena-simulation");
const {ArenaHazards}=require("../../src/server/arena/arena-hazards");
function old(name){const file=require.resolve("../../src/server/arena/"+name);
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m._compile(fs.readFileSync(path.join(baselineDirectory,name+".js"),"utf8"),file);return m.exports;}
const before=[old("arena-simulation").Arena.prototype.collectEther,old("arena-hazards").ArenaHazards.prototype.collect];
const after=[Arena.prototype.collectEther,ArenaHazards.prototype.collect];
function run(variant,count,seed){
 serial=0;wall=1800000000000;
 [Arena.prototype.collectEther,ArenaHazards.prototype.collect]=variant?after:before;
 const profiles=Array.from({length:count},(_,i)=>({id:"p"+i,name:"Игрок "+i,level:600,skinId:"moon-dragon",appearance:{},
   account:{vipUntil:wall+86400000,premiumUntil:wall+86400000}}));
 const room=new RoomFixture("room-"+seed,profiles,1000,()=>{},"fixture");
 const hash=crypto.createHash("sha256");let ms=0;
 for(let tick=1;tick<=400;tick++){
  wall=1800000000000+tick*50;const at=1000+tick*50;
  if(count===1&&tick<80)room.players[0].effects.lock=5000;
  const start=performance.now();room.tick(at);if(tick>40)ms+=performance.now()-start;
  hash.update(JSON.stringify({snapshot:room.arena.snapshot(at),players:[...room.arena.players.values()],
    progress:room.outbox,hazards:room.arena.hazards.items,food:room.arena.ether,shots:room.arena.combat.shots}));
  room.outbox.length=0;room.inFlight.clear();
 }
 return{variant:variant?"candidate":"baseline",players:count,seed,ms,hash:hash.digest("hex"),boosters:Object.keys(room.metrics.boosters).length};
}
const rows=[];
for(const count of [0,1,30])for(const seed of [1,2,3]){
 const group=[0,1,1,0].map(v=>run(v,count,seed));
 for(const row of group)assert.equal(row.hash,group[0].hash,"Physics/progress diverged");rows.push(...group);
}
const result={scope:"Offline same-seed full room steps; not overall CPU/FPS/capacity",node:process.version,platform:process.platform,
 exact:true,frames:rows.length*400,rows};
fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:"wx"});console.log(JSON.stringify({exact:true,frames:result.frames,output}));
