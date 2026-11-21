"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {PlayerPresence}=require('../../src/server/runtime/player-presence');
test('online counts deduplicate lobby tabs, prioritize arena, expire lobby, exclude test bots',()=>{
  let at=0;const p=new PlayerPresence({now:()=>at});p.touch('a');p.touch('a');p.touch('b');p.touch('bot');
  const humans=id=>id!=='bot';assert.deepEqual(p.counts(['a','a','c','bot'],humans),{arena:2,lobby:1,total:3});
  at=60000;assert.deepEqual(p.counts(['a'],humans),{arena:1,lobby:0,total:1});
  assert.deepEqual(p.counts([],humans),{arena:0,lobby:0,total:0});
});
