"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ArenaDirectory}=require('../../src/server/arena/arena-directory');
const {arenaName}=require('../../src/server/arena/arena-names');
test('30-seat rooms preserve the 400-player admission limit and 30 lobby seats',()=>{
  const directory=new ArenaDirectory({now:()=>5000});
  const ready=()=>{for(const room of directory.rooms.values())if(room.status==='starting')directory.markReady(room.id);};
  ready();
  for(let i=0;i<400;i++){
    const id='capacity-'+i;assert(directory.enterLobby(id).ok);
    const r=directory.reserve(id);assert(r.ok);ready();
    assert(directory.confirm(id,r.ticket,r.workerLease).ok);
  }
  const rooms=directory.list();assert.equal(rooms.length,14);assert.equal(arenaName('arena-14'),'Кси');
  assert.equal(rooms.reduce((n,r)=>n+r.playing,0),400);
  assert(rooms.every(r=>r.capacity===30&&r.playing<=30&&!r.joinable));
  for(let i=0;i<30;i++)assert(directory.enterLobby('lobby-'+i).ok);
  assert.equal(directory.reserve('lobby-0').code,'ARENAS_FULL');
  assert.equal(directory.enterLobby('overflow').code,'ONLINE_LIMIT');
  assert(directory.leaveArena('capacity-0'));
  assert(directory.reserve('lobby-0').ok);
  assert.equal(directory.occupancy(),400);
});
