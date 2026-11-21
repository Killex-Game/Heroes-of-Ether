'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ChatService}=require('../../src/server/chat/chat-service');
test('only a continuously empty arena loses messages after fifteen minutes',()=>{
 const chat=new ChatService(),minute=60000;
 chat.arena.push({text:'first'});chat.arenaRooms.set('arena-2',[{text:'second'}]);
 chat.pruneEmptyArenas(new Set(['arena-2']),0);
 chat.pruneEmptyArenas(new Set(['arena-2']),15*minute-1);assert.equal(chat.arena.length,1);
 chat.pruneEmptyArenas(new Set(['arena-2']),15*minute);assert.equal(chat.arena.length,0);assert.equal(chat.arenaRooms.get('arena-2').length,1);
 chat.pruneEmptyArenas(new Set(),16*minute);chat.pruneEmptyArenas(new Set(['arena-2']),30*minute);
 chat.pruneEmptyArenas(new Set(),31*minute);chat.pruneEmptyArenas(new Set(),45*minute);assert(chat.arenaRooms.has('arena-2'));
 chat.pruneEmptyArenas(new Set(),46*minute);assert(!chat.arenaRooms.has('arena-2'));
});
