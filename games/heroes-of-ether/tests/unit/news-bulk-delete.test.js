"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store'),{OwnerAccess}=require('../../src/server/admin/owner-access');
const actions=require('../../src/server/admin/content-actions'),bulk=require('../../src/server/admin/news-bulk-delete'),trash=require('../../src/server/admin/content-trash'),news=require('../../src/server/profiles/game-news');
function fixture(t){
 let store;t.after(()=>store?.close());
 const filePath=path.join(temporary(t,'news-bulk'),'profiles.json'),now=()=>Date.UTC(2026,10,15,12);
 store=new ProfileStore({filePath,journal:true,now});
 const owner=store.open(),other=store.open(),access=new OwnerAccess({ownerId:owner.profile.id});
 for(let i=0;i<3;i++)actions.apply(store,access,store.find(owner.token),'gameNews',{requestId:randomUUID(),revision:store.data.gameNews?.revision||0,reason:'Создание новости',title:'Новость '+i,body:'Полный текст '+i,date:'2026-11-15',category:'news',visible:true},news.normalize);
 const actor=store.find(owner.token),input={action:'delete-many',ids:store.data.gameNews.items.slice(0,2).map(n=>n.id),revision:3,reason:'Убрать две новости',confirmed:true,requestId:randomUUID()};
 return{store,access,actor,input,other,filePath,now};
}
test('bulk news moves all selected items to trash atomically, replays and restores independently',t=>{
 const f=fixture(t),before=structuredClone(f.store.data),save=f.store.save.bind(f.store);let writes=0;f.store.save=(...args)=>{writes++;return save(...args);};
 bulk.remove(f.store,f.access,f.actor,f.input);assert.equal(writes,1);assert.equal(f.store.data.gameNews.items.length,1);assert.equal(trash.view(f.store).total,2);
 assert.deepEqual(f.store.data.profiles,before.profiles);
 const recovered=new ProfileStore({filePath:f.filePath,now:f.now});assert.equal(bulk.remove(recovered,f.access,f.actor,f.input).replay,true);assert.equal(trash.view(recovered).total,2);
 const row=trash.view(recovered).items[0];trash.restore(recovered,f.access,f.actor,{trashId:row.id,revision:row.revision,reason:'Вернуть новость',confirmed:true,requestId:randomUUID()});
 assert.equal(trash.view(recovered).total,1);assert.equal(recovered.data.gameNews.items.length,2);
 assert.throws(()=>bulk.remove(recovered,f.access,f.actor,{...f.input,ids:[f.input.ids[0]]}),/уже использован/);
});
test('stale, duplicate, absent or unauthorized selections cannot partially delete news',t=>{
 const f=fixture(t),before=structuredClone(f.store.data);
 for(const input of [{...f.input,revision:0},{...f.input,ids:[f.input.ids[0],f.input.ids[0]]},{...f.input,ids:[f.input.ids[0],'missing']},{...f.input,confirmed:false}])assert.throws(()=>bulk.remove(f.store,f.access,f.actor,input));
 assert.throws(()=>bulk.remove(f.store,f.access,f.store.find(f.other.token),f.input),/владелец/);assert.deepEqual(f.store.data,before);
});
test('bulk WAL fsync failure leaves all publications and receipts intact',t=>{
 const f=fixture(t),before=structuredClone(f.store.data),sync=fs.fsyncSync;
 let failed=false;const mock=t.mock.method(fs,'fsyncSync',fd=>{if(!failed){failed=true;throw Error('disk offline');}return sync(fd);});
 assert.throws(()=>bulk.remove(f.store,f.access,f.actor,f.input),/disk offline/);assert.deepEqual(f.store.data,before);mock.mock.restore();
 bulk.remove(f.store,f.access,f.actor,f.input);assert.equal(trash.view(f.store).total,2);assert.equal(fs.fsyncSync,sync);
});
test('bulk deletion includes builtin release news and keeps their full restore source',t=>{
 const f=fixture(t),source={id:'alfa-test-0.0.35',sourceId:'alfa-test-0.0.35',title:'Выпуск',body:'Изменения',date:'2026-11-15',category:'release',visible:true};
 bulk.remove(f.store,f.access,f.actor,{...f.input,ids:[f.input.ids[0],source.id]},[source]);
 assert.deepEqual(news.view(f.store).hiddenSources,[source.id]);
 const row=trash.view(f.store).items.find(n=>n.objectId===source.id);trash.restore(f.store,f.access,f.actor,{trashId:row.id,revision:row.revision,reason:'Вернуть выпуск',confirmed:true,requestId:randomUUID()});
 assert.deepEqual(news.view(f.store).hiddenSources,[]);assert.equal(f.store.data.gameNews.items.find(n=>n.id===source.id).body,source.body);
});
