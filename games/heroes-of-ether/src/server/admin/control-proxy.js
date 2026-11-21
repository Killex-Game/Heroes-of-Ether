"use strict";
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
// Used by the private SSH/local entry only. Public game traffic continues to
// go directly from nginx to the game; the admin service is not on its hot path.
function relay(req,res,gameUrl,{publicDir,dataDir}){
  res.removeHeader('Content-Security-Policy');res.removeHeader('X-Frame-Options');
  const target=new URL(gameUrl),headers={...req.headers};delete headers['x-killex-control'];
  const upstream=http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers},reply=>{
    res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);reply.on('error',()=>res.destroy());
  });
  upstream.setTimeout(15000,()=>upstream.destroy());
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
  upstream.on('error',()=>{
    if(res.headersSent)return res.destroy();
    const planned=fs.existsSync(path.join(dataDir,'maintenance.enabled'));
    if(req.url==='/api/service-status'){
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      return res.end(JSON.stringify({maintenance:true,mode:planned?'maintenance':'unavailable',title:planned?'Техническое обновление':'Игра временно недоступна',message:planned?'Устанавливаем обновление игры.':'Попробуй вернуться немного позже.',retryAfter:5}));
    }
    if((req.url==='/'||req.url==='/index.html')&&req.method==='GET'){
      try{const html=fs.readFileSync(path.join(publicDir,'../deployment/maintenance/maintenance.html'));res.writeHead(503,{'Content-Type':'text/html; charset=utf-8','Retry-After':'5'});return res.end(html);}catch{}
    }
    res.writeHead(503,{'Content-Type':'application/json','Retry-After':'5'});res.end(JSON.stringify({error:'Игра временно недоступна.'}));
  });
  req.pipe(upstream);
}
function upgrade(req,socket,head,gameUrl){
  // The game performs its normal Origin, player-session and rate checks.
  if(req.url.startsWith('/api/admin/')||req.url.startsWith('/_control/'))return socket.destroy();
  const target=new URL(gameUrl),headers={...req.headers};delete headers['x-killex-control'];
  const upstream=http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers});
  upstream.setTimeout(10000,()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
  upstream.on('response',res=>{res.resume();socket.destroy();});
  upstream.on('upgrade',(res,remote,rest)=>{
    let response='HTTP/1.1 '+res.statusCode+' '+res.statusMessage+'\r\n';
    for(let i=0;i<res.rawHeaders.length;i+=2)response+=res.rawHeaders[i]+': '+res.rawHeaders[i+1]+'\r\n';
    socket.write(response+'\r\n');if(rest.length)socket.write(rest);if(head.length)remote.write(head);
    remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());
    socket.pipe(remote).pipe(socket);
  });upstream.end();
}
module.exports={relay,upgrade};
