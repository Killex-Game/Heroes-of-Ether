'use strict';
const {performance}=require('node:perf_hooks');
function createMeter(now=()=>performance.now()){
  let rows={},top=null;
  function wrap(target,key,name){
    const original=target[key];
    if(typeof original!=='function')throw Error('Missing measured method: '+key);
    target[key]=function(...args){
      const label=typeof name==='function'?name(args):name;
      const scope={parent:top,children:0,start:now()};top=scope;
      try{return original.apply(this,args);}
      finally{
        const duration=now()-scope.start;top=scope.parent;
        if(top)top.children+=duration;
        const row=rows[label]||=( {calls:0,inclusiveMs:0,exclusiveMs:0,maxMs:0} );
        row.calls++;row.inclusiveMs+=duration;row.exclusiveMs+=Math.max(0,duration-scope.children);row.maxMs=Math.max(row.maxMs,duration);
      }
    };
  }
  return {wrap,reset(){if(top)throw Error('Cannot reset an active stage');rows={};},snapshot(){return structuredClone(rows);}};
}
function install({app,profiles,arenas}){
  const meter=createMeter();
  meter.wrap(app,'tick','tickWall');
  meter.wrap(require('../../src/server/arena/room-step'),'stepRoom','roomStep');
  for(const arena of arenas){
    meter.wrap(arena,'step','physics');meter.wrap(arena,'snapshot','snapshotBuild');
    meter.wrap(arena,'handleInput','inputApply');
    if(process.env.LOAD_PHYSICS_STAGES==='1') {
      for(const key of ['collectEther','moveFeed','moveParts','separateParts','resolveAbsorptions'])
        meter.wrap(arena,key,'physics.'+key);
      for(const [object,key,label] of [[arena.hazards,'beginStep','hazardBegin'],[arena.hazards,'collect','hazardCollect'],
        [arena.combat,'update','combatUpdate'],[arena.boosterEffects,'tick','boosterEffects']])
        if(object)meter.wrap(object,key,'physics.'+label);
    }
  }
  meter.wrap(profiles,'prepareSnapshot','profilePrepare');
  meter.wrap(require('node:worker_threads').Worker.prototype,'postMessage',args=>{
    const packet=args[0];return packet?.rooms?'statePostMessage':packet?.batches?'progressPostMessage':'otherPostMessage';
  });
  if(app.stateWorkers.lanes.length){
    const lane=Object.getPrototypeOf(app.stateWorkers.lanes[0]);
    meter.wrap(lane,'dispatch','statePackAndPost');
    meter.wrap(lane,'complete','stateResultDelivery');
  }
  meter.wrap(require('ws').prototype,'send','wsSend');
  return meter;
}
module.exports={createMeter,install};
