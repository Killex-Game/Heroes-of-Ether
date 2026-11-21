'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Arena } = require('../../src/server/arena/arena-simulation');

test('mass food expiry and thorn contacts preserve survivor order, identity and reverse contact order', () => {
  const arena = new Arena({ etherCount: 0 });
  const contacts = [];
  arena.hazards = {
    feedIndex: () => ({}),
    feed: orb => { contacts.push(orb.id); return orb.id.endsWith('-eaten'); },
  };
  const source = Array.from({ length: 240 }, (_, i) => ({
    id: i + (i % 4 === 1 ? '-eaten' : '-kept'), x: 100, y: 100,
    radius: 5, value: 1,
    ...(i % 4 ? { ejected: true, vx: 10, vy: 20, updatedAt: 1000,
      expiresAt: i % 4 === 2 ? 2000 : 3000 } : {}),
  }));
  arena.ether = source.slice();
  const originalArray = arena.ether;
  arena.moveFeed(2000);
  assert.strictEqual(arena.ether, originalArray);
  const expected = source.filter((_, i) => i % 4 === 0 || i % 4 === 3);
  assert.deepEqual(arena.ether, expected);
  for (let i = 0; i < expected.length; i++) assert.strictEqual(arena.ether[i], expected[i]);
  assert.deepEqual(contacts, source.filter((_, i) => i % 4 === 1 || i % 4 === 3).reverse().map(o => o.id));
  arena.moveFeed(3000);
  assert.deepEqual(arena.ether, source.filter((_, i) => i % 4 === 0));
  assert.strictEqual(arena.ether, originalArray);
});

test('expiring the whole food list leaves an empty reusable array', () => {
  const arena = new Arena({ etherCount: 0 });
  arena.ether = Array.from({ length: 1000 }, (_, i) => ({ id: 'e' + i, ejected: true, expiresAt: 1 }));
  const original = arena.ether;
  arena.moveFeed(1);
  assert.strictEqual(arena.ether, original);
  assert.equal(arena.ether.length, 0);
  arena.moveFeed(2);
  assert.equal(arena.ether.length, 0);
});

test('full-field reservation preserves natural-first priority and cannot remove protected launches', () => {
  const arena=new Arena({etherCount:0});
  const source=Array.from({length:arena.etherLimit},(_,i)=>({id:i,ejected:true,sourcePickupAt:i%2?100:2000}));
  source[700]={id:700};source[900]={id:900};arena.ether=source.slice();
  assert.equal(arena.reserveFeedSpace(4,1000),4);
  assert.deepEqual(arena.ether,source.filter((_,i)=>![1,3,700,900].includes(i)));
  for(const orb of arena.ether)assert.strictEqual(orb,source[orb.id]);
  arena.ether=source.map(orb=>({...orb,ejected:true,sourcePickupAt:2000}));
  const unchanged=arena.ether.slice();assert.equal(arena.reserveFeedSpace(1,1000),0);assert.deepEqual(arena.ether,unchanged);
  arena.ether[500].sourcePickupAt=999;assert.equal(arena.reserveFeedSpace(3,1000),0);assert.deepEqual(arena.ether,unchanged);
  assert.equal(arena.reserveFeedSpace(3,1000,true),1);assert.equal(arena.ether.length,arena.etherLimit-1);
  assert.ok(!arena.ether.some(o=>o.id===500));
});
