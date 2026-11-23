"use strict";
// Offline benchmark. Input is a closed backup; every result uses a new output.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const [inputArg,outArg,mode]=process.argv.slice(2),input=path.resolve(inputArg||'.'),out=path.resolve(outArg||'.');
const digest=file=>{const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),b=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}};
if(mode){
 assert(['native','records'].includes(mode));assert.notEqual(input,out);assert(!fs.existsSync(out));
 const codec=require('../../src/server/profiles/checkpoint-json'),start=performance.now();
 const data=mode==='native'?JSON.parse(fs.readFileSync(input,'utf8')):codec.readCheckpoint(input);
 const readMs=performance.now()-start,afterRead=process.memoryUsage(),fd=fs.openSync(out,'wx',0o600),writeStart=performance.now();
 try{if(mode==='native')fs.writeFileSync(fd,JSON.stringify(data)+'\n');else codec.writeCheckpoint(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const writeMs=performance.now()-writeStart,afterWrite=process.memoryUsage(),peakRssKiB=process.resourceUsage().maxRSS;
 console.log(JSON.stringify({mode,readMs,writeMs,totalMs:readMs+writeMs,peakRssKiB,afterRead,afterWrite,sha256:digest(out),bytes:fs.statSync(out).size,profiles:Object.keys(data.profiles||{}).length,revision:data._journalRevision}));
}else{
 assert(inputArg&&outArg,'Usage: checkpoint-json.cjs CLOSED_SNAPSHOT NEW_OUTPUT_DIRECTORY');assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
 const original=digest(input),rows=[];
 for(let round=0;round<3;round++)for(const variant of round%2?['records','native']:['native','records']){
  const result=cp.execFileSync(process.execPath,[__filename,input,path.join(out,round+'-'+variant+'.json'),variant],{encoding:'utf8',maxBuffer:1024*1024,timeout:180000});
  const row={round,...JSON.parse(result)};rows.push(row);assert.equal(row.sha256,rows[0].sha256);assert.equal(row.bytes,rows[0].bytes);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({inputSha256:original,rows,allOutputBytesEqual:true},null,2));console.log(JSON.stringify(row));
 }
 assert.equal(digest(input),original);console.log(JSON.stringify({sourceUnchanged:true,allOutputBytesEqual:true}));
}
