"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const {performance}=require("node:perf_hooks");
const snapshots=require("../../src/server/profiles/profile-read-snapshot");
const {ProfileReadWindow}=require("../../src/server/profiles/profile-read-window");
const [output,countText="512"]=process.argv.slice(2),count=Number(countText);
assert(output&&Number.isInteger(count)&&count>=16&&count<=2048);
(async()=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),"heroether-pin-cost-"));
const file=path.join(root,"profiles.json"),files=[];
fs.writeFileSync(file,"{}");
for(let i=1;i<=count;i++){const source=file+".wal-"+i;fs.writeFileSync(source,"x".repeat(1024));files.push(source);}
const rows=[];
try{
  for(const mode of ["legacy","window","window","legacy"]){
    const window=mode==="window"?new ProfileReadWindow(file):null;
    const start=performance.now(),pin=window?window.pin(files,count):snapshots.pin(file,files,count);
    const initialPinMs=performance.now()-start;
    let repeatedCaptureMs=0;
    if(window){const before=performance.now();window.capture(files);repeatedCaptureMs=performance.now()-before;}
    const releaseStart=performance.now();await pin.release();window?.reset();await window?.drainCleanup();
    rows.push({mode,initialPinMs,repeatedCaptureMs,releaseMs:performance.now()-releaseStart});
  }
  const result={node:process.version,platform:process.platform,segments:count,bytes:count*1024,rows,scope:"Filesystem metadata overhead only; dummy closed files, no WAL replay, durability or whole-game performance conclusion"};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(result));
}finally{
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+"heroether-pin-cost-"));
  for(const name of fs.readdirSync(root)){
    const target=path.join(root,name);assert(fs.lstatSync(target).isFile());fs.unlinkSync(target);
  }
  fs.rmdirSync(root);
}
})().catch(error=>{console.error(error);process.exitCode=1;});
