/* Local transport experiment. Not loaded by the game. */
const threads = require('node:worker_threads');
if (threads.isMainThread) {
  const send = threads.Worker.prototype.postMessage;
  threads.Worker.prototype.postMessage = function(job, transfers) {
    if (!job.rooms || !job.id) return send.call(this, job, transfers);
    return send.call(this, {...job, foodJsonTransfer:true, rooms:job.rooms.map(room=>({...room,
      states:room.states.map(group=>({...group,snapshot:{...group.snapshot,ether:undefined},foodJson:JSON.stringify(group.snapshot.ether)}))
    }))}, transfers);
  };
} else if (threads.parentPort) {
  const on = threads.parentPort.on;
  threads.parentPort.on = function(name, listener) {
    return on.call(this, name, name==='message'?job=>{
      if(job.foodJsonTransfer){for(const room of job.rooms)for(const group of room.states){group.snapshot.ether=JSON.parse(group.foodJson);delete group.foodJson;}delete job.foodJsonTransfer;}
      return listener(job);
    }:listener);
  };
}
