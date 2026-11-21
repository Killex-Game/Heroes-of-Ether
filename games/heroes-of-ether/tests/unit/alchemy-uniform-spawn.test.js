"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {AlchemyField}=require("../../src/server/arena/alchemy-field"),rules=require("../../public/shared/alchemy-rules");
test("every ingredient occupies exactly one tenth of the spawning draw",()=>{
  const counts=Object.fromEntries(rules.ingredients.map(i=>[i.id,0]));
  let pick=0,phase=0;
  const field=new AlchemyField({world:{width:3000,height:3000},random:()=>phase++%3===0?pick:.5});
  for(let n=0;n<10000;n++){pick=(n+.5)/10000;field.items=[];field.spawn();counts[field.items[0].alchemyIngredient]++;}
  for(const count of Object.values(counts))assert.equal(count,1000);
  assert.equal(rules.ingredients.reduce((n,i)=>n+i.weight,0),100);
});
test("shared spawn cap and refill rate apply equally, inactive events spawn nothing",()=>{
  let n=0;const field=new AlchemyField({world:{width:3000,height:3000},random:()=>((n++%30)+.5)/30});
  field.tick(0);assert.equal(field.items.length,0);
  field.setRun({id:"alchemy"},0);assert.equal(field.items.length,24);
  field.tick(0);assert.equal(field.items.length,24);
  field.items=field.items.slice(0,18);field.tick(999);assert.equal(field.items.length,18);
  field.tick(1000);assert.equal(field.items.length,20);field.tick(1999);assert.equal(field.items.length,20);
  field.setRun(null,2000);field.tick(3000);assert.equal(field.items.length,0);
});

