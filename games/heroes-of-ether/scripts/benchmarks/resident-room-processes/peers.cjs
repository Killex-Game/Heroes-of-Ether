"use strict";
const WebSocket=require('ws'), wire=require('../../../public/shared/arena-wire');
const {summary}=require('./room-fixture.cjs');
const samples=require('../sample-window.cjs');
let clients=[],cpu,started,bytes=0,packets=0,intervals=samples(),failures=0,decodeMs=samples();
const decode = process.env.ROOM_BENCH_DECODE === '1';
const inputs=process.env.ROOM_BENCH_INPUTS==='socket'?new (require('./peer-inputs.cjs').PeerInputs)():null;
process.on('disconnect',()=>process.exit());
process.on('message',async m=>{
  if(m.type==='connect'){
    await Promise.all(m.urls.map(url=>new Promise((resolve,reject)=>{
      const ws=new WebSocket(url,wire.PROTOCOL,{perMessageDeflate:false});clients.push(ws);
      ws.on('error',reject);ws.once('open',resolve);let last;const client=inputs?.add(ws);
      const decoder=decode&&(!inputs||inputs.inputProjection)?new wire.Decoder():null;
      ws.on('message',raw=>{bytes+=raw.length;packets++;const at=performance.now();
        if(last)intervals.push(at-last);last=at;
        try{const begin=performance.now(),p=JSON.parse(raw);
          inputs?.receive(client,p,at);
          if(decoder&&p.stateSequence)decoder.decode(p);
          if(decoder||inputs)decodeMs.push(performance.now()-begin);
          if(p.stateSequence)ws.send(JSON.stringify({type:'stateAck',sequence:p.stateSequence}));}
        catch(error){if(failures++<2)process.stderr.write('Peer decode failed: '+error.message+'\n');}
      });
    })));
    cpu=process.cpuUsage();started=performance.now();process.send({type:'ready'});
  }else if(m.type==='startInputs'){inputs?.start();
  }else if(m.type==='stopInputs'){inputs?.stop();process.send({type:'inputsStopped'});
  }else if(m.type==='stop'){
    const used=process.cpuUsage(cpu);for(const ws of clients)ws.terminate();
    process.send({type:'report',report:{clients:clients.length,packets,bytes,failures,
      elapsed:performance.now()-started,cpuMs:(used.user+used.system)/1000,rss:process.memoryUsage().rss,
      inputs:inputs?.report(),intervalMs:summary(intervals),fullDecoder:decode||!!inputs&&!inputs.inputProjection,decodeMs:summary(decodeMs)}});process.disconnect();
  }
});
