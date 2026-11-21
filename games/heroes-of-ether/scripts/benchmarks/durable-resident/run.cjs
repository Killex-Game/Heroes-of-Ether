'use strict';
// Disposable local-WAL benchmark. Never loads live profiles/configuration or
// connects to Atlas. The authenticated production server is not modified.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fork}=require('node:child_process'),{once}=require('node:events'),{randomUUID,randomBytes}=require('node:crypto');
const {ProfileStore}=require('../../../src/server/profiles/profile-store');
const {recover}=require('../../../src/server/profiles/profile-journal');
const {RoomProfileLedger}=require('../../../src/server/arena/resident/room-profile-ledger');
const {RoomOutbox}=require('../../../src/server/arena/resident/room-outbox');
const {roomProfile}=require('../resident-room-processes/room-profile.cjs');
const {BOOSTERS}=require('../../../src/server/boosters/booster-catalog');
const records=require('../../../src/server/arena/resident/room-cast-records');
const resources=require('../resource-sample.cjs');
const count=Number(process.argv[2] || 1),workers=Number(process.argv[3] || 1),seconds=Number(process.argv[4] || 15);
const output=path.resolve(process.argv[5] || path.join(os.tmpdir(),'durable-resident-'+randomUUID()));
const ipcSerialization=process.env.ROOM_BENCH_IPC || 'advanced';
if(!['advanced','json'].includes(ipcSerialization))throw Error('Invalid isolated IPC mode');
const frameWire=process.env.ROOM_BENCH_FRAME_WIRE || 'object';
if(!['object','json'].includes(frameWire))throw Error('Invalid isolated frame wire');
const ledgerBuildMs=Number(process.env.ROOM_BENCH_LEDGER_BUILD_MS || 8);
if(!Number.isFinite(ledgerBuildMs) || ledgerBuildMs<1 || ledgerBuildMs>32)throw Error('Invalid isolated ledger build budget');
const soak=process.env.ROOM_BENCH_SOAK==='1'&&count===1&&workers===1;
if(![1,3,10,20].includes(count) || !Number.isInteger(workers) || workers<1 || workers>count || seconds<10 || seconds>(soak?3600:300))
 throw Error('Invalid isolated benchmark size');
if(fs.existsSync(output))throw Error('A new isolated output directory is required');
if(os.freemem()<1800*1048576)throw Error('Insufficient headroom for isolated benchmark');
process.env.ROOM_BENCH_INPUTS='socket';
const children=[],failures=[],tokens=new Map(),configs=[],receipts=new Map();let store,ledger;
function spawn(file){const c=fork(path.resolve(__dirname,file),[],{
 execArgv:process.env.ROOM_BENCH_CPU_PROFILE==='1'?['--cpu-prof','--cpu-prof-dir='+output]:[],
 serialization:ipcSerialization,stdio:['ignore','ignore','pipe','ipc']});
 children.push(c);c.stderr.on('data',b=>process.stderr.write(b));return c;}
