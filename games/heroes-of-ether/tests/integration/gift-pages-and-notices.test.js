"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs"),{randomUUID}=require("node:crypto"),{once}=require("node:events");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),{createGameServer}=require("../../src/server/game-server"),{temporary}=require("../temp");
const history=require("../../src/server/profiles/gift-history"),social=require("../../src/server/profiles/player-social");
function seed(store,count=10000){
  const a=store.open(),b=store.open();store.transact(a.token,randomUUID(),"fund",p=>{p.wallet.coins=100000;});
  store.transact(b.token,randomUUID(),"history",p=>{p.social={marriage:null,invitations:[],inviteReadyAt:0,gifts:[{id:"teddy",count,history:Array.from({length:count},(_,i)=>({id:randomUUID(),fromId:a.profile.id,fromName:"Даритель",at:store.now()-i,...(i%2?{anonymous:true}:{})}))}]};});
  return {a,b};
}
const gift=b=>({action:"gift",targetId:b.profile.id,giftId:"teddy",confirmed:true,requestId:randomUUID()});
test("10,000 gifts: bounded DTOs/pages, anonymous redaction and stable paging after a new gift",()=>{
  let now=Date.now();const store=new ProfileStore({now:()=>now}),{a,b}=seed(store);
  const value=store.socialState(b.token).social;
  assert.equal(value.gifts[0].count,10000);assert.equal(value.gifts[0].history.length,40);assert.equal(value.giftSummary.total,10000);
  assert.equal(value.giftSummary.groups.length,1);assert.equal(value.giftNotices.length,40);assert(Buffer.byteLength(JSON.stringify(value))<65000);
  let before=null, seen=0;const dates=new Set();
  do {const page=history.page(store.find(b.token),"teddy",before,now);assert(page.history.length<=40);
    for(const h of page.history){assert(!dates.has(h.at));dates.add(h.at);seen++;if(h.anonymous){assert.equal(h.fromId,undefined);assert.equal(h.fromName,undefined);}}
    before=page.nextBefore;if(seen===40){now++;store.socialAction(a.token,gift(b));}
  }while(before!==null);
  assert.equal(seen,10000,"New arrival does not shift or repeat older pages");
  assert.throws(()=>history.page(store.find(b.token),"teddy","NaN",now));
  assert.throws(()=>history.page(store.find(b.token),"teddy","9007199254740992",now));
  assert.equal(social.view(store,store.find(b.token)).giftSummary,undefined);
  now+=history.SHOWCASE_MS+1;assert.deepEqual(social.view(store,store.find(b.token)).gifts,[]);
  assert.equal(store.find(b.token).social.gifts[0].count,10001);
});
test("One batch acknowledgement survives WAL recovery; failed save and new arrivals remain safe",async t=>{
  const filePath=path.join(temporary(t,"gift-seen"),"profiles.json");let store=new ProfileStore({filePath,journal:true});
  try{
    const {a,b}=seed(store), summary=store.socialState(b.token).social.giftSummary;
    const ack={action:"gifts-seen",through:summary.groups.map(g=>({giftId:g.gift.id,through:g.through})),requestId:randomUUID()};
    const previous=store.data,saved=structuredClone(previous),sync=fs.fsyncSync;let failOnce=true;
    const mock=t.mock.method(fs,"fsyncSync",fd=>{if(failOnce){failOnce=false;throw Error("ack sync failed");}return sync(fd);});
    assert.throws(()=>store.socialAction(b.token,ack),/ack sync failed/);assert.strictEqual(store.data,previous);assert.deepEqual(previous,saved);mock.mock.restore();
    store.socialAction(a.token,gift(b));store.socialAction(b.token,ack);assert.equal(store.socialState(b.token).social.giftSummary.total,1);
    assert.equal(store.socialAction(b.token,ack).replay,true);assert.equal(store.find(b.token).social.gifts[0].history.length,10001);
    assert.throws(()=>store.socialAction(a.token,{...ack,requestId:randomUUID()}),/список/);
    assert.throws(()=>store.socialAction(b.token,{...ack,requestId:randomUUID(),through:[{giftId:"teddy",through:10002}]}),/список/);
    await store.close();store=new ProfileStore({filePath,journal:true});assert.equal(store.socialState(b.token).social.giftSummary.total,1);
    store.socialAction(b.token,{...ack,requestId:randomUUID(),through:[{giftId:"teddy",through:10001}]});
    await store.close();store=new ProfileStore({filePath,journal:true});assert.equal(store.socialState(b.token).social.giftSummary.total,0);assert.deepEqual(store.socialState(b.token).social.giftNotices,[]);
    assert.equal(store.find(b.token).social.gifts[0].count,10001);assert.equal(store.socialAction(b.token,ack).replay,true);
  }finally{await store.close();}
});
test("Gift pages require a lobby session and never expose private notification state",async t=>{
  const store=new ProfileStore(),{a,b}=seed(store,80),app=createGameServer({profiles:store,autoTick:false,testBots:{enabled:false}});
  app.httpServer.listen(0,"127.0.0.1");await once(app.httpServer,"listening");t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.httpServer.address().port}/api/social/gifts?playerId=${b.profile.id}&giftId=teddy`;
  assert.equal((await fetch(url)).status,401);
  const r=await fetch(url,{headers:{cookie:`sferorumiya_session=${a.token}`}});assert.equal(r.status,200);
  const body=await r.json();assert.equal(body.history.length,40);assert.equal(body.nextBefore,41);assert(!JSON.stringify(body).includes("noticeThrough"));
});
