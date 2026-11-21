"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events");
const {createGameServer}=require("../../src/server/game-server");
test("encoded aliases retain admin frame, referrer and script protections",async t=>{
 const app=createGameServer({autoTick:false});app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");t.after(()=>app.close());
 const origin="http://127.0.0.1:"+app.httpServer.address().port;
 for(const name of ["/admin.html","/%61dmin.html","/folder%2f..%2fadmin.html","/blocked.html","/%62locked.html"]){
   const response=await fetch(origin+name);assert.equal(response.status,200,name);
   assert.equal(response.headers.get("x-frame-options"),"DENY",name);
   assert.equal(response.headers.get("referrer-policy"),"no-referrer",name);
   assert.match(response.headers.get("content-security-policy"),/frame-ancestors 'none'/,name);
   await response.text();
 }
 assert.equal((await fetch(origin+"/%zz")).status,400);
 const unauthorized=await fetch(origin+"/api/admin/overview");assert.equal(unauthorized.status,403);
 assert.equal((await fetch(origin+"/api/service-status")).status,200);
});
