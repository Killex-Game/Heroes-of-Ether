"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../../public/shared/art-revision.js'),'utf8'),context);
const {url}=context.window.KillexArtRevision;
test('art revision preserves nonasset URLs and updates asset queries without accumulating revisions',()=>{
 for(const value of [null,undefined,'','data:image/png;base64,abc','https://example.org/assets/a.webp','/api/profile'])assert.equal(url(value),value);
 for(const source of ['assets/a.webp','/assets/a.webp?art=old','assets/a.webp?x=1&art=old&y=2#part']){
  const revised=url(source);assert.equal(url(revised),revised);assert.match(revised,/art=20261122b/);
 }
 assert.equal(url('assets/a.webp?art=old&x=1#part'),'assets/a.webp?x=1&art=20261122b#part');
 assert.equal(url('assets/a.webp?x=1&art=old&y=2#part'),'assets/a.webp?x=1&y=2&art=20261122b#part');
});
