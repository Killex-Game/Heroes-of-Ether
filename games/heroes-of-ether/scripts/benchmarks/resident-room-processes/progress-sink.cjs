"use strict";
// Experimental single writer. No separate ProfileStore/WAL writer in a room.
const { createHash } = require('node:crypto');
const { replayStatus, advance } = require('./progress-cursor.cjs');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
class RoomProgressSink {
  constructor(store, { maxBatchSize = 64 } = {}) {
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 128)
      throw RangeError('Invalid room writer batch size');
    this.maxBatchSize = maxBatchSize;
    this.store = store;
    this.owners = new Map();
    this.profileOwners = new Map();
    this.queue = [];
    this.pending = new Map();
    this.writing = false;
    this.scheduled = false;
    this.queueWaitMs = [];
    this.metrics = { batches: 0, replays: 0, coalesced: 0, flushes: 0, failures: 0, maxQueue: 0 };
  }
  claim(roomId, epoch, profileIds) {
    if (!keyOK(roomId) || !keyOK(epoch) || this.writing || this.queue.length) throw Error('Invalid room claim');
    if (!Array.isArray(profileIds) || !profileIds.length || new Set(profileIds).size !== profileIds.length ||
        profileIds.some(id => !keyOK(id) || !this.store.byId(id) || this.profileOwners.has(id)))
      throw Error('Profile already owned or invalid room roster');
    const previous = this.store.data.roomProgress?.[roomId];
    // A new owner may only be started after the old process has been fenced/stopped.
    // The benchmark coordinator owns that lifecycle; this token fences late IPC.
    if (this.owners.has(roomId)) throw Error('Room already owned');
    if (previous?.epoch !== epoch) this.store.save({ ...this.store.data,
      roomProgress: { ...this.store.data.roomProgress, [roomId]: { epoch, sequence: 0, digest: null } } });
    this.owners.set(roomId, { epoch, profiles: new Set(profileIds) });
    for (const id of profileIds) this.profileOwners.set(id, roomId);
    return this.store.data.roomProgress[roomId].sequence;
  }
  bind(roomId, epoch, channel) {
    const owner = this.owners.get(roomId);
    if (!owner || owner.epoch !== epoch || !channel || owner.channel) throw Error('Invalid room channel binding');
    owner.channel = channel;
  }
  commitFrom(channel, batch) {
    const owner = this.owners.get(batch?.roomId);
    if (!channel || owner?.channel !== channel) return Promise.reject(Error('Unowned room progress channel'));
    return this.accept(batch, true);
  }
  release(roomId, epoch) {
    if (this.writing || this.queue.some(x => x.batch.roomId === roomId)) throw Error('Progress still pending');
    const owner = this.owners.get(roomId);
    if (owner?.epoch === epoch) {
      this.owners.delete(roomId);
      for (const id of owner.profiles) this.profileOwners.delete(id);
    }
  }
  commit(batch) {
    // Public in-process callers retain ownership of their mutable buffers.
    return this.accept(batch, false);
  }
  commitTransferred(batch) {
    // Only the coordinator's authenticated child IPC handler uses this path.
    // Node has already deserialized an exclusive copy; the caller relinquishes
    // it here. Never pass client socket payloads or shared room buffers.
    return this.accept(batch, true);
  }
  accept(batch, transferred) {
    const owner = this.owners.get(batch?.roomId);
    if (!owner || owner.epoch !== batch.epoch || !Number.isSafeInteger(batch.sequence) || batch.sequence < 1 ||
        !Number.isSafeInteger(batch.at) || batch.at < 0 || !Array.isArray(batch.progress) || batch.progress.length > 10000 ||
        batch.progress.some(e => !owner.profiles.has(e?.profileId)))
      return Promise.reject(Error('Invalid room progress envelope'));
    // Isolate caller buffers: the exact events being hashed must be committed.
    if (!transferred) batch = structuredClone(batch);
    const hash = digest([batch.at, batch.progress]);
    const key = JSON.stringify([batch.roomId, batch.epoch, batch.sequence]);
    const pending = this.pending.get(key);
    if (pending) {
      if (pending.hash !== hash) return Promise.reject(Error('Conflicting pending room replay'));
      this.metrics.coalesced++;
      // A retry shares the original durable outcome, never an early ACK.
      return pending.promise;
    }
    if (this.queue.length >= 1024) return Promise.reject(Error('Progress queue full'));
    const promise = new Promise((resolve, reject) => {
      this.queue.push({ batch, hash, queuedAt: performance.now(),
        resolve: value => { this.pending.delete(key); resolve(value); },
        reject: error => { this.pending.delete(key); reject(error); } });
      this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.queue.length);
      this.schedule();
    });
    this.pending.set(key, { hash, promise });
    return promise;
  }
  schedule() {
    if (this.isPaused?.() || this.writing || this.scheduled || !this.queue.length) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (this.isPaused?.()) return;
      const writing = this.flush(); this.flushPromise = writing;
      writing.finally(() => { if (this.flushPromise === writing) this.flushPromise = null; });
    });
  }
  async barrier() {
    const pending = [...this.pending.values()].map(entry => entry.promise);
    this.schedule();
    await Promise.allSettled(pending);
  }
  markCalculation(entry) {
    if (entry.calculationStarted) return;
    entry.calculationStarted = true;
    this.queueWaitMs.push(performance.now() - entry.queuedAt);
  }
  async prepareInWorker() {
    const base=this.store.data, cursors={...base.roomProgress}, selected=[], inputs=[];
    for(const entry of this.queue.slice(0,this.maxBatchSize)){
      this.markCalculation(entry);
      const {batch:b,hash}=entry,cursor=cursors[b.roomId];
      let error,replay=false;
      if(cursor?.epoch!==b.epoch)error=Error('Stale room owner');
      else if(b.sequence<=cursor.sequence){
        const status=replayStatus(cursor,b.sequence,hash);
        if(status===true)replay=true;else error=status;
      }else if(b.sequence!==cursor.sequence+1)error=Error('Room progress gap');
      const item={entry,error,replay};selected.push(item);
      if(error||replay)continue;
      cursors[b.roomId]=advance(cursor,b.epoch,b.sequence,hash);
      item.input=true;
      inputs.push({id:`room:${b.roomId}:${b.epoch}:${b.sequence}`,at:b.at,progress:b.progress});
    }
    if(!inputs.length)return {snapshot:base,selected};
    let result=await this.store.arenaPreparer.prepare(this.store,inputs,50);
    if(result===null)return null; // A lobby transaction won; retry on its new state.
    if(result===undefined)result=this.store.prepareArenaBatches(inputs,8);
    let used=0;const prefix=[];const nextCursors={...base.roomProgress};
    for(const item of selected){
      if(item.input){
        if(used===result.changes.length)break;
        used++;
        const b=item.entry.batch;
        nextCursors[b.roomId]=advance(nextCursors[b.roomId],b.epoch,b.sequence,item.entry.hash);
      }
      prefix.push(item);
    }
    // The profile calculation and its fencing cursor share ONE fsynced commit.
    return {snapshot:{...result.snapshot,roomProgress:nextCursors},selected:prefix};
  }
  async flush() {
    if (this.writing || !this.queue.length) return;
    this.writing = true;
    let selected = [];
    try {
      this.store.refreshCompetition(this.queue[0].batch.at);
      let snapshot = this.store.data;
      const started = performance.now();
      if(this.store.arenaPreparer&&!this.store.arenaPreparer.failed){
        const result=await this.prepareInWorker();
        if(result===null)return;
        snapshot=result.snapshot;selected=result.selected;
      }else for (const entry of this.queue) {
        if (selected.length && (performance.now() - started >= 8 || this.store.competitionDue(snapshot, entry.batch.at))) break;
        this.markCalculation(entry);
        const { batch: b, hash } = entry, cursor = snapshot.roomProgress?.[b.roomId];
        if (cursor?.epoch !== b.epoch) { selected.push({ entry, error: Error('Stale room owner') }); continue; }
        if (b.sequence <= cursor.sequence) {
          const status = replayStatus(cursor, b.sequence, hash);
          selected.push({ entry, ...(status === true ? { replay: true } : { error: status }) });
          continue;
        }
        if (b.sequence !== cursor.sequence + 1) { selected.push({ entry, error: Error('Room progress gap') }); continue; }
        const draft = this.store.arenaProgressDraft(snapshot, `room:${b.roomId}:${b.epoch}:${b.sequence}`, b.progress, b.at);
        const next = { ...(draft?.next || snapshot), roomProgress: { ...snapshot.roomProgress,
          [b.roomId]: advance(cursor, b.epoch, b.sequence, hash) } };
        snapshot = this.store.prepareSnapshot(next, b.at, undefined, snapshot);
        selected.push({ entry });
      }
      if (snapshot !== this.store.data) {
        if (this.store.journal) {
          const committed = await this.store.flushArenaSnapshot(snapshot, true);
          if (!committed) return; // Another transaction won. Rebuild from the new durable base.
        } else this.store.save(snapshot);
        this.metrics.flushes++;
      }
      this.queue.splice(0, selected.length);
      for (const { entry, error, replay } of selected) {
        if (error) entry.reject(error);
        else {
          this.metrics[replay ? 'replays' : 'batches']++;
          entry.resolve({ roomId: entry.batch.roomId, epoch: entry.batch.epoch, sequence: entry.batch.sequence });
        }
      }
    } catch (error) {
      this.metrics.failures++;
      // No ACK on write failure. The room keeps its bounded outbox for retry.
      const failed = this.queue.splice(0, Math.max(1, selected.length));
      for (const entry of failed) entry.reject(error);
    } finally { this.writing = false; this.schedule(); }
  }
}
module.exports = { RoomProgressSink };
