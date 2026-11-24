'use strict';
const assert=require('node:assert/strict');
const {STATE_WORKER_LIMITS}=require('../../src/server/arena/state-worker-policy');
function workerPolicy(settings){
  assert.equal(typeof settings.enabled,'boolean');
  assert(Number.isInteger(settings.maxWorkers)&&settings.maxWorkers>=0&&settings.maxWorkers<=STATE_WORKER_LIMITS.MAX_WORKERS);
  assert(Number.isInteger(settings.maxRooms)&&settings.maxRooms>=1);
  assert(!settings.enabled||settings.maxWorkers>0);
  return {LOAD_STATE_WORKERS:String(settings.enabled?settings.maxWorkers:0),LOAD_STATE_WORKER_ROOMS:String(settings.maxRooms)};
}
module.exports={workerPolicy};
