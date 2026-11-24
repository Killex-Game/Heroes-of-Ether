"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const snapshots=require('../../src/server/profiles/profile-read-snapshot');
const {ProfileReadWindow}=require('../../src/server/profiles/profile-read-window');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-retirement-')),file=path.join(dir,'profiles.json');
 fs.writeFileSync(file,'canonical checkpoint');const segment=file+'.wal-1';fs.writeFileSync(segment,'canonical WAL');
 t.after(()=>{assert(dir.startsWith(path.join(os.tmpdir(),'profile-retirement-')));fs.rmSync(dir,{recursive:true,force:true});});
 return{dir,file,segment};
}
test('asynchronous release yields during unlink and retains canonical files and active reader leases',async t=>{
 const f=fixture(t),window=new ProfileReadWindow(f.file),a=window.pin([f.segment],1),b=window.pin([f.segment],1);
 const directory=path.dirname(a.file);window.reset();await a.releaseAsync();assert(fs.existsSync(directory));
 let entered,unblock;const reached=new Promise(r=>entered=r),gate=new Promise(r=>unblock=r),unlink=fs.promises.unlink;
 const mock=t.mock.method(fs.promises,'unlink',async file=>{if(path.dirname(file)===directory){entered();await gate;}return unlink.call(fs.promises,file);});
 const removal=b.releaseAsync();await reached;
 assert.strictEqual(b.releaseAsync(),removal);assert.equal(window.cleanups.size,1);
 const next=window.pin([f.segment],1);assert.notEqual(next.file,b.file);assert.equal(fs.readFileSync(next.file,'utf8'),'canonical checkpoint');
 assert.equal(fs.readFileSync(f.segment,'utf8'),'canonical WAL');
 let turns=0;await new Promise(resolve=>setImmediate(()=>{turns++;resolve();}));assert.equal(turns,1);
 unblock();await removal;assert(!fs.existsSync(directory));mock.mock.restore();
 next.release();window.reset();await window.drainCleanup();assert.equal(window.cleanups.size,0);
 assert.equal(fs.readFileSync(f.file,'utf8'),'canonical checkpoint');assert.equal(fs.readFileSync(f.segment,'utf8'),'canonical WAL');
});
test('asynchronous removal rejects unexpected files before deleting any snapshot link',async t=>{
 const f=fixture(t),pin=snapshots.pin(f.file,[f.segment],1),directory=path.dirname(pin.file);
 fs.writeFileSync(path.join(directory,'unexpected.txt'),'preserve');
 await assert.rejects(pin.releaseAsync(),/Unexpected profile read snapshot contents/);
 assert(fs.existsSync(pin.file));assert(fs.existsSync(pin.file+'.wal-1'));
 assert.equal(fs.readFileSync(f.segment,'utf8'),'canonical WAL');
});
test('a failed retired-cache cleanup remains observable and cannot block canonical snapshots',async t=>{
 const f=fixture(t),window=new ProfileReadWindow(f.file),pin=window.pin([f.segment],1),directory=path.dirname(pin.file);
 const unlink=fs.promises.unlink,mock=t.mock.method(fs.promises,'unlink',async file=>{
  if(path.dirname(file)===directory)throw Object.assign(Error('injected'),{code:'EACCES'});
  return unlink.call(fs.promises,file);
 });
 pin.release();window.reset();await window.drainCleanup();assert.equal(window.lastError,'EACCES');assert(fs.existsSync(directory));mock.mock.restore();
 const next=window.pin([f.segment],1);assert.equal(fs.readFileSync(next.file,'utf8'),'canonical checkpoint');next.release();window.reset();await window.drainCleanup();
 snapshots.cleanup(f.file);assert(!fs.existsSync(directory));assert(fs.existsSync(f.file));
});
