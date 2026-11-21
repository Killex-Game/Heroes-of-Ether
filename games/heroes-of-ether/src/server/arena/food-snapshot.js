'use strict';
// Physics owns mutable positions (vortex also moves natural food). The network
// owns immutable value snapshots; a retained snapshot must not move next tick.
const natural=new WeakMap();
function createNatural(row){natural.set(row,null);return row;}
function snapshotNatural(row){
  if(!natural.has(row))return structuredClone(row);
  const previous=natural.get(row);
  if(previous && Object.is(previous.x,row.x) && Object.is(previous.y,row.y) &&
      Object.is(previous.id,row.id) && Object.is(previous.value,row.value) &&
      Object.is(previous.radius,row.radius) && Object.is(previous.color,row.color))return previous;
  const snapshot=Object.freeze({id:row.id,x:row.x,y:row.y,value:row.value,radius:row.radius,color:row.color});
  natural.set(row,snapshot);return snapshot;
}
module.exports={createNatural,snapshotNatural};
