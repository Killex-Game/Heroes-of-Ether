'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Arena}=require('../../src/server/arena/arena-simulation');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
function previous(p,kind,now){for(const id in p.effects)if(p.effects[id]>now&&BOOSTERS.get(id)?.kind===kind)return true;return false;}
test('effect lookup matches every catalog kind across additions, expiry, deletion and reset',()=>{
 const arena=new Arena({etherCount:0}),p=arena.addPlayer(0,'player'),kinds=[...new Set([...BOOSTERS.values()].map(b=>b.kind)),'unknown',undefined];
 let checked=0;const compare=now=>{for(const kind of kinds){assert.equal(arena.hasEffect(p,kind,now),previous(p,kind,now),String(kind)+' at '+now);checked++;}};
 compare(0);
 for(const [i,id] of [...BOOSTERS.keys(),'unknown_booster'].entries()){p.effects[id]=100+i;compare(99);compare(100+i);compare(101+i);}
 for(const id of [...BOOSTERS.keys()].reverse()){delete p.effects[id];compare(99);compare(1000);}
 p.effects={};compare(0);assert(checked>3000);
});
test('shield types and expiration remain distinct from root, slow, dizzy and speed',()=>{
 const arena=new Arena({etherCount:0}),p=arena.addPlayer(0,'player');
 p.effects={golden_shield:101,clan_shield:103,stone:102,web:100,freeze:104,speed:105};
 assert.equal(arena.hasEffect(p,'root',100),false);assert.equal(arena.hasEffect(p,'dizzy',100),true);
 assert.equal(arena.hasEffect(p,'shield',102),true);assert.equal(arena.hasEffect(p,'shield',103),false);
 p.effects.web=110;assert.equal(arena.hasEffect(p,'root',100),true);delete p.effects.web;assert.equal(arena.hasEffect(p,'root',100),false);
 assert.equal(arena.hasEffect(p,'slow',104),false);assert.equal(arena.hasEffect(p,'speed',104),true);
});
