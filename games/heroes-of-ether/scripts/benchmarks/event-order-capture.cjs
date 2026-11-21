"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict');
const file=require.resolve('../../src/server/events/black-friday-orders');
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_ORDER_BOOK,'utf8'),file);
const books=[old.exports,require(file)], session={id:'life',startedAt:1000,sampledAt:2000,food:10};
const p={id:'self'}, fixtures=[];
for(const tier of books[0].tiers)for(let template=0;template<books[0].templates.length;template++) {
  if(!(tier.targets[template]>0))continue;
  for(const legacy of [false,true]) fixtures.push({slots:Array.from({length:4},(_,i)=>({
    tier:tier.id,complete:i===3,current:{id:tier.id+':'+i+':0',template,progress:0,assignedAt:1000,
      ...(legacy?{}:{catalogVersion:2}),revision:0}})),version:3,history:{retained:[1,2]}});
}
const input=Array.from({length:120},(_,n)=>({
  event:{type:['arenaAction','absorbed','questSample','lifeEnded'][n%4],lifeId:n%7===0?'stale':'life',
    targetProfileId:'opponent-'+n%11,victimProfileId:'opponent-'+n%11,food:n*10,
    durationSeconds:n%6?120:59,reason:n%9===0?'recovered':'exit'},
  at:n%13===0?999:121000+n, amount:n%3?1:0,
}));
function run(variant,saved,step,metric,economy=false) {
  const b=books[variant],d=variant?saved:b.copyForProgress(saved);
  if(economy){const r=b.activity(d,{[metric]:step.amount},step.at,!!variant);return variant?r:r?d:saved;}
  const r=b.progress(p,d,step.event,step.at,1000,session,{[metric]:step.amount},!!variant);
  return variant?r:r?d:saved;
}
let replayed=0;
for(const fixture of fixtures) {
  let before=structuredClone(fixture),after=structuredClone(fixture);
  const metric=books[0].templates[fixture.slots[0].current.template].metric;
  for(const step of input) for(const economy of [false,true]) {
    before=run(0,before,step,metric,economy);after=run(1,after,step,metric,economy);
    assert.deepEqual(after,before);replayed++;
  }
}
const measurements=[];
for(const variant of [0,1,1,0]) {
  let sum=0;const started=performance.now();
  for(let i=0;i<300000;i++) {
    const saved=fixtures[i%fixtures.length],step=input[i%input.length];
    // A room sends many events unrelated to the four currently assigned orders.
    const metric=i%3?'unused':books[0].templates[saved.slots[0].current.template].metric;
    const next=run(variant,saved,step,metric,i%5===0);
    sum+=next.slots[0].current.progress;
  }
  measurements.push({variant:variant?'selective':'eager',ms:performance.now()-started,sum});
}
assert.ok(measurements.every(r=>r.sum===measurements[0].sum));
console.log(JSON.stringify({exact:true,replayed,scope:'4-order capture only; not whole-server capacity',measurements}));
