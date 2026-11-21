'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const calendar=require('../../src/server/shop/weekend-promotions');
const ids=Array.from({length:26},(_,i)=>'weekend-'+(i+1));
const config=calendar.configuration({enabled:true,startsOn:'2026-11-20',repeat:true,offerIds:ids});
const at=s=>Date.parse(s);
test('weekly offers: exact Moscow boundaries, Sunday milliseconds and Monday closing',()=>{
  assert.equal(calendar.current(config,at('2026-11-20T11:59:59.999+03:00')),null);
  const open=calendar.requireActive(config,ids[0],at('2026-11-20T12:00:00+03:00'));
  assert.equal(open.startsAt,at('2026-11-20T09:00:00Z'));
  assert.equal(calendar.current(config,at('2026-11-22T23:59:59.999+03:00')).occurrenceId,open.occurrenceId);
  assert.equal(calendar.current(config,at('2026-11-23T00:00:00+03:00')),null);
  assert.throws(()=>calendar.requireActive(config,ids[0],at('2026-11-23T00:00:00+03:00')));
});
test('weekly offers: 26 distinct weeks repeat after 182 days; restart and timezone independent',()=>{
  const start=at('2026-11-20T09:00:00Z');
  for(let week=0;week<80;week++){
    const x=calendar.current(config,start+week*604800000);
    assert.equal(x.offerId,ids[week%26]);assert.equal(x.cycle,Math.floor(week/26)+1);
    assert.deepEqual(calendar.current(calendar.configuration(JSON.parse(JSON.stringify(config))),start+week*604800000),x);
    if(week)assert.notEqual(x.occurrenceId,calendar.current(config,start+(week-1)*604800000).occurrenceId);
    assert.throws(()=>calendar.requireActive(config,ids[(week+1)%26],start+week*604800000));
  }
});
test('weekly offers: pending catalogue never opens; invalid anchors or incomplete configuration fail closed',()=>{
  assert.equal(calendar.current(calendar.configuration(),Date.now()),null);
  for(const startsOn of ['2026-11-21','2026-02-30','not-a-date'])assert.throws(()=>calendar.configuration({...config,startsOn}));
  for(const offerIds of [[],ids.slice(1),Array(26).fill('one')])assert.throws(()=>calendar.configuration({...config,offerIds}));
  assert.equal(calendar.current(config,NaN),null);assert.throws(()=>calendar.configuration({...config,repeat:false}));
});
