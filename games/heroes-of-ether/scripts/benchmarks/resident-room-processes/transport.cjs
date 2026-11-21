"use strict";
// Experimental transport adapter for the isolated benchmark only.
const { EventEmitter } = require('node:events');
async function listen(onConnection) {
  if (process.env.ROOM_BENCH_TRANSPORT !== 'uws') {
    const { WebSocketServer } = require('ws');
    const server = new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:1024,perMessageDeflate:false});
    server.on('connection', onConnection);
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    return server;
  }
  const uWS = require(process.env.ROOM_BENCH_UWS_MODULE || 'uWebSockets.js');
  const clients = new Set();
  let listenSocket;
  class Peer extends EventEmitter {
    constructor(native, protocol) { super(); this.native=native;this.protocol=protocol;this.readyState=1; }
    get bufferedAmount() { return this.readyState===1 ? this.native.getBufferedAmount() : 0; }
    send(data, options, callback) {
      if(this.readyState!==1){callback?.(Error('Socket closed'));return;}
      // 0 is accepted with backpressure; only 2 means a dropped message.
      const status=this.native.send(data,Boolean(options?.binary),false);
      if(status===2)callback?.(Error('Transport backpressure drop'));
      else callback?.();
    }
    close(code=1000, reason='') { if(this.readyState===1)this.native.end(code,reason); }
    terminate() { if(this.readyState===1)this.native.close(); }
  }
  const app=uWS.App().ws('/*',{
    compression:uWS.DISABLED,maxPayloadLength:1024,maxBackpressure:4*1024*1024,
    closeOnBackpressureLimit:true,idleTimeout:0,sendPingsAutomatically:false,
    upgrade(res,req,context) {
      const url=req.getUrl()+(req.getQuery()?'?'+req.getQuery():''),
        protocol=req.getHeader('sec-websocket-protocol').split(',')[0].trim();
      res.upgrade({url,protocol},req.getHeader('sec-websocket-key'),protocol,'',context);
    },
    open(ws) { const data=ws.getUserData(),peer=new Peer(ws,data.protocol);data.peer=peer;clients.add(peer);onConnection(peer,{url:data.url}); },
    message(ws,bytes) { ws.getUserData().peer.emit('message',Buffer.from(bytes)); },
    close(ws,code,reason) {
      const peer=ws.getUserData().peer;peer.readyState=3;peer.native=null;clients.delete(peer);
      peer.emit('close',code,Buffer.from(reason));
    }
  });
  await new Promise((resolve,reject)=>app.listen('127.0.0.1',0,socket=>{
    if(!socket){reject(Error('uWS listen failed'));return;}listenSocket=socket;resolve();
  }));
  const port=uWS.us_socket_local_port(listenSocket);
  return {clients,address:()=>({port}),close(callback){
    uWS.us_listen_socket_close(listenSocket);for(const peer of [...clients])peer.close();callback();
  }};
}
module.exports={listen};
