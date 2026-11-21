"use strict";
const http = require('node:http'), { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');
const { BoosterError } = require('../boosters/booster-catalog');
const HEADER = 'x-killex-control';
const loopback = address => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
function sign(key, scope, method, url, value, now = Date.now()) {
  const text = Buffer.from(JSON.stringify({ scope, method, url, at: now, nonce: randomUUID(), value })).toString('base64url');
  return text + '.' + createHmac('sha256', key).update(text).digest('hex');
}
class Verifier {
  constructor(key, now = Date.now) { this.key = key; this.now = now; this.seen = new Map(); }
  read(req, scope) {
    const raw = req.headers[HEADER];
    if (!loopback(req.socket.remoteAddress) || typeof raw !== 'string' || raw.length > 16000) throw new BoosterError('Закрытый канал управления.',403);
    const [text, signature, extra] = raw.split('.'), expected = createHmac('sha256',this.key).update(text).digest();
    if (extra || !/^[a-f0-9]{64}$/.test(signature || '') || !timingSafeEqual(expected,Buffer.from(signature,'hex')))
      throw new BoosterError('Недействительная подпись управления.',403);
    let payload;try{payload=JSON.parse(Buffer.from(text,'base64url').toString());}catch{throw new BoosterError('Недействительный запрос управления.',403);}
    const at=this.now();for(const [id,time] of this.seen)if(time<at-10000)this.seen.delete(id);
    if (payload.scope!==scope || payload.method!==req.method || payload.url!==req.url || !Number.isSafeInteger(payload.at) ||
        payload.at>at+1000 || payload.at<at-10000 || typeof payload.nonce!=='string' || this.seen.has(payload.nonce))
      throw new BoosterError('Запрос управления устарел или повторён.',403);
    if(this.seen.size>=20000)throw new BoosterError('Канал управления перегружен.',503);
    this.seen.set(payload.nonce,payload.at);return payload;
  }
}
function request(base, url, { method='GET', headers={}, body, timeout=10000, maxBytes=20*1024*1024 } = {}) {
  const target=new URL(base);if(target.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(target.hostname))throw Error('Control upstream must be loopback');
  return new Promise((resolve,reject)=>{
    const raw=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
    const req=http.request({hostname:target.hostname,port:target.port,path:url,method,headers:{...headers,...(raw?{'content-length':raw.length}:{})}},res=>{
      const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)res.destroy(Error('Control response too large'));else chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    req.setTimeout(timeout,()=>req.destroy(Object.assign(Error('Control request timeout'),{code:'ETIMEDOUT'})));req.on('error',reject);req.end(raw);
  });
}
async function body(req, limit=4096) {
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new BoosterError('Слишком большой запрос.',413);chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new BoosterError('Нужен JSON-запрос.',400);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new BoosterError('Нужен JSON-объект.',400);return value;
}
function forwardHeaders(headers) {
  const result={};for(const key of ['host','cookie','origin','content-type','x-owner-csrf','x-forwarded-proto','x-real-ip'])if(headers[key])result[key]=headers[key];return result;
}
module.exports={HEADER,loopback,sign,Verifier,request,body,forwardHeaders};
