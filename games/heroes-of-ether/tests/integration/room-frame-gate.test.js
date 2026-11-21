'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {temporary}=require('../temp');
const {RoomOutbox}=require('../../src/server/arena/resident/room-outbox');
const {RoomFrameGate}=require('../../src/server/arena/resident/room-frame-gate');
const {Arena}=require('../../src/server/arena/arena-simulation');
const {recover}=require('../../src/server/profiles/profile-journal');
const {fork}=require('node:child_process'),{once}=require('node:events');
const cast={txId:'cast-one',profileId:'profile-one',lifeId:'life-one',boosterId:'meat'};
async function fixture(t,options={}){
 let cleanup;const dir=temporary({after:f=>cleanup=f},'frame-gate');
 const file=path.join(dir,'room.json'),boxes=[],children=[];
 t.after(async()=>{try{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}
  for(const box of boxes)await box.close();
 }finally{cleanup();}});
 const open=async()=>{const box=await RoomOutbox.open({file,roomId:'room-one',epoch:'epoch-one',...options});boxes.push(box);return box;};
 return {file,open,children};
}
const acknowledgement=entry=>({roomId:entry.frame.roomId,epoch:entry.frame.epoch,sequence:entry.frame.sequence,digest:entry.digest});

test('private arena effect and earned progress become visible only after the same durable frame',async t=>{
 const f=await fixture(t),box=await f.open(),gate=new RoomFrameGate(box);
 const arena=new Arena({etherCount:0,random:()=>.5}),player=arena.addPlayer(0,'player-one');
 let release,entered;const waiting=new Promise(resolve=>entered=resolve),original=fs.fsync;
 const mock=t.mock.method(fs,'fsync',(fd,callback)=>{entered();release=()=>original(fd,callback);});
 const published=[];const initial=player.mass;
 const pending=gate.advance({at:1000},()=>{
  arena.gainMass(player,25,arena.mainBody(player),1000);
  return {progress:[{type:'massPeak',profileId:'profile-one',mass:player.mass}],applied:[cast]};
 },entry=>published.push({entry,mass:player.mass}));
 await waiting;assert.equal(player.mass,initial+25);assert.deepEqual(published,[]);
 await assert.rejects(gate.advance({at:1001},()=>{throw Error('must not run');},()=>{}),/cannot advance/);
 release();const entry=await pending;mock.mock.restore();
 assert.equal(published.length,1);assert.equal(published[0].mass,initial+25);
 assert.deepEqual(recover(f.file).data.roomFrames[1],entry);
 assert.equal(entry.frame.progress[0].mass,initial+25);
});

test('failed private simulation fences its owner without publishing or advancing the journal',async t=>{
 const f=await fixture(t),box=await f.open();let fault,published=0;
 const gate=new RoomFrameGate(box,{onFault:error=>fault=error});
 await assert.rejects(gate.advance({at:1},()=>{throw Error('private physics fault');},()=>published++),/physics fault/);
 assert.equal(fault.message,'private physics fault');assert.equal(published,0);assert.equal(gate.blocked,true);
 assert.equal(recover(f.file).data.sequence,0);
});

test('failed fsync fences the mutated arena and never acknowledges the cast',async t=>{
 const f=await fixture(t),box=await f.open(),gate=new RoomFrameGate(box);let privateMass=0,published=0;
 const mock=t.mock.method(fs,'fsync',(_fd,callback)=>setImmediate(()=>callback(Error('injected disk failure'))));
 await assert.rejects(gate.advance({at:1},()=>({progress:[{type:'massPeak',mass:++privateMass}],applied:[cast]}),()=>published++),/disk failure/);
 mock.mock.restore();assert.equal(privateMass,1);assert.equal(published,0);assert.equal(gate.blocked,true);
 assert.equal(recover(f.file).data.sequence,0);
});

test('a forgotten ACK cannot authorize applying the same transaction again',async t=>{
 const f=await fixture(t),box=await f.open(),gate=new RoomFrameGate(box);let published=0;
 const entry=await gate.advance({at:1},()=>({progress:[],applied:[cast]}),()=>published++);
 box.acknowledge(acknowledgement(entry));assert.equal(box.list().length,0);
 await assert.rejects(gate.advance({at:2},()=>({progress:[],applied:[cast]}),()=>published++),/already applied/);
 assert.equal(published,1);assert.equal(gate.blocked,true);assert.equal(recover(f.file).data.sequence,1);
});

test('capacity backpressure happens before simulation; boundary/end frames retain the contiguous prefix',async t=>{
 const f=await fixture(t,{maxFrames:1}),box=await f.open(),gate=new RoomFrameGate(box);let ticks=0;
 const simulate=()=>{ticks++;return {progress:[],applied:[]};};
 const first=await gate.advance({at:1},simulate,()=>{});
 await assert.rejects(gate.advance({at:2},simulate,()=>{}),/cannot advance/);assert.equal(ticks,1);assert.equal(gate.fault,null);
 box.acknowledge(acknowledgement(first));
 const boundary=await gate.advance({at:2,kind:'boundary'},simulate,()=>{});
 box.acknowledge(acknowledgement(boundary));
 const end=await gate.advance({at:3,kind:'end'},simulate,()=>{});
 assert.equal(end.frame.sequence,3);assert.equal(gate.blocked,true);
 await assert.rejects(gate.advance({at:4},simulate,()=>{}),/cannot advance/);assert.equal(ticks,3);
});

test('publication failure remains recoverable and a recovered epoch cannot resume an uncheckpointed arena',async t=>{
 const f=await fixture(t),box=await f.open(),gate=new RoomFrameGate(box);
 await assert.rejects(gate.advance({at:1},()=>({progress:[],applied:[cast]}),()=>{throw Error('network closed');}),/network closed/);
 await box.close();const recovered=await f.open();assert.equal(recovered.list()[0].frame.applied[0].txId,cast.txId);
 assert.throws(()=>new RoomFrameGate(recovered),/fresh/);
});

for(const point of ['private','durable'])test('process crash at '+point+' preserves a provable cast outcome',async t=>{
 const f=await fixture(t);
 const child=fork(path.join(__dirname,'../fixtures/room-frame-gate-crash.cjs'),[f.file,point],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
 f.children.push(child);const [code,signal]=await once(child,'exit');
 assert.ok(code!==0||signal);assert.equal(fs.readFileSync(f.file+'.private','utf8'),'25');
 assert.equal(fs.existsSync(f.file+'.published'),false);
 const box=await f.open();
 if(point==='private'){assert.equal(box.sequence,0);assert.deepEqual(box.list(),[]);}
 else{assert.equal(box.sequence,1);assert.equal(box.list()[0].frame.applied[0].txId,cast.txId);
  assert.equal(box.list()[0].frame.progress[0].mass,25);}
});
