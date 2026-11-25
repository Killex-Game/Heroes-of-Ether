'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {install}=require('../../scripts/benchmarks/queue-timeline.cjs');
test('queue timeline preserves repeated preparation, response and pending counts',()=>{
 let at=100,queued,finished=0;class Queue{use(command){queued=command;}}
 const probe=install(Queue,{now:()=>at}),queue=new Queue();queue.pending=7;
 queue.use({owner:'a',target:'b',prepare(){at+=2;return{valid:()=>true,finish(){finished++;}};},fail(){assert.fail();}});
 at+=20;queued.prepare();at+=30;const ready=queued.prepare();assert.equal(ready.valid(),true);at+=10;ready.finish();
 const r=probe.snapshot(),row=r.first[0];assert.equal(finished,1);assert.equal(r.pending,0);assert.equal(r.completed,1);
 assert.equal(row.waitMs,20);assert.equal(row.attempts,2);assert.equal(row.prepareMs,4);assert.equal(row.totalMs,64);assert.equal(row.pendingAtArrival,7);probe.restore();
});
test('queue timeline preserves thrown errors and immediate admission rejection',()=>{
 let at=0;class Queue{use(command){try{command.prepare().finish();}catch(error){command.fail(error);}}}
 const probe=install(Queue,{now:()=>at});const failure=Error('durability'),caught=[];
 new Queue().use({prepare(){at+=3;return{finish(){throw failure;}};},fail(error){caught.push(error);}});
 assert.deepEqual(caught,[failure]);assert.equal(probe.snapshot().groups.durability.count,1);assert.equal(probe.snapshot().duplicateCompletions,0);probe.restore();
});
test('window reset does not attribute older pending actions to the next interval',()=>{
 let pending;class Queue{use(command){pending=command;}}
 const probe=install(Queue),queue=new Queue();queue.use({prepare(){return{finish(){}};},fail(){}});probe.reset();pending.prepare().finish();
 assert.equal(probe.snapshot().arrived,0);assert.equal(probe.snapshot().completed,0);assert.equal(probe.snapshot().pending,0);probe.restore();
});
test('timeline details are bounded and rejected commands still call the original callback',()=>{
 class Queue{use(command){command.fail(Error('full'));}}let failures=0;
 const probe=install(Queue,{limit:3,detailLimit:2});for(let i=0;i<9;i++)new Queue().use({fail(){failures++;}});
 const r=probe.snapshot();assert.equal(failures,9);assert.equal(r.completed,9);assert.equal(r.dropped,6);assert.equal(r.first.length,2);assert.equal(r.pending,0);probe.restore();
});
