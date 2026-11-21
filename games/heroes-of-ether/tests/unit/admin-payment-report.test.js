"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const {PaymentReport,category}=require("../../src/server/admin/payment-report");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),journal=require("../../src/server/profiles/transaction-history");
const NOW=Date.UTC(2026,10,14,12),DAY=86400000;
const entry=(id,productId,votes,at=NOW,extra={})=>({id,at,label:"Тестовая покупка: "+productId,requestId:"request-"+id,payment:{provider:"mock",simulated:true,status:"confirmed",productId,votes,...extra}});
test("payment reports separate simulations, classify products, use stored prices and exclusive time boundaries",async()=>{
 const p={id:"a",name:"Арден",transactions:{startedAt:NOW-DAY,entries:[entry("1","coins:handful",7),entry("2","account:vip",20),entry("3","account:lite",50),entry("4","event:manya-coupon",50),entry("5","promotion:century:100",40),entry("6","crystals:moon",5),entry("7","bucks:stash",5),entry("8","future",3),entry("ignored","coins:handful",999,NOW,{provider:"unverified",simulated:false}),entry("end","coins:handful",1,NOW+1)]}};
 const store={data:{profiles:{a:p}}},report=new PaymentReport(store,()=>NOW),args={from:NOW-1,to:NOW+1,mode:"test"};
 const real=await report.read({...args,mode:"real"});assert.equal(real.summary.votes,0);assert.equal(real.summary.netProfit,null);assert.equal(real.realPaymentsAvailable,false);
 const r=await report.read(args);assert.equal(r.summary.votes,180);assert.equal(r.total,8);assert.equal(r.summary.buyers,1);assert.ok(r.categories.every(c=>c.count===1));assert.equal(r.series[0].votes,180);
 assert.equal((await report.read({...args,category:"coins",q:"АРДЕН"})).summary.votes,7);assert.equal((await report.read({...args,q:"missing"})).total,0);
 assert.equal(category("promotion:starter"),"promotions");assert.equal(category("account:premium"),"statuses");
 for(const bad of [{from:NOW,to:NOW},{from:0,to:NOW},{mode:"all"},{offset:9999},{category:"__proto__"},{q:"x".repeat(65)},{page:1.1}])await assert.rejects(report.read({...args,...bad}),/Проверь/);
 assert.deepEqual(store.data.profiles.a,p);
});
test("payment report cache tracks append, rewritten history, player names, page boundaries and deletion",async()=>{
 const entries=Array.from({length:65},(_,i)=>entry(String(i).padStart(3,"0"),"coins:handful",1,NOW-i));
 const p={id:"a",name:"Первый",transactions:{startedAt:NOW-100,entries}},store={data:{profiles:{a:p}}},service=new PaymentReport(store,()=>NOW);
 const args={mode:"test",from:NOW-100,to:NOW+1};
 const first=await service.read(args),next=await service.read({...args,page:2});assert.equal(first.pages,7);assert.equal(first.entries.length,10);assert.equal(first.entries[0].id,"000");assert.equal(next.entries[0].id,"010");assert.equal((await service.read({...args,page:7})).entries.length,5);
 p.transactions={...p.transactions,entries:[...entries,entry("new","coins:handful",3)]};p.name="Новое имя";
 assert.equal((await service.read(args)).summary.votes,68);assert.ok((await service.read(args)).entries.every(e=>e.playerName==="Новое имя"));
 p.transactions.entries=[entry("replacement","coins:handful",8)];assert.equal((await service.read(args)).summary.votes,8);
 delete store.data.profiles.a;assert.equal((await service.read(args)).total,0);assert.equal(service.cache.size,0);
});
test("large reporting yields to the arena loop and guards concurrent scans",async()=>{
 const store={data:{profiles:{a:{id:"a",name:"Игрок",transactions:{startedAt:NOW-1,entries:Array.from({length:6000},(_,i)=>entry(String(i),"coins:handful",1))}}}}};
 const service=new PaymentReport(store,()=>NOW),run=service.read({mode:"test"});let turns=0;const timer=setInterval(()=>turns++,1);
 await assert.rejects(service.read({mode:"test"}),e=>e.status===429||e.statusCode===429);
 const r=await run;clearInterval(timer);assert.equal(r.total,6000);assert.ok(turns>0);assert.equal(service.running,false);
});
test("coupon with unchanged wallet is journaled once; currency capture remains once; rejected write rolls back",async()=>{
 const f=require("../helpers/black-friday-fixture")(),input={productId:"event:manya-coupon",confirmed:true,eventId:f.run.id,requestId:randomUUID()};
 const before=structuredClone(f.p()),save=f.store.save;f.store.save=()=>{throw Error("disk failure");};
 assert.throws(()=>f.store.confirmMockPurchase(f.user.token,input),/disk failure/);assert.deepEqual(f.p(),before);f.store.save=save;
 f.store.confirmMockPurchase(f.user.token,input);f.store.confirmMockPurchase(f.user.token,input);
 assert.deepEqual(f.p().wallet,before.wallet);assert.equal(f.p().transactions.entries.filter(e=>e.requestId===input.requestId).length,1);journal.validate(f.p());
 const store=new ProfileStore(),auth=store.open(),request={productId:"coins:handful",confirmed:true,requestId:randomUUID()};
 store.confirmMockPurchase(auth.token,request);store.confirmMockPurchase(auth.token,request);
 assert.equal(store.find(auth.token).transactions.entries.filter(e=>e.requestId===request.requestId&&e.payment).length,1);journal.validate(store.find(auth.token));
 const r=await new PaymentReport(f.store,f.now).read({mode:"test"});assert.equal(r.summary.votes,50);
});
