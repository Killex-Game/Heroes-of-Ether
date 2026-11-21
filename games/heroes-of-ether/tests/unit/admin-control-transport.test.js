"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const {Verifier,sign,HEADER}=require('../../src/server/admin/control-transport');
const {ControlAccess}=require('../../src/server/admin/control-access');
test('control signatures bind the endpoint, method, scope, time and a single loopback request',()=>{
 const key=randomBytes(32),now=100000,make=()=>({method:'GET',url:'/api/admin/players',headers:{[HEADER]:sign(key,'game','GET','/api/admin/players',{},now)},socket:{remoteAddress:'127.0.0.1'}});
 for(const mutate of [r=>r.method='POST',r=>r.url+='/other',r=>r.socket.remoteAddress='203.0.113.1',r=>r.headers[HEADER]+='x'])assert.throws(()=>{const r=make();mutate(r);new Verifier(key,()=>now).read(r,'game');},e=>e.status===403);
 assert.throws(()=>new Verifier(key,()=>now).read(make(),'control'),e=>e.status===403);
 assert.throws(()=>new Verifier(key,()=>now+10001).read(make(),'game'),e=>e.status===403);
 const verifier=new Verifier(key,()=>now),request=make();verifier.read(request,'game');assert.throws(()=>verifier.read(request,'game'),e=>e.status===403);
});
test('delegated game access rejects a body changed after the gateway authenticated it',()=>{
 const key=randomBytes(32),now=100000,access=new ControlAccess({ownerId:'owner',key,now:()=>now});
 const body={amount:1},digest=require('node:crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex');
 const req={method:'POST',url:'/api/admin/action',headers:{[HEADER]:sign(key,'game','POST','/api/admin/action',{actor:{id:'owner',role:'owner'},bodyHash:digest},now)},socket:{remoteAddress:'127.0.0.1'}};
 access.verifyBody(req,body);assert.throws(()=>access.verifyBody(req,{amount:100}),e=>e.status===403);
});
