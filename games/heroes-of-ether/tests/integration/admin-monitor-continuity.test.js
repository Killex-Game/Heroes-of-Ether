"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events');
const {createControlServer}=require('../../src/server/admin/control-server');
test('hung game returns bounded stored monitoring, while authorization failures never expose cache',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'control-timeout-'));let mode='ok',allowed=true,release;
  const perf={capturedAt:Date.now(),arena:{rooms:3},persistence:{queuedActions:0},memoryMiB:{resident:100},tickWorkMs:{p95:2},tickIntervalMs:{p95:50},updatesHz:20};
  const upstream=http.createServer((req,res)=>{
    if(req.url!=='/api/admin/performance'){res.writeHead(503);return res.end('{}');}
    if(mode==='hang')return;
    if(mode==='deny'){res.writeHead(403);return res.end('{"error":"denied"}');}
    const send=()=>{res.writeHead(200);res.end(JSON.stringify(perf));};if(mode==='wait')release=send;else send();
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const access={ownerId:'test',guardTransport(){},authorize(){if(!allowed)throw Object.assign(Error('revoked'),{status:401});},principal:()=>({id:'test',role:'owner'}),allowRoute(){},isOwner:()=>true,security:{audit:()=>[],account:()=>({name:'Test'})}};
  const control=createControlServer({access,key:Buffer.alloc(32,1),gameUrl:'http://127.0.0.1:'+upstream.address().port,directory:dir,mediaDirectory:path.join(dir,'data','news-media'),publicDir:path.resolve(__dirname,'../../public')});
  control.server.listen(0,'127.0.0.1');await once(control.server,'listening');const url='http://127.0.0.1:'+control.server.address().port+'/api/admin/performance';
  t.after(async()=>{await control.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  assert.equal((await fetch(url)).status,200);
  mode='hang';const start=Date.now(),res=await fetch(url),data=await res.json();assert.equal(res.status,200);assert.ok(Date.now()-start<5000);assert.equal(data.stale,true);assert.equal(data.capturedAt,perf.capturedAt);assert.equal(data.control.gameReady,false);
  mode='deny';assert.equal((await fetch(url)).status,403,'upstream access denial is not replaced by old private data');
  mode='wait';const pending=fetch(url);while(!release)await new Promise(r=>setTimeout(r,5));allowed=false;release();assert.equal((await pending).status,401,'session revoked during await cannot receive cache or fresh metrics');
});
