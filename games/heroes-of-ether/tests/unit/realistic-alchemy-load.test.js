"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const plan=require('../../scripts/benchmarks/realistic-lobby-plan.cjs');
const {assessCapacity}=require('../../scripts/benchmarks/capacity-assessment.cjs');
const rules=require('../../public/shared/alchemy-rules');

test('realistic alchemy alternates all sixteen brews and matching equipment while retaining clan, pet and chat actions',()=>{
 const client={slot:1,clanId:'clan',offerId:'offer',ownsPet:true,alchemyRunId:'run'};
 const potions=new Set(),labels=new Set();
 for(let cycle=0;cycle<16;cycle++){
  const brew=plan.extra(client,cycle*22+14,{alchemy:true}),equip=plan.extra(client,cycle*22+21,{alchemy:true});
  assert.equal(brew[0],'alchemy-brew');assert.equal(brew[2].runId,'run');
  assert.equal(equip[2].potionId,brew[2].potionId);potions.add(brew[2].potionId);
  for(let step=0;step<22;step++){const action=plan.extra(client,cycle*22+step,{alchemy:true});if(action)labels.add(action[0]);}
 }
 assert.deepEqual([...potions].sort(),rules.potions.map(p=>p.id).sort());
 for(const name of ['clan-deposit','clan-buy','clan-edit','pet-food','chat','news','presence','alchemy-view','alchemy-exchange'])assert(labels.has(name));
 assert(!labels.has('roulette-prepare'));assert(!labels.has('roulette-spin'));
 assert.equal(plan.extra(client,13)[0],'roulette-prepare');assert.equal(plan.extra(client,14)[0],'roulette-spin');
 assert.equal(plan.count(false),21);assert.equal(plan.count(true),22);
});

test('alchemy assessment requires successful potion use separately from thirty ordinary boosters and lobby crafting',()=>{
 const actions=Object.fromEntries([...plan.required(true),'profile','rankings','social-view','loadout','purchase','account-bonus'].map(k=>[k,1]));
 const core=Object.fromEntries(Array.from({length:30},(_,i)=>['booster-'+i,1]));
 const row={phase:'combined',elapsed:60000,connections:30,updatesPerClient:20,tickGaps:{p95:50},clientGapP99Max:60,
  inputs:{accepted:{split:10,feed:10}},actionRequests:100,actionPending:0,actionLatencyP95Max:50,successfulActionLatencyP95Max:50,oldestPendingActionMs:0,
  persistence:{pausedSamples:0,end:{paused:false}},usedByType:{...core,...Object.fromEntries(rules.potions.map(p=>[p.boosterId,1]))},
  lobby:{clients:5,success:100,errors:{},latencyMs:{p95:50},actions}};
 const summary={code:0,mode:'database',databaseVerification:{matched:true},players:30,lobby:5,realistic:true,alchemy:true,mixedMinutes:1,phaseSeconds:60};
 assert.equal(assessCapacity([row],summary).shortRunMeetsTargets,true);
 row.usedByType[rules.potions[0].boosterId]=0;
 assert(assessCapacity([row],summary).problems.includes('missing-potion:'+rules.potions[0].id));
 row.usedByType[rules.potions[0].boosterId]=1;delete row.usedByType['booster-0'];
 assert(assessCapacity([row],summary).phases[0].issues.includes('booster-coverage'));
 row.usedByType['booster-0']=1;delete actions['alchemy-brew'];
 assert(assessCapacity([row],summary).problems.includes('missing-realistic-action:alchemy-brew'));
});
