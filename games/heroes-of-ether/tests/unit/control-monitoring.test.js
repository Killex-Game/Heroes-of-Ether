"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ControlMonitoring}=require('../../src/server/admin/control-monitoring');
const health=require('../../public/ui/admin/server-health');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'control-monitor-')),dataDir=path.join(dir,'data'),directory=path.join(dir,'control');fs.mkdirSync(dataDir);fs.mkdirSync(directory);
  let at=Date.UTC(2026,10,17);const now=()=>at,disk=at=>({available:true,epoch:'disk',device:'disk',at,read:at*2,write:at*3});
  const instances=[],make=()=>{const m=new ControlMonitoring({directory,dataDir,now,disk});instances.push(m);return m;};
  t.after(async()=>{for(const m of instances)await m.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,dataDir,directory,now,advance:ms=>at+=ms,make};
}
const performance=at=>({capturedAt:at,arena:{rooms:3},persistence:{queuedActions:1},memoryMiB:{resident:2200},tickWorkMs:{p95:21},tickIntervalMs:{p95:51},updatesHz:20});
test('overview survives control restart; game timestamps stay old while independent disk stays live',async t=>{
  const f=fixture(t),m=f.make(),at=f.now(),value=performance(at),monitor={at,stale:false,series:[{at,mongo:{read:2,write:3}}],mongo:{enabled:true},availability:{status:{maintenance:false},automatic:{active:false,faults:[]}}};
  await m.result('/api/admin/performance',value,{gameReady:true});await m.result('/api/admin/overview-calendar',{serverNow:at,active:null,scheduled:null},{gameReady:true});
  await m.result('/api/admin/monitoring',monitor,{gameReady:true});await m.close();
  f.advance(5000);const next=f.make(),saved=await next.result('/api/admin/performance',null,{gameReady:false});assert.equal(saved.capturedAt,at);assert.equal(saved.stale,true);assert.equal(saved.available,true);
  assert.ok(health.assess(saved).every(x=>x.level==='unknown'));
  assert.equal((await next.result('/api/admin/overview-calendar',null,{})).serverNow,at);
  await next.result('/api/admin/monitoring',null,{});f.advance(5000);
  const view=await next.result('/api/admin/monitoring',null,{gameReady:false});assert.equal(view.at,at);assert.equal(view.checkedAt,f.now());assert.equal(view.collecting,false);assert.deepEqual(view.series,monitor.series);
  assert.deepEqual(view.independent.series.at(-1).disk,{read:2000,write:3000});assert.equal(view.independent.at,f.now());
  assert.deepEqual(value,performance(at),'cache does not mutate the source');
  const fresh=performance(f.now());assert.deepEqual(await next.result('/api/admin/performance',fresh,{gameReady:true}),fresh);
});
test('cold or corrupt cache keeps overview available without inventing measurements or reading profiles',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.dataDir,'profiles.json'),'deliberately invalid world: must never be read');fs.writeFileSync(path.join(f.directory,'overview-cache.json'),'broken');
  const m=f.make(),p=await m.result('/api/admin/performance',null,{});assert.equal(p.available,false);assert.equal(p.capturedAt,undefined);
  const monitor=await m.result('/api/admin/monitoring',null,{});assert.equal(monitor.stale,true);assert.equal(monitor.logError,'MONITOR_IO_ERROR');assert.equal(monitor.availability.status.mode,'unavailable');
  fs.writeFileSync(path.join(f.dataDir,'maintenance.enabled'),'1');assert.equal((await m.result('/api/admin/monitoring',null,{})).availability.status.mode,'maintenance');
  await m.remember('/api/admin/players',{secret:'must not persist'});await m.close();assert.ok(!fs.readFileSync(m.file,'utf8').includes('must not persist'));
});
test('oversized cache rejected and disk inactivity creates a gap instead of an invented continuous rate',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.directory,'overview-cache.json'),' '.repeat(1024*1024+1));const m=f.make();
  let view=await m.result('/api/admin/monitoring',null,{});assert.equal(view.logError,'MONITOR_IO_ERROR');assert.equal(view.independent.series.at(-1).disk,null);
  f.advance(5000);view=await m.result('/api/admin/monitoring',null,{});assert.ok(view.independent.series.at(-1).disk);
  f.advance(30000);view=await m.result('/api/admin/monitoring',null,{});assert.equal(view.independent.series.at(-1).disk,null);
  f.advance(3600001);view=await m.result('/api/admin/monitoring',null,{});assert.equal(view.independent.series.length,1);
});
