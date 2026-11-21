"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {temporary}=require('../temp'),config=require('../../config/promotions.json');
const catalog=require('../../public/shared/weekend-promotion-catalog'),products=require('../../public/shared/virtual-product-catalog');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
const START=Date.parse('2026-11-20T12:00:00+03:00'),WEEK=7*86400000;
const order=productId=>({productId,confirmed:true,requestId:randomUUID()});
function fixture(t){let at=START;const filePath=path.join(temporary(t,'weekend-purchase'),'profiles.json');
 const store=new ProfileStore({filePath,now:()=>at,promotionConfig:config}),auth=store.open();
 return {store,token:auth.token,filePath,now:()=>at,set:v=>{at=v;store.open(auth.token);},p:()=>store.find(auth.token)};}
test('26 пятничных акций: точные составы и цены из каталога, атомарная запись и восстановление',t=>{
 const f=fixture(t);f.store.activateAccount(f.token,{kind:'vip',requestId:randomUUID()});f.store.activateAccount(f.token,{kind:'premium',requestId:randomUUID()});
 for(let i=0;i<26;i++){
  f.set(START+i*WEEK);const base=catalog.products[i],view=f.store.view(f.p()),id=base.id+':2026-11-20:'+i;
  assert.deepEqual(view.promotions,[id]);assert.equal(view.promotionEndsAt[id],f.now()+60*3600000);
  const before=structuredClone(f.p()),input={...order(id),votes:0,exactBoosters:{fire:999999},wallet:{coins:999999}};
  const result=f.store.confirmMockPurchase(f.token,input),after=f.p();assert.equal(result.payment.votes,base.votes);
  for(const k of ['coins','crystals','bucks'])assert.equal(after.wallet[k]-before.wallet[k],base.wallet[k]||0);
  for(const booster of BOOSTERS.keys())assert.equal((after.inventory[booster]||0)-(before.inventory[booster]||0),base.exactBoosters[booster]||0,base.name+':'+booster);
  assert.equal(after.account.vipUntil,before.account.vipUntil);assert.equal(after.account.premiumUntil,before.account.premiumUntil);
  const receipt=after.transactions.entries.find(e=>e.requestId===input.requestId);assert.equal(receipt.payment.votes,base.votes);assert.equal(receipt.payment.productId,id);assert.equal(receipt.payment.simulated,true);
  assert.equal(f.store.confirmMockPurchase(f.token,input).replay,true);
  assert.throws(()=>f.store.confirmMockPurchase(f.token,order(id)),/уже куплен/);
  assert.deepEqual(f.store.view(f.p()).promotions,[]);
  const restored=new ProfileStore({filePath:f.filePath,now:f.now,promotionConfig:config});assert.deepEqual(restored.find(f.token),f.p());assert.equal(restored.confirmMockPurchase(f.token,input).replay,true);
 }
 const arsenal=catalog.products[22];assert.equal(arsenal.votes,30);
 assert.deepEqual(arsenal.exactBoosters,Object.fromEntries([...BOOSTERS.values()].filter(b=>b.tier==='clan').map(b=>[b.id,200])));
});
test('Новая неделя и повтор круга не повторяют старую квитанцию и не открывают старый заказ',t=>{
 const f=fixture(t),id=catalog.products[0].id+':2026-11-20:0',input=order(id);
 f.store.confirmMockPurchase(f.token,input);f.set(START+26*WEEK);
 const next=catalog.products[0].id+':2026-11-20:26',before=structuredClone(f.p());assert.deepEqual(f.store.view(f.p()).promotions,[next]);
 assert.equal(f.store.confirmMockPurchase(f.token,input).replay,true);assert.deepEqual(f.p(),before);
 assert.throws(()=>f.store.confirmMockPurchase(f.token,order(id)),/недоступна/);
 f.store.confirmMockPurchase(f.token,order(next));assert.equal(f.p().wallet.coins-before.wallet.coins,1500);
 assert.equal(Object.values(f.p().receipts).filter(s=>s.includes('promotion:weekend:01')).length,2);
});
test('Сервер закрывает покупки вне выходных, неверную дату/позицию и базовый preview ID',t=>{
 const f=fixture(t),base=catalog.products[0].id,id=base+':2026-11-20:0',before=structuredClone(f.p());
 for(const at of [START-1,START+60*3600000,START+WEEK-1]){f.set(at);assert.throws(()=>f.store.confirmMockPurchase(f.token,order(id)),/недоступна/);}
 f.set(START);for(const bad of [base,base+':2026-11-27:0',catalog.products[1].id+':2026-11-20:0'])assert.throws(()=>f.store.confirmMockPurchase(f.token,order(bad)),/недоступна/);
 for(const bad of [base+':2026-11-20:00',base+':2026-11-21:0',base+':2026-02-30:0',base+':2026-11-20:9007199254740991'])assert.equal(products.get(bad),undefined);
 for(const key of ['wallet','inventory','receipts'])assert.deepEqual(f.p()[key],before[key]);f.set(START+60*3600000-1);f.store.confirmMockPurchase(f.token,order(id));
});
test('Отказ сохранения и переполнение не оставляют часть Арсенала и не расходуют покупку',t=>{
 const f=fixture(t);f.set(START+22*WEEK);const id=catalog.products[22].id+':2026-11-20:22',input=order(id),before=structuredClone(f.p()),save=f.store.save;
 f.store.save=()=>{throw Error('disk failed');};assert.throws(()=>f.store.confirmMockPurchase(f.token,input),/disk failed/);assert.deepEqual(f.p(),before);f.store.save=save;
 f.p().inventory.fire_sword=Number.MAX_SAFE_INTEGER;const overflow=structuredClone(f.p());assert.throws(()=>f.store.confirmMockPurchase(f.token,input),/баланс/);assert.deepEqual(f.p(),overflow);
 f.p().inventory.fire_sword=0;f.store.confirmMockPurchase(f.token,input);for(const id of Object.keys(catalog.products[22].exactBoosters))assert.equal(f.p().inventory[id],200);
});
test('Новичковые, уровневая и пятничная акции доступны независимо при совпадении сроков',t=>{
 const f=fixture(t);f.store.setPersonal(f.token,{name:'Пересечение',expectedName:f.p().name,gender:'unspecified',requestId:randomUUID()});
 f.p().level=100;f.p().progress.levelOffers={100:START};const weekly=catalog.products[0].id+':2026-11-20:0';
 assert.deepEqual(new Set(f.store.view(f.p()).promotions),new Set(['promotion:starter','promotion:advanced','promotion:century:100',weekly]));
 f.store.confirmMockPurchase(f.token,order(weekly));assert.deepEqual(new Set(f.store.view(f.p()).promotions),new Set(['promotion:starter','promotion:advanced','promotion:century:100']));
 f.store.confirmMockPurchase(f.token,order('promotion:starter'));assert.deepEqual(new Set(f.store.view(f.p()).promotions),new Set(['promotion:advanced','promotion:century:100']));
});
test('Просмотр акции долговечен, идемпотентен и не считается покупкой; новый круг требует новый показ',t=>{
 const f=fixture(t),id=catalog.products[0].id+':2026-11-20:0',input={ids:[id],requestId:randomUUID()},before=structuredClone(f.p());
 const save=f.store.save;f.store.save=()=>{throw Error('disk failed');};assert.throws(()=>f.store.acknowledgePromotions(f.token,input),/disk failed/);assert.deepEqual(f.p(),before);f.store.save=save;
 f.store.acknowledgePromotions(f.token,input);assert.deepEqual(f.store.view(f.p()).seenPromotionIds,[id]);assert.deepEqual(f.store.view(f.p()).promotions,[id]);assert.deepEqual(f.p().wallet,before.wallet);
 assert.equal(f.store.acknowledgePromotions(f.token,input).replay,true);
 const restored=new ProfileStore({filePath:f.filePath,now:f.now,promotionConfig:config});assert.deepEqual(restored.view(restored.find(f.token)).seenPromotionIds,[id]);
 f.set(START+26*WEEK);assert.equal(f.store.view(f.p()).seenPromotionIds.includes(catalog.products[0].id+':2026-11-20:26'),false);
 for(const ids of [[],[id],[catalog.products[0].id],[{},null]])assert.throws(()=>f.store.acknowledgePromotions(f.token,{ids,requestId:randomUUID()}));
});
test('WAL: покупка и просмотр переживают завершение процесса после ACK без контрольной точки',async t=>{
 const {spawnSync}=require('node:child_process'),filePath=path.join(temporary(t,'weekend-wal'),'profiles.json');
 const child=spawnSync(process.execPath,['-e',`
  const {ProfileStore}=require('./src/server/profiles/profile-store'),config=require('./config/promotions.json');
  const store=new ProfileStore({filePath:process.argv[1],journal:true,now:()=>${START+22*WEEK},promotionConfig:config});
  const {token}=store.open(),productId='promotion:weekend:23:2026-11-20:22';
  const notice={ids:[productId],requestId:'notice-weekend-wal'},order={productId,confirmed:true,requestId:'purchase-weekend-wal'};
  store.acknowledgePromotions(token,notice);store.confirmMockPurchase(token,order);
  process.stdout.write(JSON.stringify({token,p:store.find(token),order,notice}));process.exit(0);
 `,filePath],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);const saved=JSON.parse(child.stdout);
 const store=new ProfileStore({filePath,journal:true,now:()=>START+22*WEEK,promotionConfig:config});
 try{assert.deepEqual(store.find(saved.token),saved.p);assert.equal(store.confirmMockPurchase(saved.token,saved.order).replay,true);assert.equal(store.acknowledgePromotions(saved.token,saved.notice).replay,true);assert.deepEqual(store.find(saved.token).seenPromotionIds,saved.notice.ids);}finally{await store.close();}
});
