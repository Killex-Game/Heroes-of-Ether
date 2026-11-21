"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/black-friday-fixture');
const B=require('../../src/server/events/black-friday');
test('owner test credit 49 keeps final locked until one real order; final only once',()=>{
 const f=fixture();f.act('swap',f.view().orders[0].id);
 const s=f.p().blackFriday.runs[f.run.id];s.testOrderCredits=49;s.completedOrders=49;
 assert.throws(()=>f.act('final'));
 f.life();const o=f.view().orders.find(o=>!o.claimed&&o.progress>=o.target);assert.ok(o);
 f.act('order',o.id);assert.equal(f.view().completedOrders,50);f.act('final');assert.equal(f.view().finalClaimed,true);
 assert.throws(()=>f.act('final'));B.validate(f.p());
});
