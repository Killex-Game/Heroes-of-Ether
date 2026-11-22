'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const layout=require('../../public/shared/news-layout');
const release=(version,date='2026-11-15')=>({id:'alfa-test-'+version,version:'Alfa-test '+version,date,changes:['Release '+version]});
test('same-day releases use descending numeric versions without changing the manifest or history',()=>{
 const base=layout.sources(['0.0.9','0.0.32','0.0.10','0.1.0','0.0.27','1.0.0'].map(v=>release(v)));
 const saved=structuredClone(base);
 assert.deepEqual(layout.merge(base,[]).map(r=>r.version),['1.0.0','0.1.0','0.0.32','0.0.27','0.0.10','0.0.9'].map(v=>'Alfa-test '+v));
 assert.deepEqual(base,saved);
});
test('dates, edited source identity and hidden releases retain their semantics',()=>{
 const base=layout.sources([release('0.0.32'),release('0.0.31'),release('0.0.30','2026-11-16')]);
 const edit={id:'editor-uuid',sourceId:'alfa-test-0.0.32',category:'release',date:'2026-11-15',body:'Edited',visible:true};
 assert.deepEqual(layout.merge(base,[edit]).map(r=>r.sourceId),['alfa-test-0.0.30','alfa-test-0.0.32','alfa-test-0.0.31']);
 assert.equal(layout.merge(base,[{...edit,visible:false}]).length,2);
 assert.equal(layout.merge(base,[{...edit,visible:false}],true).length,3);
});

test('stored built-in banners use the current art revision; uploaded images are unchanged',()=>{
 const {imageSource}=require('../../public/shared/news-layout');
 assert.equal(imageSource('assets/news/v1/news.webp'),'assets/news/v1/news.webp?art=20261122d');
 assert.equal(imageSource('assets/events/easter-hunt/banner.png?art=20261122b'),'assets/events/easter-hunt/banner.png?art=20261122d');
 const upload='/news-media/'+ 'a'.repeat(64)+'.png';assert.equal(imageSource(upload),upload);
});
