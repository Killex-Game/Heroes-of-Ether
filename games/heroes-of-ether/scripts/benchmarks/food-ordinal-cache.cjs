"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const file=require.resolve('../../src/server/arena/worker-food-transfer');
function candidateSource(source){
  const replacements=[
    ['this.packed = packed;','this.packed = packed; this.duplicateIds = false;'],
    ['const next = [], index = new Map(), entries = [];','const next = [], entries = [];\n    let orderChanged = rows.length !== this.rows.length;'],
    ['const row = rows[i], ordinal = this.index.get(row.id), prior = this.rows[ordinal];',
     'const row = rows[i];\n      const ordinal = !this.duplicateIds && this.rows[i]?.id === row.id ? i : this.index.get(row.id);\n      const prior = this.rows[ordinal];\n      if (ordinal !== i) orderChanged = true;'],
    ['next.push(cached); index.set(row.id, i);','next.push(cached);'],
    ['this.rows = next; this.index = index;',
     'this.rows = next;\n    if (orderChanged) {\n      const index = new Map();\n      for (let i = 0; i < next.length; i++) index.set(next[i].id, i);\n      this.index = index; this.duplicateIds = index.size !== next.length;\n    }'],
  ];
  source=source.replace(/\r\n/g,'\n');
  for(const [from,to] of replacements){assert.equal(source.split(from).length,2,from);source=source.replace(from,to);}
  return source;
}
function load(source){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source,file);return m.exports;}
if(require.main===module){
const source=fs.readFileSync(process.env.BASELINE_FOOD_TRANSFER||file,'utf8');
const before=load(source),after=load(candidateSource(source)),results=[];
const churnEvery=Number(process.env.FOOD_CHURN_EVERY||7);
assert.ok(Number.isInteger(churnEvery)&&churnEvery>0);
for(const moving of [false,true])for(const count of [400,6000])for(const churn of [false,true]){
  const birth=Object.freeze({x:1,y:2,at:0});
  const initial=Array.from({length:count},(_,i)=>({id:'f'+i,x:i*0.11,y:i*0.97,value:5,radius:4,color:'gold',artValue:5,ejected:true,birth}));
  if(!moving)initial.forEach(Object.freeze);
  function frames(verify,variant){
    const Encoder=(variant?after:before).FoodTransferEncoder,encoder=new Encoder({packed:true}),decoder=new before.FoodTransferDecoder();
    let total=0,hits=0,food=initial;
    for(let tick=0;tick<(verify?35:700);tick++){
      if(moving)food=food.map(r=>({...r,x:r.x+0.125,y:r.y+0.25}));
      if(churn&&tick%churnEvery===0){food=food.slice(1);food.push({...initial[0],id:'n'+tick,x:tick,y:tick});}
      const start=performance.now(),packet=encoder.encode(food);total+=performance.now()-start;
      hits+=packet?.refs.length||0;
      if(verify)assert.deepEqual(decoder.decode(structuredClone(packet)),food);
    }
    return {milliseconds:total,hits};
  }
  frames(true,0);frames(true,1);
  for(const variant of [0,1,1,0])results.push({moving,count,churn,variant,...frames(false,variant)});
}
for(const packed of [false,true]){
 const old=new before.FoodTransferEncoder({packed}),next=new after.FoodTransferEncoder({packed});
 const a={id:'a',x:1,y:2},b={id:'a',x:5,y:6},c={id:'c',x:10,y:10};
 for(const rows of [[a,b,c],[a,b,c],[b,a,c],[c],[c],[],[a,c],[c,a],[a,c]])assert.deepEqual(next.encode(rows),old.encode(rows));
}
console.log(JSON.stringify({exact:true,churnEvery,results}));
}
module.exports={candidateSource};
