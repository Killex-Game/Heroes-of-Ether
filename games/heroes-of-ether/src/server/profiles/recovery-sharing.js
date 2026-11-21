"use strict";
// One startup pass, after validation/migrations. Independently decoded copies
// have different identities despite equal values; WAL deltas must not rewrite
// every historical receipt in the first commit. Neither input is mutated.
function share(previous, next) {
  if (Object.is(previous,next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' ||
      Array.isArray(previous)!==Array.isArray(next) || Object.getPrototypeOf(previous)!==Object.getPrototypeOf(next)) return next;
  const keys=Object.keys(next),oldKeys=Object.keys(previous);
  let equal=keys.length===oldKeys.length && (!Array.isArray(next)||previous.length===next.length),replacements;
  for(const key of keys) {
    const own=Object.hasOwn(previous,key),value=own?share(previous[key],next[key]):next[key];
    if(!own||value!==previous[key])equal=false;
    if(value!==next[key]) {
      (replacements||=[]).push([key,value]);
    }
  }
  if(equal)return previous;
  if(!replacements)return next;
  const result=Array.isArray(next)?next.slice():Object.create(Object.getPrototypeOf(next),Object.getOwnPropertyDescriptors(next));
  for(const [key,value]of replacements)Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});
  return result;
}
module.exports={share};