function wait(child,type,timeout=60000){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{cleanup();reject(Error('Child timeout '+type));},timeout);
 const cleanup=()=>{clearTimeout(timer);child.off('message',message);child.off('exit',exit);};
 const message=m=>{if(m.type==='fault'){cleanup();reject(Error(m.message));}else if(m.type===type){cleanup();resolve(m);}};
 const exit=(code,signal)=>{cleanup();reject(Error(`Child exited before ${type}: ${code}/${signal}`));};
 child.on('message',message);child.on('exit',exit);
});}
async function run(){
 const fingerprint=require('./source-fingerprint.cjs'),source=fingerprint(path.resolve(__dirname,'../../..'));
 fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(output,'rooms'));
 const filePath=path.join(output,'profiles.json');
 store=new ProfileStore({filePath,journal:true,incrementalSettlement:true,residentRoomExperiment:true});
 const boosters=[...BOOSTERS.values()].filter(b=>b.ready).map(b=>b.id),initial={};
 for(let r=0;r<count;r++) {
  const profiles=[];
  for(let i=0;i<35;i++) {
   const auth=store.open(),p=store.find(auth.token);tokens.set(p.id,auth.token);
   store.transact(auth.token,randomUUID(),'isolated-load-fixture',p=>{
    p.name='Load '+(r*35+i);p.level=600;p.progress=require('../../../src/server/progression/experience-progression').freshProgress(600);
    p.personal.nameSet=true;p.personal.introPending=false;
    p.account=require('../../../src/server/accounts/account-benefits').fresh();p.account.vipUntil=p.account.premiumUntil=Date.now()+86400000;
    p.quickSlots=Array.from({length:6},(_,n)=>boosters[(i*6+n)%boosters.length]);
    for(const id of p.quickSlots)p.inventory[id]=200;
    if(p.quickSlots.includes('easter_egg'))p.easter={runs:{},chests:[],trophies:[],batches:[{count:200,expiresAt:require('../../../src/server/events/easter-hunt').expiresAt(Date.now())}]};
   });
   profiles.push(roomProfile(store.find(auth.token)));initial[p.id]=structuredClone(store.find(auth.token).inventory);
  }
  configs.push({id:'room-'+r,epoch:randomUUID(),profiles});
 }
 fs.writeFileSync(path.join(output,'initial-inventory.json'),JSON.stringify(initial));
 ledger=new RoomProfileLedger(store,{maxBuildMs:ledgerBuildMs});const shards=[],key=randomBytes(24).toString('hex');
 for(let i=0;i<workers;i++) {
  const child=spawn('child.cjs'),subset=configs.filter((_,n)=>n%workers===i);
  await once(child,'spawn');for(const c of subset)await ledger.claim({roomId:c.id,epoch:c.epoch,profileIds:c.profiles.map(p=>p.id)},child);
  child.on('message',m=>{
   if(m.type==='fault'){failures.push(m.message);return;}
   if(m.type==='reserve') {
    ledger.reserve(child,tokens.get(m.profileId),m.input).then(tx=>{
     receipts.set(tx.txId,tx);if(child.connected)child.send({type:'reservation',roomId:m.roomId,epoch:m.epoch,requestId:m.requestId,tx});
    },error=>{if(child.connected)child.send({type:'reservation',roomId:m.roomId,epoch:m.epoch,requestId:m.requestId,error:error.message});});
   }else if(m.type==='serializedFrame')ledger.acceptSerialized(child,m.entry).then(({ack,profileIds})=>{
    if(child.connected)child.send({type:'ack',...ack,profiles:profileIds.map(id=>roomProfile(store.byId(id)))});
   },error=>{failures.push(error.stack);});
   else if(m.type==='frame')ledger.accept(child,m.entry).then(ack=>{
    if(child.connected)child.send({type:'ack',...ack,profiles:m.entry.frame.applied.concat(m.entry.frame.cancelled || [])
     .map(c=>roomProfile(store.byId(c.profileId)))});
   },error=>{failures.push(error.stack);});
  });
  const ready=wait(child,'ready');child.send({type:'init',rooms:subset,key,root:path.join(output,'rooms')});
  shards.push({child,subset,...await ready});
 }
 const urls=shards.flatMap(s=>s.subset.flatMap(c=>Array.from({length:35},(_,i)=>`ws://127.0.0.1:${s.port}/?room=${c.id}&player=${i}&key=${key}`)));
 const peers=[],peerCount=Math.min(workers,4);
 for(let i=0;i<peerCount;i++){const peer=spawn('../resident-room-processes/peers.cjs');
  await require('./peer-placement.cjs')(peer);const ready=wait(peer,'ready');
  peer.send({type:'connect',urls:urls.filter((_,n)=>n%peerCount===i)});await ready;peers.push(peer);}
 const wallStart=Date.now(),resourceStart=resources.sample();
 const started=performance.now(),cpu=process.cpuUsage();let lastSample=started;
 for(const s of shards)s.child.send({type:'start'});for(const peer of peers)peer.send({type:'startInputs'});
 console.log(JSON.stringify({started:true,players:count*35,workers,seconds,output}));
 while(performance.now()-started<seconds*1000 && !failures.length) {
  if(os.freemem()<850*1048576)throw Error('Memory headroom guard');await new Promise(r=>setTimeout(r,250));
  if(soak&&performance.now()-lastSample>=60000){
   lastSample=performance.now();
   const shardsSample=await Promise.all(shards.map(async s=>{const ready=wait(s.child,'sample');s.child.send({type:'sample'});return await ready;}));
   console.log(JSON.stringify({sample:true,elapsed:performance.now()-started,ledger:{...ledger.metrics,pending:ledger.pending},memory:process.memoryUsage(),shards:shardsSample}));
  }
 }
 const measurement={wallStart,wallEnd:Date.now(),resources:resources.delta(resourceStart)};
 await Promise.all(peers.map(async peer=>{const done=wait(peer,'inputsStopped');peer.send({type:'stopInputs'});await done;}));
 const reports=await Promise.all(shards.map(async s=>{const done=wait(s.child,'report');s.child.send({type:'stop'});return(await done).report;}));
 const peerReports=await Promise.all(peers.map(async peer=>{const done=wait(peer,'report');peer.send({type:'stop'});return(await done).report;}));
 const used=process.cpuUsage(cpu);
 for(const s of shards){if(s.child.exitCode===null && s.child.signalCode===null)await once(s.child,'exit');
  for(const c of s.subset){await ledger.fenceStopped({roomId:c.id,epoch:c.epoch},s.child);
   const box=await RoomOutbox.openExisting({file:path.join(output,'rooms',c.id+'-'+c.epoch+'.json'),roomId:c.id,epoch:c.epoch});
   try{await ledger.recoverStopped(box,s.child);}finally{await box.close();}
  }
 }
 let applied=0,refunded=0;const spends={};
 for(const tx of receipts.values()){
  const final=records.read(store.byId(tx.profileId),tx.txId);
  if(final.status==='APPLIED'){applied++;(spends[tx.profileId] ||= {})[tx.boosterId]=((spends[tx.profileId] || {})[tx.boosterId] || 0)+1;}
  else if(final.status==='REFUNDED')refunded++;else throw Error('Unresolved reservation');
 }
 for(const [id,before] of Object.entries(initial))for(const [booster,n] of Object.entries(before))
  if(store.byId(id).inventory[booster]!==n-(spends[id]?.[booster] || 0))throw Error('Inventory reconciliation mismatch');
 const afterSource=fingerprint(path.resolve(__dirname,'../../..'));
 if(source.sha256!==afterSource.sha256)throw Error('Runtime source changed during the benchmark');
 const report={scope:'isolated resident physics + real sockets + room WAL before snapshots + profile WAL before booster ACK; no Atlas/lobby/auth/deadline claim',source,
  players:count*35,workers,seconds,measurement,ipcSerialization,frameWire,ledgerBuildMs,sampleWindow:soak?8192:null,generatorsSeparated:!!process.env.ROOM_BENCH_PEER_PLACEMENT,shards:reports,peers:peerReports,ledger:{...ledger.metrics,cpuMs:(used.user+used.system)/1000,cpuScope:'measurement plus input stop and drain',rss:process.memoryUsage().rss},
  integrity:{applied,refunded,pending:ledger.pending,closedRooms:Object.values(store.data.residentRooms).filter(r=>r.status==='CLOSED').length},failures};
 await store.close();store=null;const saved=recover(filePath).data;
 if(Object.values(saved.profiles).some(p=>Object.keys(p.residentCasts || {}).length))throw Error('Persisted unresolved reservation');
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({done:true,minHz:Math.min(...reports.flatMap(s=>s.measuredRooms.map(r=>r.ticks/(s.elapsed/1000)))),...report.integrity,failures:failures.length}));
 if(failures.length)process.exitCode=1;
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 for(const child of children)if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');
 await ledger?.chain;await store?.close();
});
