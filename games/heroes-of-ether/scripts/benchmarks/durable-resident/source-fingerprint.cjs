'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=function fingerprint(root){
 const names=[];
 function walk(relative){for(const item of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
  const name=relative+'/'+item.name;
  if(item.isDirectory())walk(name);else if(item.isFile()&&/\.(?:js|cjs|json)$/.test(name))names.push(name);
 }}
 for(const directory of ['src','public/shared','scripts/benchmarks'])walk(directory);
 if(fs.existsSync(path.join(root,'public/assets')))walk('public/assets');
 for(const name of ['appearance-testing.json','accessory-preview.json','arena-rooms.json'])
  if(fs.existsSync(path.join(root,'config',name)))names.push('config/'+name);
 const hash=createHash('sha256');
 for(const name of names.sort())hash.update(name).update('\0').update(fs.readFileSync(path.join(root,name))).update('\0');
 return {files:names.length,sha256:hash.digest('hex')};
};
