'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Portraits}=require('../../public/arena/portrait-loader');
const fixture=()=>{const images=[],identity={allSkins:[{id:'a'}],skinSource:(skin,size)=>skin.id+'/'+size};return {images,loader:new Portraits(identity,()=>{const image={naturalWidth:0};images.push(image);return image;}),load(i,width){images[i].naturalWidth=width;images[i].onload();}};};
test('small visible portraits load once; high density upgrades keep the visible portrait',()=>{
 const f=fixture();assert.equal(f.images.length,0);assert.equal(f.loader.get('missing',100),null);
 const low=f.loader.get('a',80);assert.equal(low.src,'a/256');for(let n=0;n<200;n++)f.loader.get('a',80);assert.equal(f.images.length,1);
 f.load(0,256);assert.equal(f.loader.get('a',800),low);assert.equal(f.images[1].src,'a/1024');
 f.load(1,1024);assert.equal(f.loader.get('a',80),f.images[1]);assert.equal(f.images.length,2);
});
test('out-of-order images cannot replace a larger portrait and errors never retry every frame',()=>{
 const f=fixture();f.loader.get('a',80);f.loader.get('a',800);f.load(1,1024);f.load(0,256);assert.equal(f.loader.get('a',200),f.images[1]);
 const g=fixture(),low=g.loader.get('a',80);g.load(0,256);g.loader.get('a',400);g.images[1].onerror();for(let n=0;n<200;n++)assert.equal(g.loader.get('a',400),low);assert.equal(g.images.length,2);
});
