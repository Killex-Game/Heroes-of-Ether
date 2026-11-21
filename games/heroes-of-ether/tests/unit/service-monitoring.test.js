"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {temporary}=require('../temp'),{ObservationStore,events,activeModes,rate}=require('../../src/server/runtime/service-observation-store');
const {ServiceWatchdog}=require('../../src/server/runtime/service-watchdog'),{observeMongo}=require('../../src/server/persistence/mongodb-metrics');
test('external probe detects a stopped or hung HTTP process and rejects an HTML proxy error',async t=>{
 const http=require('node:http'),{once}=require('node:events'),{probe}=require('../../src/server/runtime/service-watchdog');let mode='healthy';
 const server=http.createServer((req,res)=>{if(mode==='hung')return;if(mode==='html'){res.writeHead(503);res.end('Gateway unavailable');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({maintenance:mode==='maintenance',serverNow:Date.now()}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});const url='http://127.0.0.1:'+server.address().port+'/api/service-status';
 assert.equal(await probe(url),true);mode='maintenance';assert.equal(await probe(url),true);mode='html';assert.equal(await probe(url),false);mode='hung';assert.equal(await probe(url,50),false);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(await probe(url),false);
});
test('all overlapping manual modes and automatic incidents retain starts/ends, restart and backwards pagination without duplicates',t=>{
 const dir=temporary(t,'service-journal'),store=new ObservationStore(dir),windows=['maintenance','failure','unavailable'].map(mode=>({mode,enabled:true,startsAt:10,endsAt:20}));
 store.update(activeModes({windows,faults:['MONGODB_FAILED']},10),10);assert.equal(events(store.file).entries.length,4);
 const restored=new ObservationStore(dir);restored.update(activeModes({windows,faults:['MONGODB_FAILED']},15),15);assert.equal(events(store.file).entries.length,4);
 restored.update(activeModes({windows,faults:[]},20),20);const result=[];let cursor=null;
 do{const page=events(store.file,cursor,3);result.push(...page.entries);cursor=page.cursor;}while(cursor!==null);
 assert.equal(result.length,8);assert.equal(new Set(result.map(e=>e.id)).size,8);assert.equal(result.filter(e=>e.kind==='started').length,4);
 assert.equal(result.filter(e=>e.kind==='ended').length,4);assert.deepEqual(new ObservationStore(dir).active,{});
 fs.appendFileSync(store.file,'{"torn":');assert.equal(new ObservationStore(dir).active.constructor,Object);assert.equal(events(store.file).entries.length,8);
});
test('watchdog distinguishes planned outage and transient probe failure; incident survives restart until two successful probes',t=>{
 const dir=temporary(t,'watchdog'),flag=path.join(dir,'maintenance.enabled');let at=10;
 let w=new ServiceWatchdog({directory:dir,maintenanceFile:flag,now:()=>at++});
 assert.equal(w.observe(false).active,false);assert.equal(w.observe(true).active,false);assert.equal(events(w.store.file).entries.length,0);
 fs.writeFileSync(flag,'');w.observe(false);assert.equal(w.observe(false).active,false);fs.unlinkSync(flag);
 assert.equal(w.observe(false).active,false);assert.equal(w.observe(false).active,true);assert.equal(w.observe(false).active,true);assert.equal(events(w.store.file).entries.length,1);
 w=new ServiceWatchdog({directory:dir,maintenanceFile:flag,now:()=>at++});assert.equal(w.observe(true).active,true);assert.equal(w.observe(true).active,false);
 const entries=events(w.store.file).entries;assert.deepEqual(entries.map(e=>e.kind),['ended','started']);assert.equal(entries[1].reason,'SERVER_UNREACHABLE');
});
test('Mongo graphs count completed storage operations without retaining payload; rates reject counter resets and gaps',async()=>{
 const client=new EventEmitter(),metrics=observeMongo(client,()=>1000);
 assert.equal(metrics(),null);metrics.enable(true);assert.equal(client.monitorCommands,undefined);assert.equal(client.eventNames().length,0);
 const failure=Error('database failure'),collection=metrics.collection({findOne:async()=>({secret:'never retain'}),bulkWrite:async()=>({modifiedCount:1}),updateOne:async()=>{throw failure}});
 assert.deepEqual(await collection.findOne({}),{secret:'never retain'});await collection.bulkWrite([]);
 await assert.rejects(collection.updateOne({}),error=>error===failure);
 const a=metrics();assert.equal(a.read,1);assert.equal(a.write,1);assert.equal(a.failed,1);assert.ok(!JSON.stringify(a).includes('secret'));
 assert.deepEqual(rate(a,{...a,at:2000,read:4,write:5},['read','write']),{read:3,write:4});assert.equal(rate(a,{...a,epoch:'restarted',at:2000},['read']),null);assert.equal(rate(a,{...a,at:2000,read:0},['read']),null);
 metrics.enable(false);assert.equal(client.monitorCommands,undefined);assert.equal(metrics(),null);
});
