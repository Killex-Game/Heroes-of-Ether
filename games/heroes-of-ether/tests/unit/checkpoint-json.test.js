"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{createHash}=require("node:crypto");
const {readCheckpoint,writeCheckpoint}=require("../../src/server/profiles/checkpoint-json");
const {checkpoint,recover,atomicSnapshot}=require("../../src/server/profiles/profile-journal");
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"checkpoint-json-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,"profiles.json");}
test("Record reader matches JSON.parse across UTF-8, escape and delimiter boundaries",t=>{
 const file=setup(t),texts=[
  '{"profiles":{"__proto__":{"name":"Лёва 🐲 \\u1234 \\\" } ]","n":-0},"2":[1,null,true,false,1e300],"1":{}},"clans":{},"unknown":{"a":[{},[]]}}',
  '{"profiles":{"a":1,"b":2,"a":3},"profiles":{"c":4},"__proto__":{"polluted":true},"constructor":5}',
  '[1,{"profiles":{"not":"a split table"}},"Ё"]', 'null','false','-12.34e-56','"escape \\n 🐲"',
  '{"profiles":null,"clans":[1,2],"residentRooms":{"2":{},"1":{}},"tail":0}',
 ];
 for(const text of texts)for(const chunkSize of [1,2,3,7,17,256]){
  fs.writeFileSync(file,' \n\r\t'+text+' \t\n');
  assert.deepStrictEqual(readCheckpoint(file,{chunkSize,threshold:0}),JSON.parse(text));
 }
 assert.equal({}.polluted,undefined);
});
test("Malformed or incomplete checkpoint JSON fails closed at every buffer size",t=>{
 const file=setup(t),texts=['',' ','{} {}','{"profiles":{"p":1,}}','{"profiles":{','{"a":1,}','{"a" 1}','{a:1}','{"a":01}','{"a":NaN}','{"a":truefalse}','{"a":"\\x00"}','{"a":"abc\\"}','{"a":[1,2}','{"a":\u00a0null}','[1,]','"unterminated','true junk'];
 for(const text of texts)for(const chunkSize of [1,2,7,64]){fs.writeFileSync(file,text);assert.throws(()=>readCheckpoint(file,{chunkSize,threshold:0}),SyntaxError,text);}
});
test("Deterministic differential corpus agrees with native parser for values and damaged input",t=>{
 const file=setup(t);let seed=7391;const next=n=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n);
 const letters=['a','Ж','🐲','"','\\','\n','\t','\u0000','\ud800',']','{',':'];
 const text=()=>Array.from({length:next(90)},()=>letters[next(letters.length)]).join('');
 const value=depth=>depth===0?text():[null,true,false,next(10000)/19,text(),[value(depth-1),next(33)],{[text()]:value(depth-1)}][next(7)];
 for(let i=0;i<120;i++){
  const original=JSON.stringify({profiles:{[text()]:value(2),second:value(2)},clans:{[text()]:value(1)},tail:value(2)});
  const index=next(original.length),mutated=original.slice(0,index)+['','"','\\',',',']','\u0000',' '][next(7)]+original.slice(index+1);
  for(const source of [original,mutated]){
   // A mutation may cut a UTF-16 surrogate pair; compare the actual UTF-8
   // file bytes, as the existing native file reader does.
   let expected,valid=true;try{expected=JSON.parse(Buffer.from(source).toString('utf8'));}catch{valid=false;}
   fs.writeFileSync(file,source);
   for(const chunkSize of [1,2,7,31]){
    if(valid)assert.deepStrictEqual(readCheckpoint(file,{chunkSize,threshold:0}),expected);
    else assert.throws(()=>readCheckpoint(file,{chunkSize,threshold:0}),SyntaxError);
   }
  }
 }
});
test("Streaming write preserves exact native JSON bytes and property order",t=>{
 const file=setup(t),source=JSON.parse('{"version":14,"profiles":{"2":{"text":"🐲\\n\\\"","n":1e-12},"1":{"__proto__":{"n":2}},"a":null},"clans":{},"residentRooms":{"r":[true,false]},"unknown":[null,{"x":-0}],"_journalRevision":1}');
 for(const data of [source,{},null,[],42,"text",{profiles:[1],clans:null}]){
  const fd=fs.openSync(file,'w');try{writeCheckpoint(fd,data);}finally{fs.closeSync(fd);}
  assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(data)+'\n');
  assert.deepStrictEqual(readCheckpoint(file,{chunkSize:5,threshold:0}),JSON.parse(JSON.stringify(data)));
 }
});
test("Large histories and unknown fields survive record parsing and atomic checkpoint",t=>{
 const file=setup(t),world={profiles:{},clans:{c:{xp:42}},future:{archive:'unknown 🐲 '.repeat(100000)},_journalRevision:2};
 for(let n=0;n<40;n++)world.profiles['p'+n]={name:'Персонаж '+n,coins:n,receipts:Object.fromEntries(Array.from({length:1200},(_,i)=>['r'+i,'once-'+i]))};
 atomicSnapshot(file,world,true);
 assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(world)+'\n');
 assert.deepStrictEqual(recover(file).data,world);
});
test("Write and fsync failure keep snapshot plus sealed WAL recoverable, then retry exactly",t=>{
 const file=setup(t),base={profiles:{p:{coins:10,receipts:{old:'done'}}},clans:{},_journalRevision:1};atomicSnapshot(file,base);
 const edit={set:{coins:5},remove:[],nested:{receipts:{set:{next:'once'},remove:[]}}};
 const body=JSON.stringify({revision:2,change:{set:{},remove:[],tables:{profileEdits:{p:edit}}}});
 const wal=createHash('sha256').update(body).digest('hex')+' '+body+'\n',sealed=file+'.wal-2';fs.writeFileSync(sealed,wal);
 const before=fs.readFileSync(file),expected=recover(file).data;
 for(const fault of ['writeFileSync','fsyncSync','renameSync']){
  const original=fs[fault];let count=0;
  const mock=t.mock.method(fs,fault,(...args)=>{if(++count===1){if(fault==='writeFileSync')original(args[0],'{partial');throw Error('injected '+fault);}return original(...args);});
  assert.throws(()=>checkpoint(file),/injected/);mock.mock.restore();
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.readFileSync(sealed,'utf8'),wal);assert.deepEqual(recover(file).data,expected);
 }
 checkpoint(file);assert.equal(fs.existsSync(sealed),false);assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(expected)+'\n');assert.deepEqual(recover(file).data,expected);
});
