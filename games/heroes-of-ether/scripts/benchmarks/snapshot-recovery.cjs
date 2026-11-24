"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const {recover}=require('../../src/server/profiles/profile-journal');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const {encode,decode}=require('../../src/server/persistence/postgresql-state');
const [mode,directory,sourceOrOutput,legacyFile]=process.argv.slice(2);
assert(['prepare','legacy','bytes'].includes(mode)&&directory&&sourceOrOutput);
const dir=path.resolve(directory);
if(mode==='prepare'){
  assert(!fs.existsSync(dir));fs.mkdirSync(dir,{recursive:true});
  const world=recover(path.resolve(sourceOrOutput),false).data,snapshot=new SnapshotBuilder().pack(world);
  const {docs,...manifest}=snapshot;
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
  const fd=fs.openSync(path.join(dir,'documents.ndjson'),'wx');
  try{for(const doc of docs.values()){
    const encoded=encode(doc);fs.writeSync(fd,JSON.stringify({id:encoded._id,value:encoded.value.toString('base64'),hash:encoded.hash,chunked:encoded.chunked})+'\n');
  }}finally{fs.closeSync(fd);}
  console.log(JSON.stringify({prepared:true,documents:docs.size,bytes:fs.statSync(path.join(dir,'documents.ndjson')).size}));
}else{
  assert(global.gc&&!fs.existsSync(sourceOrOutput));
  let unpack=require('../../src/server/persistence/state-snapshot').unpack;
  if(mode==='legacy'){
    assert(legacyFile);const filename=require.resolve('../../src/server/persistence/state-snapshot'),legacy=new Module(filename,module);
    legacy.filename=filename;legacy.paths=Module._nodeModulePaths(path.dirname(filename));legacy._compile(fs.readFileSync(legacyFile,'utf8'),filename);unpack=legacy.exports.unpack;
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  global.gc();const before=process.memoryUsage(),cpu=process.cpuUsage(),started=performance.now();
  const documents=fs.readFileSync(path.join(dir,'documents.ndjson'),'utf8').trim().split('\n').map(line=>{
    const row=JSON.parse(line);row.value=Buffer.from(row.value,'base64');return decode(row);
  });
  const decodedAt=performance.now(),result=unpack(documents,manifest),done=performance.now(),used=process.cpuUsage(cpu);
  assert.equal(result.snapshot.digest,manifest.digest);assert.equal(result.snapshot.worldHash,manifest.worldHash);
  const report={mode,scope:'Offline verified PostgreSQL-format decode and full snapshot recovery; identical compressed documents; no server capacity claim',
    documents:documents.length,profiles:Object.keys(result.world.profiles).length,revision:result.snapshot.revision,digest:result.snapshot.digest,worldHash:result.snapshot.worldHash,
    decodeMs:decodedAt-started,unpackMs:done-decodedAt,totalMs:done-started,cpuMs:(used.user+used.system)/1000,before,after:process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS};
  fs.writeFileSync(sourceOrOutput,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({mode,totalMs:report.totalMs,unpackMs:report.unpackMs,maxRSSMiB:report.maxRSSKiB/1024,digest:report.digest}));
}
