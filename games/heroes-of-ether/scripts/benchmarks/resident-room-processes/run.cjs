"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fork}=require('node:child_process'),{randomUUID,randomBytes}=require('node:crypto');
const {ProfileStore}=require('../../../src/server/profiles/profile-store');
const {recover}=require('../../../src/server/profiles/profile-journal');
const {freshProgress}=require('../../../src/server/progression/experience-progression');
const {RoomProgressSink}=require('./progress-sink.cjs');
const {DurableCasts}=require('./durable-casts.cjs');
const {BOOSTERS}=require('../../../src/server/boosters/booster-catalog');
const {RoomProjections}=require('./room-projections.cjs');
const {roomProfile}=require('./room-profile.cjs');
const gameClock=require('../game-clock.cjs').fromStart(process.env.CAPACITY_GAME_AT);
process.env.ROOM_BENCH_GAME_OFFSET_MS=String(gameClock.offsetMs);
const gameNow=require('../game-clock.cjs').clock(gameClock.offsetMs),perRoom=30;
const durableCasts=process.env.ROOM_BENCH_DURABLE_CASTS==='1';
const {summary}=require('./room-fixture.cjs');
const count=Number(process.argv[2]||3),workers=Number(process.argv[3]||3),seconds=Number(process.argv[4]||30);
const peerCount=Math.max(1,Math.min(count,Number(process.env.ROOM_BENCH_PEERS)||1));
if(process.env.ROOM_BENCH_INPUTS && process.env.ROOM_BENCH_INPUTS!=='socket')throw Error('Invalid inputs');
if(process.env.ROOM_BENCH_SCENARIO && process.env.ROOM_BENCH_SCENARIO!=='balanced-split')throw Error('Invalid scenario');
if(process.env.ROOM_BENCH_INPUTS==='socket'&&!durableCasts)throw Error('Socket inputs require durable casts');
if(!Number.isInteger(count)||count<1||count>20||!Number.isInteger(workers)||workers<1||workers>count||seconds<10||seconds>3600)throw Error('Invalid load');
const output=path.resolve(process.argv[5]||path.join(__dirname,'../../../../../artifacts/room-processes-20261110/resident-'+count+'-'+workers));
const children=[];let store,services,projectionTimer,aborted=false;
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
  if(os.freemem()<3000*1048576)throw Error('Need at least 3000 MiB free before isolated run');
  fs.mkdirSync(output,{recursive:true});
  const full=process.env.ROOM_BENCH_FULL_WORLD==='1';
  const seed=full&&process.env.CAPACITY_SEED?require('../capacity-seed.cjs').read(process.env.CAPACITY_SEED,gameClock):null;
  const fixture=seed?.fixture||(full?(process.env.ROOM_BENCH_FIXTURE
    ? JSON.parse(fs.readFileSync(process.env.ROOM_BENCH_FIXTURE))
    : require('../database-room-fixture.cjs').createFixture(gameNow())):null);
  if(fixture&&!Object.values(fixture.data.profiles).every(p=>p.testFixture==='database-capacity-20261110'))throw Error('Synthetic fixture marker required');
  const lobbyCount=full?5:0;
  if(full&&process.env.LOAD_REALISTIC==='1')require('../realistic-lobby-plan.cjs').detachLobby(fixture,count*perRoom,lobbyCount,2);
  const filePath=path.join(output,'data/profiles.json');
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  if(fs.existsSync(filePath))throw Error('Use a new output directory');
  const world=fixture?.data||{version:13,profiles:{},clans:{}};
  const fixtureProfiles=Object.values(world.profiles);
  const tokens=new Map(),boosters=[...BOOSTERS.values()].filter(b=>b.ready).map(b=>b.id);
  for(let i=0;i<count*perRoom;i++){
    const fresh=fixture?null:new ProfileStore(),auth=fixture?{token:fixture.tokens[i]}:fresh.open(),p=fixture?fixtureProfiles[i]:fresh.find(auth.token);
    p.level=600;p.progress=freshProgress(600);p.name='Load '+i;p.skinId='moon-dragon';
    p.personal.nameSet=true;p.personal.introPending=false;
    tokens.set(p.id,auth.token);
    if(durableCasts){
      p.account=require('../../../src/server/accounts/account-benefits').fresh();
      p.account.vipUntil=p.account.premiumUntil=gameNow()+86400000;
      p.quickSlots=Array.from({length:6},(_,j)=>boosters[(i*6+j)%boosters.length]);
      const stock=Math.max(200,Math.ceil(seconds/2)+100);
      for(const id of p.quickSlots)p.inventory[id]=stock;
      if(p.quickSlots.includes('easter_egg'))p.easter={runs:{},chests:[],trophies:[],
        batches:[{count:stock,expiresAt:require('../../../src/server/events/easter-hunt').expiresAt(gameNow())}]};
    }
    if(fresh)Object.assign(world.profiles,fresh.data.profiles);
  }
  const lobbyTokens=fixture?.tokens.slice(count*perRoom,count*perRoom+lobbyCount)||[];
  for(const p of fixtureProfiles.slice(count*perRoom,count*perRoom+lobbyCount)){
    p.wallet.coins=p.wallet.crystals=p.wallet.bucks=1000000;p.inventory.candy=100;
    p.level=Math.max(121,p.level);p.progress=freshProgress(p.level);
    p.roulette.tickets+=1000;p.roulette.earned+=1000;
    p.account=require('../../../src/server/accounts/account-benefits').fresh();
    p.account.vipUntil=p.account.premiumUntil=gameNow()+86400000;
  }
  // Load the synthetic starting world through the same recovery/migration path
  // as the whole-server benchmark, before measuring any operations.
  const initial=require('../../../src/server/profiles/transaction-history').syncWorld(world,gameNow(),
    {kind:'synthetic-fixture',label:'Изолированный запас нагрузочного стенда'});
  fs.writeFileSync(filePath,JSON.stringify(initial),{flag:'wx'});
  store=new ProfileStore({filePath,journal:true,incrementalSettlement:true,clanDailyQuests:true,now:gameNow});
  const eventKind=process.env.ROOM_BENCH_EVENT||(process.env.LOAD_REALISTIC==='1'?'lucky-week':null);
  if(eventKind){
    if(!['black-friday','easter-hunt','lucky-week','ether-alchemy'].includes(eventKind))throw Error('Invalid fixture event');
    // Isolated EventManager only; never sends an administrative command to play.
    const eventAt=Math.floor(gameNow()/60000)*60000;
    const manager=new (require('../../../src/server/events/event-manager').EventManager)({now:()=>eventAt});
    manager.apply('fixture','start',{requestId:randomUUID(),revision:manager.data.revision,
      eventId:require('../../../src/server/events/'+eventKind).manifest.id});
    manager.now=gameNow;store.events=manager;
  }
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
  const projections=new RoomProjections(store);
  services=await require('./services.cjs').startServices(store,output,lobbyTokens,casts?.queue);
  const configs=Array.from({length:count},(_,i)=>({id:'room-'+i,epoch:randomUUID(),profiles:all.slice(i*perRoom,i*perRoom+perRoom)}));
  for(const c of configs)sink.claim(c.id,c.epoch,c.profiles.map(p=>p.id));
  let ipcBytes=0,acks=0,errors=0;const delays=[];
  const shards=[];
  for(let i=0;i<workers;i++){
    const child=spawn('child.cjs'),subset=configs.filter((_,n)=>n%workers===i);
    for(const config of subset){sink.bind(config.id,config.epoch,child);casts?.claim(child,config);projections.bind(config,child);}
    child.on('message',m=>{if(m.type!=='progress'){casts?.receive(child,m);return;}
      const at=performance.now();ipcBytes+=Buffer.byteLength(JSON.stringify(m));
      sink.commitFrom(child,m.batch).then(ack=>{acks++;delays.push(performance.now()-at);if(child.connected)child.send({type:'ack',...ack});},error=>{if(errors++<3)console.error(error.stack);});
    });
    const ready=wait(child,'ready');child.send({type:'init',rooms:subset.map(c=>({...c,profiles:c.profiles.map(roomProfile)})),key,durableCasts});
    shards.push({child,subset,...await ready});
  }
  projections.flush();
  projectionTimer=setInterval(()=>{try{projections.flush();}catch(error){console.error(error);aborted=true;clearInterval(projectionTimer);}},50);
  const urls=shards.flatMap(s=>s.subset.flatMap(c=>Array.from({length:perRoom},(_,i)=>
    `ws://127.0.0.1:${s.port}/?room=${c.id}&player=${i}&key=${key}`)));
  const peerProcesses=[];
  for(let i=0;i<peerCount;i++){
    const peer=spawn('peers.cjs'),ready=wait(peer,'ready');
    peer.send({type:'connect',urls:urls.filter((_,j)=>j%peerCount===i)});await ready;peerProcesses.push(peer);
  }
  const start=performance.now(),cpu=process.cpuUsage();let peakRss=process.memoryUsage().rss,minFree=os.freemem();
  let windowAt=start,windowAck=0,windowCast=0,sampling=null;const windows=[];
  async function takeWindow(){
    const [shardWindows,peerWindows,lobby]=await Promise.all([
      Promise.all(shards.map(async s=>{const done=wait(s.child,'window');s.child.send({type:'sample'});return(await done).rooms;})),
      Promise.all(peerProcesses.map(async peer=>{const done=wait(peer,'window');peer.send({type:'sample'});return(await done).peer;})),services.sample()]);
    const castSamples=casts?.metrics.latency||[];
    const row={window:windows.length+1,throughSeconds:(performance.now()-start)/1000,rooms:shardWindows.flat(),peers:peerWindows,lobby,
      writerDelay:summary(delays.slice(windowAck)),castLatency:summary(castSamples.slice(windowCast)),
      progressPending:sink.pending.size,castsPending:casts?.queue.waiting.length||0,
      writerRssMiB:Math.round(process.memoryUsage().rss/1048576),freeMiB:Math.round(os.freemem()/1048576),errors};
    row.partial=Math.min(...row.rooms.map(r=>r.elapsedMs),...row.peers.map(p=>p.elapsedMs))<55000;
    row.assessment=require('./window-sampler.cjs').assessWindow(row);windows.push(row);
    fs.appendFileSync(path.join(output,'windows.ndjson'),JSON.stringify(row)+'\n');
    console.log(JSON.stringify({window:row.window,throughSeconds:row.throughSeconds,assessment:row.assessment,
      minHz:Math.min(...row.rooms.map(r=>r.updatesHz)),stateGapP99:Math.max(...row.peers.map(p=>p.gapMs.p99))}));
    windowAck=delays.length;windowCast=castSamples.length;
  }
  const monitor=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);minFree=Math.min(minFree,os.freemem());
    if(!sampling&&performance.now()-windowAt>=60000){
      windowAt=performance.now();sampling=takeWindow().catch(error=>{console.error(error);aborted=true;}).finally(()=>{sampling=null;});
    }
    if(minFree<2000*1048576)aborted=true;},1000);
  for(const s of shards)s.child.send({type:'start'});
  if(process.env.ROOM_BENCH_INPUTS==='socket')for(const peer of peerProcesses)peer.send({type:'startInputs'});
  await services.start();
  console.log(JSON.stringify({started:true,rooms:count,players:count*perRoom,processes:workers,seconds,output}));
  while(!aborted&&performance.now()-start<seconds*1000)await new Promise(r=>setTimeout(r,250));
  clearInterval(monitor);await sampling;
  if(!aborted&&(!windows.length||performance.now()-windowAt>=1000))await takeWindow();
  if(process.env.ROOM_BENCH_INPUTS==='socket')await Promise.all(peerProcesses.map(async peer=>{
    const done=wait(peer,'inputsStopped');peer.send({type:'stopInputs'});await done;
  }));
  const reports=await Promise.all(shards.map(async s=>{const done=wait(s.child,'report');s.child.send({type:'stop'});return(await done).report;}));
  const peerReports=await Promise.all(peerProcesses.map(async peer=>{
    const done=wait(peer,'report');peer.send({type:'stop'});return(await done).report;
  }));
  clearInterval(monitor);clearInterval(projectionTimer);const used=process.cpuUsage(cpu);
  const progressWorker=store.arenaPreparer?.stats;
  const serviceResults=await services.close();store=null;
  serviceResults.testDatabaseRemoved=await services.removeSyntheticDatabase();services=null;
  const saved=recover(filePath).data;
  const cursors=Object.values(saved.roomProgress);const rooms=reports.flatMap(r=>r.rooms);
  const report={scope:'isolated resident simulation + direct WebSocket state + local durable progress'+
      (durableCasts?' + real inventory/WAL casts':' (casts bypass inventory)')+
      (full?' + 1280 synthetic profiles/128 clans/5 real HTTP lobby clients':'')+
      (serviceResults.database?' + PostgreSQL verified':'')+'; no production arena admission in this run',
    rooms:count,perRoom,players:count*perRoom,processes:workers,seconds,aborted,shards:reports,peers:peerReports,windows,
    windowAssessment:{meetsTargets:!aborted&&windows.some(w=>!w.partial)&&windows.filter(w=>!w.partial).every(w=>w.assessment.meetsTargets),
      qualifiedWindows:windows.filter(w=>!w.partial).length,partialWindows:windows.filter(w=>w.partial).length,
      scope:'Sampled intervals before final drain. Intervals shorter than 55 seconds are retained as partial and do not prove a sustained window.'},
    gameClock,startingSeed:seed?.proof,projections:projections.metrics,
    notCovered:['production room admission','durable room state before effect publication','potions and pet ability inputs','external payments and VK','browser FPS'],
    scenario:{inputs:process.env.ROOM_BENCH_INPUTS||'in-process tick-based',layout:process.env.ROOM_BENCH_SCENARIO||'mixed-mass',event:eventKind||null,
      realistic:process.env.LOAD_REALISTIC==='1',linkedLobby:process.env.LOAD_REALISTIC==='1'?2:0,lobby:lobbyCount,
      mixedSocial:process.env.LOAD_REALISTIC==='1'||process.env.LOAD_MIXED_SOCIAL==='1',
      respawnDelayMs:Number(process.env.ROOM_BENCH_RESPAWN_DELAY_MS)||0,meanAlive:rooms.reduce((sum,r)=>sum+r.meanAlive,0)},
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
  clearInterval(projectionTimer);
  for(const child of children)if(child.connected)child.kill();
  if(services)await services.close();
  else if(store)await store.close();
});
