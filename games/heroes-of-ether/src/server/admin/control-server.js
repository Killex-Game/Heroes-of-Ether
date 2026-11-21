"use strict";
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const transport=require('./control-transport'),{ContentOutbox,atomic}=require('./control-content');
const {BoosterError}=require('../boosters/booster-catalog');
const {serveStatic}=require('../http/static-file-server');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
function createControlServer({access,gameUrl,directory,key,publicDir,mediaDirectory,now=Date.now}){
  publicDir=path.resolve(publicDir);
  const outbox=new ContentOutbox({file:path.join(directory,'editor-outbox.json'),access,now});
  const verifier=new transport.Verifier(key,now),media=new(require('./news-media').NewsMedia)(mediaDirectory);
  const feedback=new(require('./feedback-store').FeedbackStore)({file:path.join(directory,'feedback.wal'),now});
  const limits=new(require('../http/request-rate-limits').RequestLimits)({now});
  let gameReady=false,lastCheck=0,lastError=null,flushing=null,closed=false,lastAudit;
  const monitoring=new(require('./control-monitoring').ControlMonitoring)({directory,dataDir:path.dirname(mediaDirectory),now});
  const monitorRoutes=require('./control-monitoring').routes;
  const sockets=new Set();let priming=null;
  function exportAudit(){const rows=access.security.audit();if(rows!==lastAudit){atomic(path.join(directory,'security-audit.json'),rows);lastAudit=rows;}}
  function actor(req){access.guardTransport(req);access.authorize(req);return access.principal(req);}
  function headers(req,who,body,extra={}){
    const result=transport.forwardHeaders(req.headers);
    result[transport.HEADER]=transport.sign(key,'game',req.method,req.url,{actor:who,...(body!==undefined?{bodyHash:hash(body)}:{}),...extra},now());return result;
  }
  async function game(req,who,body,extra={}){
    const monitor=req.method==='GET'&&monitorRoutes.has(new URL(req.url,gameUrl).pathname);
    try{const result=await transport.request(gameUrl,req.url,{method:req.method,headers:headers(req,who,body,extra),body,timeout:monitor?1500:9000,...(monitor?{maxBytes:1024*1024}:{})});
      gameReady=result.status!==502&&result.status!==503;lastCheck=now();lastError=gameReady?null:'Игровой сервер запускается или обновляется.';return result;
    }catch(error){gameReady=false;lastCheck=now();lastError='Игровой сервер запускается или обновляется.';throw error;}
  }
  const systemReq=(url,method='GET')=>({url,method,headers:{host:new URL(gameUrl).host,...(method==='POST'?{origin:gameUrl,'content-type':'application/json'}:{})}});
  const editorActor={id:access.ownerId,role:'owner',login:'owner',name:'Killex'};
  async function snapshot(){
    const result=await game(systemReq('/api/admin/control/snapshot'),editorActor,undefined,{editor:true});
    if(result.status!==200)throw new BoosterError('Редакция ждёт запуска игрового сервера.',503);
    return JSON.parse(result.body.toString());
  }
  async function flush(){
    if(flushing)return flushing;
    // Deployment verifies the unmodified saved world before releasing edits
    // accepted by the independent editor during that verification.
    if(fs.existsSync(path.join(directory,'deployment.hold')))return;
    if(!outbox.state?.commands.length||outbox.state.error)return;
    flushing=(async()=>{
      try{
        // Readiness before sealing keeps ordinary offline editing available.
        await snapshot();
        const bundle=outbox.bundle(),result=await game(systemReq('/api/admin/control/apply','POST'),editorActor,bundle,{editor:true});
        const value=JSON.parse(result.body.toString());
        if(result.status===200)outbox.complete(value.snapshot);
        else if(result.status===409||result.status===400)outbox.conflict(value.error||'Конфликт редакции.');
      }catch(error){lastError=error instanceof BoosterError?error.message:'Редакция ждёт запуска игрового сервера.';}
      finally{flushing=null;}
    })();return flushing;
  }
  async function freshContent(){
    if(outbox.state?.commands.length){await flush();return;}
    try{outbox.refresh(await snapshot());}catch(error){if(!outbox.state)throw new BoosterError('Данные редакции появятся после запуска игры.',503);}
  }
  async function prime(){
    if(priming||outbox.state||closed)return;
    priming=freshContent().catch(()=>{}).finally(()=>{priming=null;});return priming;
  }
  function status(){return{gameReady,lastCheck,message:lastError,editor:outbox.status()};}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/_control/')){
        const proof=verifier.read(req,'control'),value=await transport.body(req,url.pathname==='/_control/feedback'?6000:4096);
        if(req.method!=='POST'||proof.value?.bodyHash!==hash(value))throw new BoosterError('Закрытый запрос управления.',403);
        if(url.pathname==='/_control/feedback')return json(res,200,await feedback.submit(value.player,value.input));
        const original={headers:value.headers,method:value.method,url:value.url,socket:{remoteAddress:'127.0.0.1'}};
        const who=actor(original);access.allowRoute(original,new URL(original.url,'http://localhost').pathname);
        if(url.pathname==='/_control/password')await access.confirmPassword(value.password,original,who);
        else if(url.pathname!=='/_control/authorize')return json(res,404,{error:'Нет такого канала.'});
        return json(res,200,{ok:true});
      }
      if(url.pathname==='/admin.htm'){res.writeHead(302,{Location:'/admin.html'});return res.end();}
      if(url.pathname.startsWith('/news-media/'))return await media.serve(req,res,url.pathname);
      if(url.pathname==='/admin.html'||/^\/(ui\/admin|styles|shared|assets)\//.test(url.pathname))return await serveStatic(req,res,fs.realpathSync(publicDir));
      if(!url.pathname.startsWith('/api/admin/'))return require('./control-proxy').relay(req,res,gameUrl,{publicDir,dataDir:path.dirname(mediaDirectory)});
      if(url.pathname.startsWith('/api/admin/control/'))return json(res,404,{error:'Операция недоступна.'});
      access.guardTransport(req);
      const bucket=limits.take(req.socket.remoteAddress,'api');if(!bucket.allowed || (req.method==='POST' && !limits.take(req.socket.remoteAddress,'mutation').allowed))throw new BoosterError('Слишком много запросов.',429);
      if(url.pathname==='/api/admin/auth/status'&&req.method==='GET')return json(res,200,{...access.status(req),ownerName:'Killex',...(access.principal(req)?.role==='owner'?{control:status()}:{})});
      if(['/api/admin/auth/login','/api/admin/auth/verify'].includes(url.pathname)&&req.method==='POST'){
        const value=await transport.body(req),result=url.pathname.endsWith('/login')?await access.security.login(value,req,res):await access.security.verify(value,req,res);exportAudit();return json(res,200,result);
      }
      // Private recovery remains password + fresh 2FA, and is never exposed by
      // the public nginx routes. Only the game writer rotates the game token.
      if(url.pathname==='/api/admin/recover-profile'){
        access.guardRecovery(req);
        if(req.method==='GET')return json(res,200,{available:true});
        if(req.method!=='POST')return json(res,405,{error:'Метод недоступен.'});
        const value=await transport.body(req);await access.verifyRecoveryPassword(value.password,req,value.code);exportAudit();
        const result=await game(req,editorActor,value,{recovery:true});if(result.status===200)access.session=null;
        if(result.headers['set-cookie'])res.setHeader('Set-Cookie',result.headers['set-cookie']);res.writeHead(result.status,{'Content-Type':'application/json'});return res.end(result.body);
      }
      const who=actor(req);access.allowRoute(req,url.pathname);
      if(url.pathname==='/api/admin/feedback'){
        if(req.method==='GET')return json(res,200,url.searchParams.has('number')?feedback.detail(url.searchParams.get('number')):feedback.list(Object.fromEntries(url.searchParams)));
        if(req.method==='POST'){
          const value=await transport.body(req);actor(req);
          const account=access.security.account(who.id);
          const result=await feedback.update({...who,name:account?.name||who.login},value,()=>actor(req));actor(req);return json(res,200,result);
        }
        return json(res,405,{error:'Метод недоступен.'});
      }
      if(url.pathname==='/api/admin/logout'&&req.method==='POST'){access.logout(res,access.guardTransport(req),req);return json(res,200,{ok:true});}
      if(url.pathname==='/api/admin/security'&&req.method==='GET')return json(res,200,access.security.view(req));
      if(url.pathname.startsWith('/api/admin/security/')&&req.method==='POST'){
        const value=await transport.body(req);actor(req);
        const result=url.pathname.endsWith('/profile')?await access.security.editSelf(value,req,res):await access.security.ownerOperation(url.pathname.slice('/api/admin/security/'.length),value,req,res);exportAudit();return json(res,200,result);
      }
      if(url.pathname==='/api/admin/moderators'){
        if(req.method==='GET')return json(res,200,{moderators:access.security.list()});
        if(req.method==='POST'){const value=await transport.body(req);actor(req);const result=await access.security.manage(value,req);exportAudit();return json(res,200,result);}
      }
      if(url.pathname==='/api/admin/control-status'&&req.method==='GET'){
        if(now()-lastCheck>4000)try{const value=await snapshot();if(!outbox.state)outbox.refresh(value);}catch{}return json(res,200,status());
      }
      if(url.pathname==='/api/admin/control-discard'&&req.method==='POST'){
        const input=await transport.body(req);actor(req);const value=await snapshot();outbox.discard(who,value,input);return json(res,200,status());
      }
      if(url.pathname==='/api/admin/news/banner'&&req.method==='POST'){
        const value=await transport.body(req,1450000);actor(req);return json(res,200,await media.upload(value.image));
      }
      if(['/api/admin/news','/api/admin/trash'].includes(url.pathname)){
        const route=url.pathname.split('/').at(-1);
        if(req.method==='GET'){await freshContent();actor(req);return json(res,200,outbox.view(route,Object.fromEntries(url.searchParams)));}
        if(req.method==='POST'){
          const value=await transport.body(req,40000);actor(req);await freshContent();actor(req);
          if(value.image?.startsWith('/news-media/')&&!(await media.exists(value.image)))throw new BoosterError('Сначала загрузи баннер.',400);
          actor(req);const result=outbox.accept(who,route,value);await flush();actor(req);
          return json(res,200,{...result,...outbox.view(route),queued:outbox.status().pending>0});
        }
      }
      const value=req.method==='POST'?await transport.body(req,16000):undefined;actor(req);
      const account=access.security.account(who.id),principal={...who,name:access.isOwner(who)?'Killex':account?.name};
      exportAudit();
      try{
        const result=await game(req,principal,value);
        if (result.status===502||result.status===503) throw new BoosterError("Игровой сервер временно недоступен.",503);
        if(req.method==='GET'&&result.status===200&&monitorRoutes.has(url.pathname)){
          const view=await monitoring.result(url.pathname,JSON.parse(result.body.toString()),status());actor(req);return json(res,200,view);
        }
        res.writeHead(result.status,{'Content-Type':'application/json'});return res.end(result.body);
      }catch(error){
        actor(req);
        if(req.method==='GET'&&monitorRoutes.has(url.pathname)){const view=await monitoring.result(url.pathname,null,status());actor(req);return json(res,200,view);}
        throw new BoosterError('Игровой сервер обновляется. Обзор, новости и корзина доступны в админке.',503);
      }
    }catch(error){if(!res.headersSent)json(res,error.status||503,{error:error.status?error.message:'Сервис управления временно недоступен.'});else res.destroy();}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.on('listening',()=>prime());
  server.on('upgrade',(req,socket,head)=>require('./control-proxy').upgrade(req,socket,head,gameUrl));
  const timer=setInterval(()=>{if(!closed){if(outbox.state?.commands.length)flush();else if(!outbox.state)prime();}},5000);timer.unref();
  return{server,outbox,feedback,status,flush,close:async()=>{closed=true;clearInterval(timer);await Promise.allSettled([flushing,priming]);server.closeIdleConnections();await new Promise(r=>{const stop=setTimeout(()=>{for(const socket of sockets)socket.destroy();},1000);server.close(()=>{clearTimeout(stop);r();});});await feedback.close();await monitoring.close();}};
}
module.exports={createControlServer};
