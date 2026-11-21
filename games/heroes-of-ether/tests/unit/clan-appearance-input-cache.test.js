"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const { SettlementCache } = require('../../src/server/profiles/settlement-cache');
const { capture } = require('../../src/server/clans/clan-appearance');
test('clan appearance reuse retains exact expiry, access, migration and immutable older versions', () => {
  const cache = new SettlementCache(); let calls = 0;
  const inspect = (...args) => { calls++; return capture(...args); };
  const at = 1800000000000;
  let clan = {id:'test',xp:0,appearance:{background:'silver',grants:{silver:at+10},grantVersion:2}};
  const old = structuredClone(clan);
  const check = (row, time, unlocked=false) => {
    const actual=cache.clanAppearance(row,time,unlocked,inspect);
    assert.deepEqual(actual,capture(row,time,false,unlocked)); return actual;
  };
  check(clan,at); assert.equal(calls,1);
  for(let i=1;i<=9;i++) check({...clan,xp:i,competition:{wins:i}},at+i);
  assert.equal(calls,1);
  const expired=check({...clan,xp:20},at+10); assert.equal(calls,2);
  assert.equal(expired.appearance.background,'default'); assert.deepEqual(clan,old);
  check({...clan,xp:21},at+11,true); assert.equal(calls,3);
  check({...clan,xp:22},at+12,false); assert.equal(calls,4);
  check({...clan,xp:23},at+1); assert.equal(calls,5);
  check({...clan,appearance:{...clan.appearance,grants:{silver:at+100}}},at+20);
  assert.equal(calls,6);
  check({id:'new',xp:0},at); assert.equal(calls,7);
  check({id:'legacy',xp:0,appearance:{background:'bronze',grants:{bronze:at+100}}},at);
  assert.equal(calls,8);
});
