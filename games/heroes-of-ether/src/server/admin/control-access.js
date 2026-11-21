"use strict";
const fs=require('node:fs'),path=require('node:path');
const {OwnerAccess}=require('./owner-access'),{BoosterError}=require('../boosters/booster-catalog');
const transport=require('./control-transport');
const hash=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
class ControlAccess {
  constructor({ownerId,publicOrigin,key,url,directory,now=Date.now}){
    Object.assign(this,{ownerId,publicOrigin,key,url,directory,now});this.verifier=new transport.Verifier(key,now);this.requests=new WeakMap();this.actors=new Map();
    // No AdminSecurity instance: only the permanent control service writes
    // passwords, TOTP counters, moderator versions and sessions.
    this.security={account:id=>this.actors.get(id),moderator:a=>a?.role==='moderator',audit:()=>{
      const file=path.join(this.directory,'security-audit.json'),stat=fs.statSync(file);
      if(this.auditMtime!==stat.mtimeMs){this.auditRows=JSON.parse(fs.readFileSync(file,'utf8'));this.auditMtime=stat.mtimeMs;}
      return this.auditRows;
    }};
  }
  principal(req){
    let proof=this.requests.get(req);
    if(!proof){proof=this.verifier.read(req,'game');this.requests.set(req,proof);}
    const actor=proof.value?.actor;
    if(!actor||!['owner','moderator'].includes(actor.role)||typeof actor.id!=='string'||
      (actor.role==='owner'&&actor.id!==this.ownerId))throw new BoosterError('Недействительные права управления.',403);
    if(proof.at+10000<this.now())throw new BoosterError('Запрос управления устарел. Повтори действие.',503);
    this.actors.set(actor.id,actor);return actor;
  }
  isOwner(p){return !!this.ownerId&&p?.id===this.ownerId;}
  canManagePlayers(actor){return this.isOwner(actor)||this.actors.get(actor?.id)===actor&&actor.role==='moderator';}
  guard(req,p){if(!this.isOwner(p))throw new BoosterError('Доступ владельца.',403);return this.guardTransport(req);}
  guardTransport(req){return OwnerAccess.prototype.guardTransport.call(this,req);}
  authorize(req){this.principal(req);this.guardTransport(req);}
  proof(req){this.principal(req);return this.requests.get(req).value;}
  verifyBody(req,body){if(this.proof(req).bodyHash!==hash(body))throw new BoosterError('Тело запроса управления изменилось.',403);}
  allowRoute(req,url){return OwnerAccess.prototype.allowRoute.call(this,req,url);}
  guardRecovery(req){const proof=this.requests.get(req)|| (this.principal(req),this.requests.get(req));if(!proof.value.recovery)throw new BoosterError('Закрытое восстановление.',403);}
  async verifyRecoveryPassword(password,req){this.guardRecovery(req);}
  async control(req,path,extra={}){
    this.principal(req);
    const payload={headers:transport.forwardHeaders(req.headers),method:req.method,url:req.url,...extra};
    const response=await transport.request(this.url,path,{method:'POST',headers:{'content-type':'application/json',
      [transport.HEADER]:transport.sign(this.key,'control','POST',path,{bodyHash:hash(payload)},this.now())},body:payload});
    const result=JSON.parse(response.body.toString());if(response.status!==200)throw new BoosterError(result.error||'Админка недоступна.',response.status);
    this.requests.get(req).at=this.now();return result;
  }
  refresh(req){return this.control(req,'/_control/authorize');}
  async sendFeedback(player,input){
    const url='/_control/feedback',body={player:{id:player.id,name:player.name},input};
    const result=await transport.request(this.url,url,{method:'POST',headers:{'content-type':'application/json',
      [transport.HEADER]:transport.sign(this.key,'control','POST',url,{bodyHash:hash(body)},this.now())},body,maxBytes:16000});
    const value=JSON.parse(result.body);if(result.status!==200)throw new BoosterError(value.error||'Не удалось отправить отзыв.',result.status);return value;
  }
  confirmPassword(password,req){return this.control(req,'/_control/password',{password});}
  async relay(req,res){
    try{
      const body=req.method==='POST'?await transport.body(req,1450000):undefined;
      const result=await transport.request(this.url,req.url,{method:req.method,headers:transport.forwardHeaders(req.headers),body});
      if(result.headers['set-cookie'])res.setHeader('Set-Cookie',result.headers['set-cookie']);
      res.writeHead(result.status,{'Content-Type':result.headers['content-type']||'application/json'});res.end(result.body);
    }catch(error){res.writeHead(error.status||503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.status?error.message:'Сервис управления запускается. Повтори вход.'}));}
  }
}
module.exports={ControlAccess};
