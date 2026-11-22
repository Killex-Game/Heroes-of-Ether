"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path");
const {references}=require("../../scripts/deployment/check-preload-lifetime.cjs");
test("a live preload remains required after ExecStart changes and even after the file is removed",()=>{
  const cwd=path.resolve("fixture"),file=path.join(cwd,"temporary-loader.cjs");
  for(const args of [["node","--require",file],["node","--require="+file],["node","-r",file],["node","-r"+file],["node","--import",file],["node","--require","./temporary-loader.cjs"]])
    assert.equal(references(file,args,cwd),true);
  assert.equal(references(file,["node","server.js"],cwd),false);
  assert.equal(references(file,["node","--require","./other.cjs"],cwd),false);
});
test("preload cleanup refuses ambiguous environment loaders without exposing environment values",()=>{
  const cwd=path.resolve("fixture"),file=path.join(cwd,"temporary-loader.cjs");
  for(const value of ['--require="path with spaces/loader.cjs"','--import=./loader.mjs','-r ./loader.cjs'])
    assert.equal(references(file,["node","server.js"],cwd,value),true);
  assert.equal(references(file,["node","server.js"],cwd,'--max-old-space-size=4096'),false);
  assert.equal(references(file,["node","--require"],cwd),true);
});

test("checkpoint retries recover after an inherited preload is restored, including a fresh worker after idle",()=>{
  const fs=require("node:fs"),os=require("node:os"),{spawnSync}=require("node:child_process");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"preload-lifetime-"));
  const preload=path.join(dir,"loader.cjs"),runner=path.join(dir,"runner.cjs");
  fs.writeFileSync(preload,"'use strict';\n");
  fs.writeFileSync(runner,`
    const fs=require('fs'),assert=require('assert/strict');
    const {ProfileJournal,recover,segments}=require(${JSON.stringify(path.resolve(__dirname,"../../src/server/profiles/profile-journal.js"))});
    const file=${JSON.stringify(path.join(dir,"profiles.json"))},preload=${JSON.stringify(preload)};
    const world=coins=>({version:13,profiles:{p:{coins,receipt:'receipt-'+coins}},clans:{}});
    (async()=>{
      const journal=new ProfileJournal(file,{intervalMs:60000,checkpointIdleMs:75});
      try{
        journal.commit(world(100));fs.unlinkSync(preload);
        await assert.rejects(journal.requestCheckpoint(),/Cannot find module/);
        assert.equal(recover(file).data.profiles.p.receipt,'receipt-100');
        fs.writeFileSync(preload,"'use strict';\\n");
        await journal.requestCheckpoint();assert.equal(journal.lastError,null);
        const first=journal.worker;
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Idle worker did not retire')),3000);first.once('exit',()=>{clearTimeout(timer);resolve();});});
        assert.equal(journal.worker,null);
        journal.commit(world(60));await journal.requestCheckpoint();
        assert(journal.worker&&journal.worker!==first);
        assert.equal(recover(file).data.profiles.p.receipt,'receipt-60');
        assert.equal(recover(file).revision,2);assert.equal(segments(file).length,0);
        console.log(JSON.stringify({reproduced:true,retried:true,newWorkerAfterIdle:true,receiptsPreserved:true}));
      }finally{await journal.close();}
    })().catch(error=>{console.error(error.message);process.exitCode=1;});
  `);
  try{
    const result=spawnSync(process.execPath,["--require",preload,runner],{encoding:"utf8",timeout:20000});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()),{reproduced:true,retried:true,newWorkerAfterIdle:true,receiptsPreserved:true});
  }finally{
    const resolved=path.resolve(dir),root=path.resolve(os.tmpdir())+path.sep;
    assert(resolved.startsWith(root)&&path.basename(resolved).startsWith("preload-lifetime-"));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
