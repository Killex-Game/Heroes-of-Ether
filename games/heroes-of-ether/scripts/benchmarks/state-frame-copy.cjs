/* Main-thread preparation only; excludes OS socket writes and worker allocation. */
"use strict";
const fs=require('node:fs'), path=require('node:path'), Module=require('node:module');
const {performance}=require('node:perf_hooks');
const {Sender}=require('ws');
const file=require.resolve('../../src/server/arena/socket-frames');
const old=new Module(file,module); old.filename=file; old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(path.join(process.argv[2],'socket-frames.js'),'utf8'),file);
const current=require(file);
for(const size of [2048,16000,40000]) {
  const samples=[[],[]]; let check=0;
  for(let round=0;round<16;round++) for(const before of round%2 ? [false,true]:[true,false]) {
    const bytes=Buffer.alloc((size+10)*35,91), io={write(buffer){check+=buffer[0];return true;}};
    const ws={_isServer:true,_socket:io,_sender:new Sender(io)};
    (before?old.exports:current).coalesceServerFrames(ws,'win32');
    const start=performance.now();
    for(let batch=0;batch<150;batch++) for(let i=0;i<35;i++) {
      const offset=i*(size+10)+10;
      const payload=before ? bytes.subarray(offset,offset+size) : current.stateFramePayload(bytes,offset,size,10);
      ws._sender.sendFrame(Sender.frame(payload,{fin:true,opcode:2,mask:false,readOnly:true}));
    }
    if(round>3) samples[before?0:1].push(performance.now()-start);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[a.length>>1];
  console.log(JSON.stringify({size,frames:5250,beforeMs:median(samples[0]),afterMs:median(samples[1]),speedup:median(samples[0])/median(samples[1]),check}));
}
