const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const root=process.cwd(), out=path.join(root,'public/assets/events/black-friday'), docs=path.join(root,'docs/artwork/black-friday-20261108');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(docs,{recursive:true});
const base='C:/Users/semen/.codex/generated_images/01a14abe-e850-7ca1-be9b-f32a856dbaba';
const inputs=[
 ['casket','exec-57a62ad1-a79c-40ac-95a8-f2c972e5b571.png'],
 ['album-draft','exec-632b02b6-62b1-491a-a712-8e01738bba5d.png'],
 ['shop','exec-990f5dd6-b94b-4299-b97c-ae0e874e4d77.png'],
 ['album','exec-5a272dc5-0121-45ed-8921-96f588a505a1.png']
];
(async()=>{
const records=[];
for(const [name,file] of inputs){
 const source=path.join(base,file),copy=path.join(docs,name+'-source.png');
 fs.copyFileSync(source,copy);records.push({name,source,sha256:crypto.createHash('sha256').update(fs.readFileSync(copy)).digest('hex'),alpha:(await sharp(copy).metadata()).hasAlpha});
 if(name==='album')await sharp(copy).resize(1200,800,{fit:'inside'}).webp({quality:88}).toFile(path.join(out,'album.webp'));
 if(name==='shop')await sharp(copy).resize(256,256,{fit:'contain',background:'#00000000'}).webp({quality:90}).toFile(path.join(out,'shop.webp'));
 if(name==='casket'){
  await sharp(copy).resize(256,180,{fit:'contain',background:'#00000000'}).webp({quality:90}).toFile(path.join(out,'casket.webp'));
  await sharp(copy).resize(176,164,{fit:'contain',background:'#00000000'}).extend({top:40,bottom:52,left:40,right:40,background:'#00000000'}).png().toFile(path.join(docs,'regalia-center.png'));
 }
}
await sharp('docs/artwork/seasonal-event-concepts-20261026/banners/black-friday.png').resize(1440).webp({quality:86}).toFile(path.join(out,'banner.webp'));
fs.writeFileSync(path.join(docs,'manifest.json'),JSON.stringify({tool:'builtin image_gen',records},null,2));
console.log(records);
})();
