'use strict';
// Long-run instrumentation must not retain every packet and look like a game
// memory leak. Summary sorts a copy, so a ring's chronological order is unused.
class SampleWindow extends Array {
 constructor(limit){super();this.limit=limit;this.cursor=0;}
 push(...values){for(const value of values){if(this.length<this.limit)super.push(value);else{this[this.cursor]=value;this.cursor=(this.cursor+1)%this.limit;}}return this.length;}
}
module.exports=()=>process.env.ROOM_BENCH_SOAK==='1'?new SampleWindow(8192):[];
