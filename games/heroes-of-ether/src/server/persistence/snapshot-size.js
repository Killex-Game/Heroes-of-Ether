"use strict";
// Preserve version-1 fragment boundaries while storing JSON in PostgreSQL.
// The byte layout is fixed by existing saves, independent of any DB driver.
function documentSize(value){
 let bytes=5;
 const array=Array.isArray(value),keys=array?null:Object.keys(value),length=array?value.length:keys.length;
 for(let i=0;i<length;i++){
  const key=array?String(i):keys[i];
  const item=value[key];if(item===undefined&&!array)continue;
  bytes+=1+Buffer.byteLength(key,'utf8')+1;
  if(item===null||item===undefined)continue;
  if(typeof item==='string')bytes+=4+Buffer.byteLength(item,'utf8')+1;
  else if(typeof item==='boolean')bytes++;
  else if(typeof item==='number')bytes+=Number.isInteger(item)&&item>=-2147483648&&item<=2147483647&&!Object.is(item,-0)?4:8;
  else if(typeof item==='object')bytes+=documentSize(item);
  else throw Object.assign(Error('Invalid snapshot value'),{code:'DATABASE_INVALID_VALUE'});
 }
 return bytes;
}
module.exports={documentSize};
