"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fork}=require('node:child_process'),{randomUUID,randomBytes}=require('node:crypto');
const {ProfileStore}=require('../../../src/server/profiles/profile-store');
const {recover}=require('../../../src/server/profiles/profile-journal');
const {freshProgress}=require('../../../src/server/progression/experience-progression');
const {RoomProgressSink}=require('./progress-sink.cjs');
const {DurableCasts}=require('./durable-casts.cjs');
const {BOOSTERS}=require('../../../src/server/boosters/booster-catalog');
const durableCasts=process.env.ROOM_BENCH_DURABLE_CASTS==='1';
const {summary}=require('./room-fixture.cjs');
const count=Number(process.argv[2]||3),workers=Number(process.argv[3]||3),seconds=Number(process.argv[4]||30);
const roomSize=Number(process.env.ROOM_BENCH_ROOM_SIZE||30);
if(![30,35].includes(roomSize))throw Error('Room size must be 30 (current) or 35 (historical replay)');
const stallMs=Number(process.env.ROOM_BENCH_STALL_MS||0);
if(!Number.isInteger(stallMs)||stallMs<0||stallMs>2000||stallMs&&(process.platform!=='linux'||workers<2))
  throw Error('Stall probe requires two Linux room processes and at most two seconds');
const peerCount=Math.max(1,Math.min(count,Number(process.env.ROOM_BENCH_PEERS)||1));
if(process.env.ROOM_BENCH_INPUTS && process.env.ROOM_BENCH_INPUTS!=='socket')throw Error('Invalid inputs');
if(process.env.ROOM_BENCH_SCENARIO && process.env.ROOM_BENCH_SCENARIO!=='balanced-split')throw Error('Invalid scenario');
if(process.env.ROOM_BENCH_INPUTS==='socket'&&!durableCasts)throw Error('Socket inputs require durable casts');
if(![1,2,3,10,20].includes(count)||!Number.isInteger(workers)||workers<1||workers>count||seconds<10||seconds>3600)throw Error('Invalid load');
const output=path.resolve(process.argv[5]||path.join(__dirname,'../../../../../artifacts/room-processes-20261110/resident-'+count+'-'+workers));
const children=[];let store,services,aborted=false;
function spawn(file){const execArgv=file==='child.cjs'&&process.env.ROOM_BENCH_PROFILE_ROOMS==='1'?
  ['--cpu-prof','--cpu-prof-dir='+output]:[];
  const peerCpus=file==='peers.cjs'&&process.env.ROOM_BENCH_PEER_CPUS;
  if(peerCpus&&(process.platform!=='linux'||!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(peerCpus)))
    throw Error('Peer CPU affinity requires a Linux CPU list');
  const child=fork(path.join(__dirname,file),[],{execArgv:peerCpus?['-c',peerCpus,process.execPath]:execArgv,
    ...(peerCpus?{execPath:'/usr/bin/taskset'}:{}),stdio:['ignore','ignore','pipe','ipc'],serialization:'advanced'});
  children.push(child);child.stderr.on('data',b=>process.stderr.write(b));return child;}
