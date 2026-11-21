"use strict";
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { OwnerService } = require('../../src/server/admin/owner-service');
const { ServiceObserver } = require('../../src/server/runtime/service-observer');
const { temporary } = require('../temp');

test('action and security journals paginate independently, retain target filtering and do not alter history', () => {
  const rows = prefix => Array.from({length: 23}, (_, i) => ({id: prefix+i, at: i, targetId: i%2 ? 'other' : 'chosen'}));
  const actions=rows('action-'), security=rows('security-'), before=JSON.stringify([actions,security]);
  const owner = new OwnerService({profiles:{data:{administration:{audit:actions}}},access:{security:{audit:()=>security}}});
  for (const source of ['actions','security']) {
    const pages=[1,2,3].map(page=>owner.audit('',page,source));
    assert.deepEqual(pages.map(p=>p.entries.length),[10,10,3]);
    assert.ok(pages.every(p=>p.total===23 && p.pages===3));
    assert.equal(new Set(pages.flatMap(p=>p.entries.map(e=>e.id))).size,23);
    assert.ok(pages.flatMap(p=>p.entries).every(e=>e.id.startsWith(source==='actions'?'action-':'security-')));
    assert.equal(owner.audit('chosen',1,source).total,12);
    assert.equal(owner.audit('chosen',2,source).entries.length,2);
    assert.equal(owner.audit('',99,source).page,3);
  }
  assert.equal(owner.audit().total,46);
  assert.throws(()=>owner.audit('',1,'unknown'),/вид журнала/);
  assert.equal(JSON.stringify([actions,security]),before);
});

test('runtime and watchdog workers return ten entries per independent cursor without losing appended history', async t => {
  const directory=temporary(t,'journal-pages');
  const rows=source=>Array.from({length:23},(_,i)=>({id:source+i,at:i,active:{},reason:'Проверка журнала'}));
  for(const source of ['runtime','watchdog'])fs.writeFileSync(path.join(directory,source+'.jsonl'),rows(source).map(e=>JSON.stringify(e)+'\n').join(''));
  const observer=new ServiceObserver({directory,intervalMs:60000,source:()=>({faults:[]})});
  t.after(()=>observer.close());
  for(const source of ['runtime','watchdog']){
    const first=await observer.journal(source);
    fs.appendFileSync(path.join(directory,source+'.jsonl'),JSON.stringify({id:source+'new',at:24,active:{}})+'\n');
    const second=await observer.journal(source,first.cursor),third=await observer.journal(source,second.cursor);
    assert.deepEqual([first,second,third].map(p=>p.entries.length),[10,10,3]);
    assert.equal(third.cursor,null);
    assert.deepEqual([first,second,third].flatMap(p=>p.entries.map(e=>e.id)),rows(source).reverse().map(e=>e.id));
    assert.equal((await observer.journal(source)).entries[0].id,source+'new');
    assert.equal(fs.readFileSync(path.join(directory,source+'.jsonl'),'utf8').trim().split('\n').length,24);
  }
});
