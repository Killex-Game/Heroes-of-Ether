"use strict";
// ISOLATED EXPERIMENT ONLY. Not imported by game-server. The normal store
// rejects version 15 so an experimental world cannot silently run without its
// reservation/recovery coordinator. database is a mirror, never a second writer.
const { ChildProcess }=require('node:child_process');
const { createHash }=require('node:crypto');
const { arenaCastDraft }=require('../../profiles/profile-store');
const indexes=require('../../profiles/profile-index');
const tables=require('../../profiles/immutable-table-delta');
const { copyRecord }=require('../../profiles/copy-record');
const records=require('./room-cast-records');
const { planRoomRecovery }=require('./room-recovery');
const { RoomOutbox }=require('./room-outbox');
const questBoundary=require('./room-quest-boundary');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stopped=child=>child.exitCode!==null || child.signalCode!==null;
const identity=(room,input)=>room && room.roomId===input.roomId && room.epoch===input.epoch;
class RoomProfileLedger {
  constructor(store) {
    if(!store.residentRoomExperiment || !store.journal)throw Error('Resident profile ledger requires explicit isolated experiment');
    this.store=store;this.bindings=new Map();this.pending=0;this.chain=Promise.resolve();
    this.queue=[];this.writing=false;this.scheduled=false;this.idle=null;
    this.metrics={operations:0,flushes:0,conflicts:0,failures:0,maxQueue:0};
    this.fenced=new Set();
    const prior=store.clanQuestSettlementReady;
    // Conservative until the resident boundary sampler is integrated: active
    // rooms may not let reads/admin writes settle ahead of their durable tail.
    store.clanQuestSettlementReady=at=>(!prior || prior(at)!==false) && this.settlementReady(at);
  }
  settlementReady(at) {
    const world=this.store.data;
    if(!world.clanQuests || world.clanQuests.nextAt>at)return true;
    for(const room of Object.values(world.residentRooms || {})) {
      if(room.status==='CLOSED')continue;
      for(const id of room.profiles) {
        const p=this.store.byId(id),board=world.clans[p?.clanId]?.dailyQuests?.board;
        if(board && !board.settledAt && board.end<=at && room.at<board.end)return false;
      }
    }
    return true;
  }
  enqueue(build) {
    if(this.pending>=1024)return Promise.reject(Error('Resident ledger admission full'));
    this.pending++;
    if(!this.idle)this.chain=new Promise(resolve=>{this.idle=resolve;});
    const task=new Promise((resolve,reject)=>{
      this.queue.push({build,resolve,reject});this.metrics.maxQueue=Math.max(this.metrics.maxQueue,this.queue.length);
    });
    this.schedule();
    return task;
  }
  schedule() {
    if(this.writing || this.scheduled || !this.queue.length)return;
    this.scheduled=true;setImmediate(()=>{this.scheduled=false;this.flush();});
  }
  async flush() {
    if(this.writing || !this.queue.length)return;
    this.writing=true;const selected=[];
    try {
      const base=this.store.data,at=this.store.now(),started=performance.now();let snapshot=base;
      // Preserve FIFO and all per-operation timestamps. A bounded cheap prefix
      // shares one fsync; expensive work returns control to socket/IPC handlers.
      for(const entry of this.queue) {
        if(selected.length && (selected.length>=256 || performance.now()-started>=8))break;
        try {
          const draft=entry.build(snapshot,at);snapshot=draft.next || snapshot;
          selected.push({entry,result:draft.result});
        }catch(error){selected.push({entry,error});}
      }
      if(snapshot!==base) {
        const next=this.store.prepareSnapshot(snapshot,at,undefined,base);
        if(!await this.store.flushArenaSnapshot(next,true)){this.metrics.conflicts++;return;}
        this.metrics.flushes++;
      }
      this.queue.splice(0,selected.length);this.pending-=selected.length;
      for(const item of selected) {
        if(item.error)item.entry.reject(item.error);
        else {this.metrics.operations++;item.entry.resolve(structuredClone(item.result));}
      }
    }catch(error){
      this.metrics.failures++;const failed=this.queue.splice(0,Math.max(1,selected.length));this.pending-=failed.length;
      for(const entry of failed)entry.reject(error);
    }finally{
      this.writing=false;
      if(this.queue.length)this.schedule();else{const done=this.idle;this.idle=null;done?.();}
    }
  }
  claim({roomId,epoch,profileIds},child) {
    profileIds=structuredClone(profileIds);
    if(!(child instanceof ChildProcess) || !child.pid || stopped(child) ||
        !records.keyOK(roomId) || !records.keyOK(epoch))return Promise.reject(Error('Invalid resident process owner'));
    return this.enqueue(base=>{
      const previous=base.residentRooms?.[roomId];
      if((previous && (previous.status!=='CLOSED' || previous.epoch===epoch)) || !Array.isArray(profileIds) || !profileIds.length ||
          profileIds.length>35 || new Set(profileIds).size!==profileIds.length ||
          profileIds.some(id=>!this.store.byId(id,base) || this.store.residentRecoveryProfiles.has(id)) ||
          (!previous && Object.keys(base.residentRooms || {}).length>=256))
        throw Error('Resident room claim conflicts');
      const others=new Set(Object.values(base.residentRooms || {}).filter(r=>r.status!=='CLOSED').flatMap(r=>r.profiles));
      if(profileIds.some(id=>others.has(id)))throw Error('Profile is already owned by a resident room');
      if(stopped(child))throw Error('Resident owner exited during admission');
      const room={roomId,epoch,profiles:[...profileIds],sequence:0,digest:null,at:0,status:'ACTIVE',frameReceipts:{},deadlineProtocol:1,boundaryThrough:0};
      return {next:{...base,version:15,residentRooms:{...base.residentRooms,[roomId]:room}},result:room};
    }).then(room=>{this.bindings.set(roomId,{epoch,child});this.fenced.delete(roomId);return room;});
  }
  owner(base,input,child,{fenced=false}={}) {
    const room=base.residentRooms?.[input.roomId],bound=this.bindings.get(input.roomId);
    if(!identity(room,input) || bound?.epoch!==input.epoch || bound.child!==child ||
        (!fenced && (room.status!=='ACTIVE' || this.fenced.has(input.roomId) || stopped(child))))
      throw Error('Stale or unowned resident operation');
    return room;
  }
  reserve(child,token,input) {
    // Freeze caller input before queueing or waiting for another write.
    input=structuredClone(input);
    return this.enqueue((base,at)=>{
      const room=this.owner(base,input,child),profile=this.store.find(token,base);
      if(!profile || !room.profiles.includes(profile.id))throw Error('Unowned resident profile');
      const tx=records.identity(input,profile,at),old=records.read(profile,tx.txId);
      if(old) {
        if(!records.same(old,tx))throw Error('Conflicting resident cast replay');
        return {result:old};
      }
      records.expiration(profile,tx,at);
      const batch={next:base};
      this.store.transact(token,tx.txId,records.encode(tx),p=>records.reserve(p,tx,at),
        undefined,arenaCastDraft,batch);
      return {next:batch.next,result:tx};
    });
  }
  editProfile(world,id,mutate) {
    const key=indexes.profileKeys(world.profiles).get(id),current=world.profiles[key];
    if(!current)throw Error('Missing owned profile');
    const draft=arenaCastDraft(current);mutate(draft);draft.revision++;
    const profiles=Object.assign(copyRecord(world.profiles),{[key]:draft});
    tables.remember(profiles,world.profiles,[key],true);indexes.remember(profiles,indexes.profileKeys(world.profiles));
    return {...world,profiles};
  }
  applyEntry(base,room,entry) {
    const f=entry?.frame;
    if(!identity(room,f || {}) || !Number.isSafeInteger(f.sequence) || f.sequence<1 || !Number.isSafeInteger(f.at) || f.at<0 ||
        !['tick','boundary','end'].includes(f.kind) || !Array.isArray(f.progress) || !Array.isArray(f.applied) ||
        (f.cancelled!==undefined && !Array.isArray(f.cancelled)) ||
        (f.boundaryAt!==undefined && (f.kind!=='boundary' || !Number.isSafeInteger(f.boundaryAt) || f.boundaryAt<=f.at)) ||
        f.progress.length>10000 || f.applied.length+(f.cancelled?.length || 0)>256 || hash(f)!==entry.digest)
      throw Error('Invalid resident frame envelope');
    if(f.sequence<=room.sequence && room.frameReceipts?.[f.sequence]===entry.digest)return base;
    if(f.sequence!==room.sequence+1)throw Error('Resident frame gap or replay conflict');
    if(f.at<room.at)throw Error('Resident frame timestamp moved backwards');
    questBoundary.validate(room,f);
    if(f.progress.some(e=>!room.profiles.includes(e?.profileId) || e.type==='boosterUsed'))
      throw Error('Unowned progress or duplicate booster credit');
    let next=base;const used=new Set(),events=[],drafts=new Map();
    for(const [casts,status] of [[f.applied,'APPLIED'],[f.cancelled || [],'REFUNDED']])for(const cast of casts) {
      if(!room.profiles.includes(cast?.profileId) || used.has(cast.txId))throw Error('Unowned or duplicated resident cast');
      used.add(cast.txId);
      const p=drafts.get(cast.profileId) || this.store.byId(cast.profileId,base),tx=records.read(p,cast.txId);
      if(!tx || tx.status!=='RESERVED' || !identity(room,tx) || tx.lifeId!==cast.lifeId || tx.boosterId!==cast.boosterId ||
          (status==='APPLIED' && tx.boosterId==='easter_egg' && tx.expiresAt<=f.at) ||
          (status==='APPLIED' && p.progress.session?.id!==cast.lifeId) ||
          (cast.mass!==undefined && (!Number.isSafeInteger(cast.mass) || cast.mass<0)))
        throw Error('Resident applied cast conflicts with its reservation');
      // Several paid outcomes can belong to the same profile in one private
      // frame. Own its mutable fields once, retain each revision increment,
      // and copy the global profile table once for the whole accepted frame.
      const draft=drafts.get(cast.profileId) || arenaCastDraft(p);
      records.resolve(draft,tx,status,f.at);draft.revision++;
      drafts.set(cast.profileId,draft);
      if(status==='APPLIED')events.push({type:'boosterUsed',profileId:cast.profileId,lifeId:cast.lifeId,...(cast.mass===undefined?{}:{mass:cast.mass})});
    }
    if(drafts.size){
      const keys=indexes.profileKeys(base.profiles),profiles=copyRecord(base.profiles),changed=[];
      for(const [id,draft]of drafts){const key=keys.get(id);profiles[key]=draft;changed.push(key);}
      tables.remember(profiles,base.profiles,changed,true);indexes.remember(profiles,keys);
      next={...base,profiles};
    }
    // Exactly one successful-use credit per confirmed reservation, before the
    // physical consequences/death in the same private frame.
    const progress=this.store.arenaProgressDraft(next,`resident:${room.roomId}:${room.epoch}:${f.sequence}`,
      [...events,...f.progress],f.at);
    next=progress?.next || next;
    const frameReceipts={...room.frameReceipts,[f.sequence]:entry.digest};
    delete frameReceipts[f.sequence-256];
    const cursor={...room,sequence:f.sequence,digest:entry.digest,at:f.at,frameReceipts,
      ...(f.boundaryAt===undefined?{}:{boundaryThrough:f.boundaryAt})};
    return {...next,residentRooms:{...next.residentRooms,[room.roomId]:cursor}};
  }
  accept(child,entry) {
    entry=structuredClone(entry);
    return this.enqueue(base=>{
      const room=this.owner(base,entry.frame,child),next=this.applyEntry(base,room,entry);
      return {next,result:{roomId:room.roomId,epoch:room.epoch,sequence:entry.frame.sequence,digest:entry.digest}};
    });
  }
  fenceStopped(input,child) {
    if(!(child instanceof ChildProcess) || !stopped(child))return Promise.reject(Error('Resident owner is still alive'));
    try { this.owner(this.store.data,input,child,{fenced:true}); } catch(error) { return Promise.reject(error); }
    this.fenced.add(input.roomId);
    return this.enqueue(base=>{
      const room=this.owner(base,input,child,{fenced:true});
      if(room.status==='CLOSED')return {result:room};
      const fenced={...room,status:'FENCED'};
      return {next:{...base,residentRooms:{...base.residentRooms,[room.roomId]:fenced}},result:fenced};
    });
  }
  bindRecovery(outbox) {
    // Following a coordinator restart there is no old ChildProcess object.
    // The exclusively opened recovery journal is the proof that its process
    // writer is gone. It cannot be used to resume simulation or accept IPC.
    if(!(outbox instanceof RoomOutbox) || !outbox.recoveryOnly || outbox.closed || outbox.fault || outbox.pending)
      return Promise.reject(Error('Exclusive existing recovery evidence required'));
    return this.enqueue(base=>{
      const room=base.residentRooms?.[outbox.roomId];
      if(!identity(room,outbox) || this.bindings.has(outbox.roomId))throw Error('Recovery binding conflicts');
      const nextRoom={...room,status:room.status==='CLOSED'?'CLOSED':'FENCED'};
      return {next:{...base,residentRooms:{...base.residentRooms,[room.roomId]:nextRoom}},result:nextRoom};
    }).then(room=>{
      this.bindings.set(outbox.roomId,{epoch:outbox.epoch,child:outbox,recovery:true});
      this.fenced.add(outbox.roomId);return room;
    });
  }
  recoverStopped(outbox,child) {
    return this.enqueue((base,at)=>{
      const room=this.owner(base,outbox,child,{fenced:true});
      const recoveredOwner=child===outbox && this.bindings.get(room.roomId)?.recovery;
      if(!['FENCED','CLOSED'].includes(room.status) || (!recoveredOwner && !stopped(child)))
        throw Error('Resident recovery owner has not been fenced');
      const txs=new Map();
      for(const id of room.profiles) {
        const p=this.store.byId(id,base);
        for(const txId of Object.keys(p.residentCasts || {})) {
          const tx=records.read(p,txId);
          if(!tx || !identity(room,tx))throw Error('Resident reservation owner differs');
          txs.set(txId,tx);
        }
      }
      for(const {frame} of outbox.list())for(const cast of [...frame.applied,...(frame.cancelled || [])]) {
        const p=this.store.byId(cast.profileId,base),tx=p && records.read(p,cast.txId);
        if(!tx)throw Error('Recovered cast has no durable reservation');txs.set(tx.txId,tx);
      }
      const plan=planRoomRecovery(outbox,room,[...txs.values()],room.profiles);
      if(room.status==='CLOSED') {
        if(plan.frames.length || plan.outcomes.length)throw Error('Closed resident room has an unresolved tail');
        return {result:room};
      }
      let next=base,cursor=room;
      for(const entry of plan.frames) {next=this.applyEntry(next,cursor,entry);cursor=next.residentRooms[room.roomId];}
      for(const outcome of plan.outcomes)if(outcome.status==='REFUNDED') {
        const tx=txs.get(outcome.txId);
        if(records.read(this.store.byId(tx.profileId,next),tx.txId)?.status==='REFUNDED')continue;
        next=this.editProfile(next,tx.profileId,p=>records.resolve(p,tx,'REFUNDED',at));
      }
      // Only after replaying the entire durable tail can the lost private arena
      // be ended. Startup must not clear sessions before this reconciliation.
      const endings=room.profiles.flatMap(profileId=>{
        const session=this.store.byId(profileId,next).progress.session;
        return session?[{type:'lifeEnded',profileId,lifeId:session.id,durationSeconds:session.activitySeconds || 0,reason:'recovered'}]:[];
      });
      // A missing end event cannot be backdated to the last observed tick.
      // Recovery after a quest cutoff must not manufacture a timely exit and
      // award a life that was still active when its durable prefix ended.
      if(endings.length)next=this.store.arenaProgressDraft(next,`resident-end:${room.roomId}:${room.epoch}`,endings,at)?.next || next;
      cursor={...cursor,status:'CLOSED'};
      next={...next,residentRooms:{...next.residentRooms,[room.roomId]:cursor}};
      return {next,result:cursor};
    }).then(room=>{
      for(const id of room.profiles)this.store.residentRecoveryProfiles.delete(id);
      return room;
    });
  }
}
module.exports={RoomProfileLedger};