function wait(child,type,timeout=60000){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('Child timeout: '+type));},timeout);
  function cleanup(){clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);}
  function onMessage(m){if(m.type===type){cleanup();resolve(m);}}
  function onExit(code){cleanup();reject(Error('Child exited before '+type+': '+code));}
  child.on('message',onMessage);child.once('exit',onExit);
});}
async function run(){
  if(os.freemem()<1800*1048576)throw Error('Need at least 1800 MiB free before isolated run');
  fs.mkdirSync(output,{recursive:true});
  const full=process.env.ROOM_BENCH_FULL_WORLD==='1';
  const fixture=full?(process.env.ROOM_BENCH_FIXTURE
    ? JSON.parse(fs.readFileSync(process.env.ROOM_BENCH_FIXTURE))
    : require('../database-room-fixture.cjs').createFixture()):null;
  if(fixture&&!Object.values(fixture.data.profiles).every(p=>p.testFixture==='database-capacity-20261110'))throw Error('Synthetic fixture marker required');
  const lobbyCount=full?30:0;
  const filePath=path.join(output,'data/profiles.json');
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  if(fs.existsSync(filePath))throw Error('Use a new output directory');
  const world=fixture?.data||{version:13,profiles:{},clans:{}};
  const fixtureProfiles=Object.values(world.profiles);
  const tokens=new Map(),boosters=[...BOOSTERS.values()].filter(b=>b.ready).map(b=>b.id);
  for(let i=0;i<count*roomSize;i++){
    const fresh=fixture?null:new ProfileStore(),auth=fixture?{token:fixture.tokens[i]}:fresh.open(),p=fixture?fixtureProfiles[i]:fresh.find(auth.token);
    p.level=600;p.progress=freshProgress(600);p.name='Load '+i;p.skinId='moon-dragon';
    p.personal.nameSet=true;p.personal.introPending=false;
    tokens.set(p.id,auth.token);
    if(durableCasts){
      p.account=require('../../../src/server/accounts/account-benefits').fresh();
      p.account.vipUntil=p.account.premiumUntil=Date.now()+86400000;
      p.quickSlots=Array.from({length:6},(_,j)=>boosters[(i*6+j)%boosters.length]);
      const stock=Math.max(200,Math.ceil(seconds/6)+100);
      for(const id of p.quickSlots)p.inventory[id]=stock;
      if(p.quickSlots.includes('easter_egg'))p.easter={runs:{},chests:[],trophies:[],
        batches:[{count:stock,expiresAt:require('../../../src/server/events/easter-hunt').expiresAt(Date.now())}]};
    }
    if(fresh)Object.assign(world.profiles,fresh.data.profiles);
  }
  const lobbyTokens=fixture?.tokens.slice(count*roomSize,count*roomSize+lobbyCount)||[];
  for(const p of fixtureProfiles.slice(count*roomSize,count*roomSize+lobbyCount)){
    p.wallet.coins=1000000;p.inventory.candy=100;
    p.account=require('../../../src/server/accounts/account-benefits').fresh();
    p.account.vipUntil=p.account.premiumUntil=Date.now()+86400000;
  }
  store=new ProfileStore({filePath,journal:true,incrementalSettlement:true});
  const eventKind=process.env.ROOM_BENCH_EVENT;
  if(eventKind){
    if(!['black-friday','easter-hunt'].includes(eventKind))throw Error('Invalid fixture event');
    // Isolated EventManager only; never sends an administrative command to play.
    const eventAt=Math.floor(Date.now()/60000)*60000;
    const manager=new (require('../../../src/server/events/event-manager').EventManager)({now:()=>eventAt});
    manager.apply('fixture','start',{requestId:randomUUID(),revision:manager.data.revision,
      eventId:require('../../../src/server/events/'+eventKind).manifest.id});
    manager.now=()=>Date.now();store.events=manager;
  }
  store.save(world);
  if(process.env.ROOM_BENCH_INDEPENDENT_PROGRESS)
    store.arenaPreparer=new (require('./independent-progress.cjs').IndependentProgress)(Number(process.env.ROOM_BENCH_INDEPENDENT_PROGRESS),{
      maxBatchSize:Number(process.env.ROOM_BENCH_CALCULATION_BATCH||32)});
  if(process.env.ROOM_BENCH_PROGRESS_WORKERS)
    store.arenaPreparer=new (require('../../../src/server/profiles/arena-progress-preparer').ArenaProgressPreparer)({
      parallelism:Number(process.env.ROOM_BENCH_PROGRESS_WORKERS),computeBudgetMs:50});
  const journalStats={bytes:0,peakPendingBytes:0,encodes:[],checkpoints:[],sampledFields:{}};
  const encode=store.journal.encode.bind(store.journal),checkpoint=store.journal.requestCheckpoint.bind(store.journal);
  store.journal.encode=next=>{const started=performance.now(),buffer=encode(next);
    journalStats.encodes.push(performance.now()-started);journalStats.bytes+=buffer.length;
    if(process.env.ROOM_BENCH_JOURNAL_DETAIL==='1' && journalStats.encodes.length%32===0){
      const change=JSON.parse(buffer.subarray(65).toString()).change;
      const add=(k,v)=>journalStats.sampledFields[k]=(journalStats.sampledFields[k]||0)+Buffer.byteLength(JSON.stringify(v));
      const fields=(patch,prefix)=>{for(const [k,v] of Object.entries(patch.set||{}))add(prefix+k,v);
        for(const [k,v] of Object.entries(patch.nested||{}))fields(v,prefix+k+'.');};
      fields(change,'world.');
      for(const [k,table] of Object.entries(change.tables)){
        if(k==='profileEdits')for(const patch of Object.values(table))fields(patch,'profile.');
        else add(k,table);
      }
    }
    journalStats.peakPendingBytes=Math.max(journalStats.peakPendingBytes,store.journal.pendingBytes+buffer.length);return buffer;};
  store.journal.requestCheckpoint=async()=>{const started=performance.now(),already=store.journal.running;
    await checkpoint();if(!already)journalStats.checkpoints.push(performance.now()-started);};
  const sink=new RoomProgressSink(store,{maxBatchSize:Number(process.env.ROOM_BENCH_WRITER_BATCH||64)}),all=Object.values(store.data.profiles),key=randomBytes(24).toString('hex');
  const casts=durableCasts?new DurableCasts(store,sink,tokens):null;
  services=await require('./services.cjs').startServices(store,output,lobbyTokens,casts?.queue);
  const configs=Array.from({length:count},(_,i)=>({id:'room-'+i,epoch:randomUUID(),profiles:all.slice(i*roomSize,i*roomSize+roomSize)}));
  const loading={addressed:process.env.ROOM_BENCH_ADDRESSED_PROFILES==='1',rooms:[],projection:process.env.ROOM_BENCH_COMPACT_PROFILES==='1'};
  if(loading.addressed){
    const locators=new Map(Object.entries(store.data.profiles).map(([key,p])=>[p.id,{key,id:p.id}]));
    const assert=require('node:assert/strict');
    for(const c of configs){
      const at=performance.now(),selected=await services.readProfiles(c.profiles.map(p=>locators.get(p.id)));
      assert.equal(selected.revision,store.journal.revision,'Room startup requires a current persisted generation');
      const profiles=c.profiles.map(p=>selected.profiles.get(p.id));assert.deepEqual(profiles,c.profiles);
      c.profiles=profiles;loading.rooms.push({id:c.id,profiles:profiles.length,generation:selected.generation,
        elapsedMs:performance.now()-at,documents:selected.documents,logicalBytes:selected.logicalBytes});
    }
  }
  loading.fullBytes=configs.reduce((n,c)=>n+Buffer.byteLength(JSON.stringify(c.profiles)),0);
  if(loading.projection)for(const c of configs)c.profiles=c.profiles.map(require('./room-profile.cjs').roomProfile);
  loading.transferredBytes=configs.reduce((n,c)=>n+Buffer.byteLength(JSON.stringify(c.profiles)),0);
  for(const c of configs)sink.claim(c.id,c.epoch,c.profiles.map(p=>p.id));
  let ipcBytes=0,acks=0,errors=0;const delays=[];
  const shards=[];
  for(let i=0;i<workers;i++){
    const child=spawn('child.cjs'),subset=configs.filter((_,n)=>n%workers===i);
    for(const config of subset){sink.bind(config.id,config.epoch,child);casts?.claim(child,config);}
    child.on('message',m=>{if(m.type!=='progress'){casts?.receive(child,m);return;}
      const at=performance.now();ipcBytes+=Buffer.byteLength(JSON.stringify(m));
      sink.commitFrom(child,m.batch).then(ack=>{acks++;delays.push(performance.now()-at);if(child.connected)child.send({type:'ack',...ack});},error=>{if(errors++<3)console.error(error.stack);});
    });
    const ready=wait(child,'ready');child.send({type:'init',rooms:subset,key,durableCasts});
    shards.push({child,subset,...await ready});
  }
  const urls=shards.flatMap(s=>s.subset.flatMap(c=>Array.from({length:roomSize},(_,i)=>
    `ws://127.0.0.1:${s.port}/?room=${c.id}&player=${i}&key=${key}`)));
  const peerProcesses=[];
  for(let i=0;i<peerCount;i++){
    const peer=spawn('peers.cjs'),ready=wait(peer,'ready');
    peer.send({type:'connect',urls:urls.filter((_,j)=>j%peerCount===i)});await ready;peerProcesses.push(peer);
  }
  const start=performance.now(),cpu=process.cpuUsage();let peakRss=process.memoryUsage().rss,minFree=os.freemem();
  let windowAt=start,windowAck=0,windowCast=0;
  const monitor=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);minFree=Math.min(minFree,os.freemem());
    if(seconds>=3600&&performance.now()-windowAt>=60000){
      const castSamples=casts?.metrics.latency||[];
      console.log(JSON.stringify({windowSeconds:Math.round((performance.now()-start)/1000),
        writerDelay:summary(delays.slice(windowAck)),castLatency:summary(castSamples.slice(windowCast)),
        progressPending:sink.pending.size,castsPending:casts?.queue.waiting.length||0,
        writerRssMiB:Math.round(process.memoryUsage().rss/1048576),freeMiB:Math.round(os.freemem()/1048576),errors}));
      windowAt=performance.now();windowAck=delays.length;windowCast=castSamples.length;
    }
    if(minFree<850*1048576)aborted=true;},1000);
  for(const s of shards)s.child.send({type:'start'});
  if(process.env.ROOM_BENCH_INPUTS==='socket')for(const peer of peerProcesses)peer.send({type:'startInputs'});
  await services.start();
  console.log(JSON.stringify({started:true,rooms:count,players:count*roomSize,processes:workers,seconds,output}));
  let isolation;
  while(!aborted&&performance.now()-start<seconds*1000){
    await new Promise(r=>setTimeout(r,250));
    if(stallMs&&!isolation&&performance.now()-start>3000){
      const probe=async child=>{const reply=wait(child,'probe');child.send({type:'probe'});return (await reply).rooms;};
      const other=shards[1].child,before=await probe(other),at=performance.now();
      try{shards[0].child.kill('SIGSTOP');await new Promise(r=>setTimeout(r,stallMs));
        const after=await probe(other);isolation={stalledPid:shards[0].child.pid,healthyPid:other.pid,
          elapsedMs:performance.now()-at,before,after};
        if(after.some((room,i)=>room.ticks<=before[i].ticks))throw Error('Healthy room failed to advance during isolated stall');
      }finally{shards[0].child.kill('SIGCONT');}
    }
  }
  if(process.env.ROOM_BENCH_INPUTS==='socket')await Promise.all(peerProcesses.map(async peer=>{
    const done=wait(peer,'inputsStopped');peer.send({type:'stopInputs'});await done;
  }));
  const reports=await Promise.all(shards.map(async s=>{const done=wait(s.child,'report');s.child.send({type:'stop'});return(await done).report;}));
  const peerReports=await Promise.all(peerProcesses.map(async peer=>{
    const done=wait(peer,'report');peer.send({type:'stop'});return(await done).report;
  }));
  clearInterval(monitor);const used=process.cpuUsage(cpu);
  const progressWorker=store.arenaPreparer?.stats;
  const serviceResults=await services.close();store=null;
  serviceResults.testDatabaseRemoved=await services.removeSyntheticDatabase();services=null;
  const saved=recover(filePath).data;
  const cursors=Object.values(saved.roomProgress);const rooms=reports.flatMap(r=>r.rooms);
  const report={scope:'isolated resident simulation + direct WebSocket state + local durable progress'+
      (durableCasts?' + real inventory/WAL casts':' (casts bypass inventory)')+
      (full?' + 1280 synthetic profiles/128 clans/30 real HTTP lobby clients':'')+
      (serviceResults.database?' + PostgreSQL verified':'')+'; no production arena admission in this run',
    rooms:count,roomSize,players:count*roomSize,processes:workers,seconds,aborted,shards:reports,peers:peerReports,loading,isolation,
    protocol:process.env.ROOM_BENCH_PROTOCOL||require('../../../public/shared/arena-wire').PROTOCOL,
    scenario:{inputs:process.env.ROOM_BENCH_INPUTS||'in-process tick-based',layout:process.env.ROOM_BENCH_SCENARIO||'mixed-mass',event:eventKind||null,mixedSocial:process.env.LOAD_MIXED_SOCIAL==='1',respawnDelayMs:Number(process.env.ROOM_BENCH_RESPAWN_DELAY_MS)||0,meanAlive:rooms.reduce((sum,r)=>sum+r.meanAlive,0)},
    viewMode:process.env.ROOM_BENCH_VIEWS==='camera'?'synthetic moving mass-dependent cameras':
      process.env.ROOM_BENCH_INPUTS==='socket'?'socket-reported cameras':'whole room',peerProcesses:peerCount,
    peerCpuAffinity:process.env.ROOM_BENCH_PEER_CPUS||null,
    writer:{cpuMs:(used.user+used.system)/1000,peakRss,ipcBytes,acks,errors,delayMs:summary(delays),queueWaitMs:summary(sink.queueWaitMs),...sink.metrics},
    journal:{...journalStats,encodes:summary(journalStats.encodes),checkpoints:summary(journalStats.checkpoints)},
    progressWorker,
    ...serviceResults,
    casts:casts&&{...casts.metrics,latency:summary(casts.metrics.latency),waiting:casts.queue.waiting.length,restages:casts.queue.restages},
    minFreeMiB:Math.round(minFree/1048576),durableSequences:cursors.reduce((s,c)=>s+c.sequence,0),
    pending:rooms.reduce((s,r)=>s+r.outbox,0),pendingCommandReplies:casts?.commandReplies.size||0,allBoosters:[...new Set(rooms.flatMap(r=>Object.keys(r.boosters)))].sort()};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({done:true,aborted,pending:report.pending,errors,boosters:report.allBoosters.length,
    minHz:Math.min(...reports.flatMap(r=>(r.measuredRooms||r.rooms).map(room=>room.ticks/(r.elapsed/1000)))),
    pauses:rooms.reduce((s,r)=>s+r.pauses,0),writerP95:report.writer.delayMs.p95,minFreeMiB:report.minFreeMiB}));
  if(aborted||report.pending||errors)process.exitCode=1;
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  for(const child of children)if(child.connected){if(stallMs)child.kill('SIGCONT');child.kill();}
  if(services)await services.close();
  else if(store)await store.close();
});
