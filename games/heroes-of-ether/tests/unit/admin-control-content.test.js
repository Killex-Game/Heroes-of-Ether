"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {temporary}=require('../temp'),{ProfileStore}=require('../../src/server/profiles/profile-store'),{OwnerAccess}=require('../../src/server/admin/owner-access');
const {snapshot,applyBundle,ContentOutbox}=require('../../src/server/admin/control-content'),news=require('../../src/server/profiles/game-news'),actions=require('../../src/server/admin/content-actions'),trash=require('../../src/server/admin/content-trash');
function fixture(t){
 const dir=temporary(t,'control-editor'),now=()=>Date.UTC(2026,10,15,12),store=new ProfileStore({filePath:path.join(dir,'profiles.json'),now}),owner=store.open(),access=new OwnerAccess({ownerId:owner.profile.id});
 const actor=store.find(owner.token),file=path.join(dir,'editor-outbox.json'),outbox=new ContentOutbox({file,access,now});outbox.refresh(snapshot(store,[]));
 const command=(revision=0)=>({title:'Новость офлайн',body:'Исходный текст',date:'2026-11-15',category:'news',visible:true,reason:'Публикация редакции',requestId:randomUUID(),revision});
 return{store,access,actor,file,outbox,now,command};
}
test('offline news edits and trash survive control restart and commit together to the sole game writer',t=>{
 const f=fixture(t),before=structuredClone(f.store.data),body=f.command();
 const created=f.outbox.accept(f.actor,'news',body);assert.equal(created.queued,true);assert.deepEqual(f.store.data,before);
 assert.equal(f.outbox.accept(f.actor,'news',body).replay,true);
 f.outbox.accept(f.actor,'news',{action:'delete',id:created.id,confirmed:true,revision:1,reason:'Перенести в корзину',requestId:randomUUID()});
 const row=f.outbox.view('trash').items[0];f.outbox.accept(f.actor,'trash',{trashId:row.id,confirmed:true,revision:2,reason:'Вернуть публикацию',requestId:randomUUID()});
 const reopened=new ContentOutbox({file:f.file,access:f.access,now:f.now}),bundle=reopened.bundle();
 assert.equal(bundle.commands.length,3);assert.deepEqual(Object.keys(bundle.base),['gameNews']);
 const result=applyBundle(f.store,f.access,f.actor,bundle,[]);assert.equal(result.replay,false);assert.equal(f.store.data.gameNews.items[0].id,created.id);
 assert.equal(trash.view(f.store).total,0);assert.deepEqual(f.store.data.profiles,before.profiles);
 assert.equal(applyBundle(f.store,f.access,f.actor,bundle,[]).replay,true);
 reopened.complete(result.snapshot);assert.equal(reopened.status().pending,0);assert.equal(reopened.accept(f.actor,'news',body).replay,true);
});
test('a conflict or durable write failure never partly applies queued content',t=>{
 const f=fixture(t);f.outbox.accept(f.actor,'news',f.command());const bundle=f.outbox.bundle(),before=structuredClone(f.store.data),save=f.store.save;
 f.store.save=()=>{throw Error('fsync failure');};assert.throws(()=>applyBundle(f.store,f.access,f.actor,bundle,[]),/fsync failure/);assert.deepEqual(f.store.data,before);f.store.save=save;
 actions.apply(f.store,f.access,f.actor,'gameNews',f.command(),news.normalize);const changed=structuredClone(f.store.data);
 assert.throws(()=>applyBundle(f.store,f.access,f.actor,bundle,[]),/Данные изменились/);assert.deepEqual(f.store.data,changed);
 f.outbox.conflict('Изменились данные');f.outbox.discard(f.actor,snapshot(f.store,[]),{confirmed:true,reason:'Сверено владельцем'});assert.equal(f.outbox.status().pending,0);
});
test('queued bulk delete keeps per-item trash and deterministic audit identifiers',t=>{
 const f=fixture(t);const a=f.outbox.accept(f.actor,'news',f.command()),b=f.outbox.accept(f.actor,'news',f.command(1));
 f.outbox.accept(f.actor,'news',{action:'delete-many',ids:[a.id,b.id],confirmed:true,revision:2,reason:'Удалить публикации',requestId:randomUUID()});
 const pending=f.outbox.view('trash'),result=applyBundle(f.store,f.access,f.actor,f.outbox.bundle(),[]);
 assert.deepEqual(trash.view(f.store).items,pending.items);assert.equal(result.snapshot.data.gameNews.items.length,0);
});
test('editor requires a base version for every modified domain',t=>{
 const f=fixture(t);f.outbox.accept(f.actor,'news',f.command());const bundle=f.outbox.bundle();bundle.base={};
 const before=structuredClone(f.store.data);assert.throws(()=>applyBundle(f.store,f.access,f.actor,bundle,[]),/исходная версия/);assert.deepEqual(f.store.data,before);
});
