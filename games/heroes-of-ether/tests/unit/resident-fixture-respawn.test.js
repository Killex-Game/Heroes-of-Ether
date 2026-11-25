'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RoomFixture}=require('../../scripts/benchmarks/resident-room-processes/room-fixture.cjs');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
test('room fixture seeds large bodies only once; respawn keeps canonical mass and protection',()=>{
 const store=new ProfileStore(),auth=store.open(),profile=store.find(auth.token);
 profile.level=600;const room=new RoomFixture('room-0',Array(10).fill(null).map((_,i)=>({...profile,id:profile.id+'-'+i})),0,()=>{},'epoch');
 const p=room.players[9];assert(p.mass>=120000);
 p.dead=true;room.arena.resetPlayer(p,1000);const mass=p.mass,pos=[p.x,p.y],protectedUntil=p.protectedUntil;
 room.populate(p,9,1000);assert.equal(p.mass,mass);assert.deepEqual([p.x,p.y],pos);
 assert.equal(p.protectedUntil,protectedUntil);assert(protectedUntil>1000);assert(p.mass<120000);
});
