"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { startTickClock } = require("../../src/server/arena/tick-clock");

test("A durable barrier resumes exactly one owed step and never advances while locked", () => {
  let at=0, lock=true, nextId=0;
  const scheduled=new Map(), times=[];
  const stop=startTickClock(()=>{if(lock)return false;times.push(at);},50,{
    now:()=>at,
    schedule(fn,ms){const id=++nextId;scheduled.set(id,{fn,at:at+ms});return id;},
    cancel(id){scheduled.delete(id);},
  });
  const wake=()=>{const [id,item]=scheduled.entries().next().value;scheduled.delete(id);at=item.at;item.fn();};
  wake(); // 50 ms: blocked, only a bounded housekeeping retry remains.
  assert.equal(at,50);assert.deepEqual(times,[]);assert.equal(scheduled.size,1);
  at=52;stop.resume();stop.resume();assert.equal(scheduled.size,1);
  wake();assert.deepEqual(times,[]);assert.equal(scheduled.size,1);
  at=54;lock=false;stop.resume();wake();assert.deepEqual(times,[55]);
  stop.resume();assert.equal(scheduled.size,1);
  wake();assert.deepEqual(times,[55,105]);
  lock=true;wake();assert.equal(at,155);assert.equal(scheduled.size,1);
  wake();assert.equal(at,205);assert.deepEqual(times,[55,105]);
  at=8000;lock=false;stop.resume();wake();assert.deepEqual(times,[55,105,8001]);
  wake();assert.deepEqual(times,[55,105,8001,8051]);
  lock=true;wake();stop.resume();stop();assert.equal(scheduled.size,0);
  stop.resume();assert.equal(scheduled.size,0);
});
test("Arena clock corrects timer drift, skips missed turns, and stops cleanly", () => {
  let at = 0,
    scheduled,
    delay,
    ticks = 0,
    cancelled = false;
  const stop = startTickClock(
    () => {
      ticks++;
      at += 9;
    },
    50,
    {
      now: () => at,
      schedule(callback, ms) {
        scheduled = callback;
        delay = ms;
        return 1;
      },
      cancel() {
        cancelled = true;
      },
    },
  );
  assert.equal(delay, 50);
  at = 49;
  scheduled();
  assert.equal(ticks, 0);
  assert.equal(delay, 1);
  at = 57;
  scheduled();
  assert.equal(ticks, 1);
  assert.equal(delay, 34);
  at = 7100;
  scheduled();
  assert.equal(ticks, 2);
  assert.equal(delay, 41);
  stop();
  scheduled();
  assert.equal(cancelled, true);
  assert.equal(ticks, 2);
});

test("A late wake within one turn does not discard the next scheduled turn", () => {
  let at = 0, callback, delay;
  const times = [];
  const stop = startTickClock(() => { times.push(at); at += 15; }, 50, {
    now: () => at,
    schedule(fn, ms) { callback = fn; delay = ms; return 1; },
    cancel() {},
  });
  at = 80; callback();
  assert.equal(delay, 5, "keep the 100 ms deadline after a 30 ms late wake");
  at = 100; callback();
  assert.deepEqual(times, [80, 100]);
  assert.equal(delay, 35);
  at = 800; callback();
  assert.deepEqual(times, [80, 100, 800], "a long stall produces one real step only");
  assert.equal(delay, 35, "no historical catch-up loop");
  stop();
});
