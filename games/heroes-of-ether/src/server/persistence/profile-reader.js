'use strict';
// Read-only migration adapter. Locators come from a trusted server-side index,
// never from a client. This does not grant a room permission to write profiles.
const {decode}=require('./postgresql-state');
const documents=require('./snapshot-documents');
const fail=code=>{throw Object.assign(Error(code),{code});};
const text=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!value.includes('\0');
class ProfileReader {
  constructor(state,{maxProfiles=30,maxLogicalBytes=32*1024*1024,maxBatchBytes=64*1024*1024,
    maxCacheBytes=32*1024*1024,maxCacheEntries=64,maxConcurrentReads=2}={}) {
    for(const n of [maxProfiles,maxLogicalBytes,maxBatchBytes,maxCacheBytes,maxCacheEntries,maxConcurrentReads])
      if(!Number.isSafeInteger(n)||n<1)throw RangeError('Invalid profile reader limit');
    if(maxProfiles>128||maxLogicalBytes>64*1024*1024||maxBatchBytes>128*1024*1024)
      throw RangeError('Profile reader exceeds bounded admission');
    if(maxConcurrentReads>8)throw RangeError('Too many concurrent profile reads');
    this.state=state;Object.assign(this,{maxProfiles,maxLogicalBytes,maxBatchBytes,maxCacheBytes,maxCacheEntries,maxConcurrentReads});
    this.pending=0;
    this.cache=new Map();this.cacheBytes=0;
    this.metrics={requests:0,documents:0,cacheHits:0,logicalBytes:0};
  }
  clear(){this.cache.clear();this.cacheBytes=0;}
  remember(key,json) {
    // Count retained UTF-16 text conservatively. This budget is not a claim
    // about total V8 RSS, returned objects, or concurrent SQL driver buffers.
    const bytes=json.length*2;
    if(bytes>this.maxCacheBytes)return;
    const old=this.cache.get(key);if(old){this.cache.delete(key);this.cacheBytes-=old.bytes;}
    while(this.cache.size>=this.maxCacheEntries||this.cacheBytes+bytes>this.maxCacheBytes){
      const first=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);
    }
    this.cache.set(key,{json,bytes});this.cacheBytes+=bytes;
  }
  async read(locators,{expectedGeneration}={}) {
    if(!Array.isArray(locators)||locators.length<1||locators.length>this.maxProfiles||
      locators.some(x=>!x||!text(x.key)||!text(x.id))||new Set(locators.map(x=>x.key)).size!==locators.length||
      new Set(locators.map(x=>x.id)).size!==locators.length)fail('PG_PROFILE_LOCATORS');
    if(expectedGeneration!==undefined&&(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<1))
      fail('PG_PROFILE_GENERATION');
    if(this.pending>=this.maxConcurrentReads)fail('PG_PROFILE_BUSY');
    this.pending++;
    try {
    // Detach queued caller input before the first await.
    const selected=locators.map(({key,id})=>({key,id}));this.metrics.requests++;
    const fetched=await this.state.transaction(async c=>{
      const manifest=await this.state.manifest(c);
      if(!manifest||manifest.version!==1||manifest.sourceId!==this.state.config.sourceId)fail('PG_SOURCE_MISMATCH');
      if(!Number.isSafeInteger(manifest.generation)||manifest.generation<1||
        !Number.isSafeInteger(manifest.revision)||manifest.revision<0||
        ![0,1].includes(manifest.documentFormat??0))fail('PG_PROFILE_MANIFEST');
      if(expectedGeneration!==undefined&&expectedGeneration!==manifest.generation)fail('PG_PROFILE_GENERATION');
      const entries=[],missing=[],newCache=[];let logicalBytes=0;
      const admit=json=>{
        const bytes=json===null?0:Buffer.byteLength(json);
        if(bytes>this.maxLogicalBytes)fail('PG_PROFILE_TOO_LARGE');
        logicalBytes+=bytes;
        if(logicalBytes>this.maxBatchBytes)fail('PG_PROFILE_BATCH_TOO_LARGE');
      };
      for(const locator of selected){
        const cacheKey=JSON.stringify([manifest.sourceId,manifest.generation,locator.key]);
        const cached=this.cache.get(cacheKey);
        if(cached){
          this.metrics.cacheHits++;this.cache.delete(cacheKey);this.cache.set(cacheKey,cached);
          admit(cached.json);entries.push({locator,cacheKey,json:cached.json});
        }else missing.push({locator,cacheKey});
      }
      const readRows=async ids=>{
        const result=(await c.query(`SELECT id,value,hash,chunked FROM ${this.state.table}.state WHERE id=ANY($1::text[])`,[ids])).rows;
        const allowed=new Set(ids),found=new Set();
        for(const row of result){if(!allowed.has(row.id)||found.has(row.id))fail('PG_CORRUPT_DOCUMENT');found.add(row.id);}
        // Return compressed records; decode one at a time, never a whole batch
        // of large logical profiles before checking the admission budget.
        this.metrics.documents+=result.length;return result;
      };
      const roots=missing.length?await readRows(missing.map(x=>'profiles:'+x.locator.key)):[];
      if(roots.reduce((n,row)=>n+(row.value?.length||0),0)>this.maxBatchBytes)fail('PG_PROFILE_BATCH_TOO_LARGE');
      const rootsById=new Map(roots.map(row=>[row.id,row]));
      for(const {locator,cacheKey} of missing){
        const row=rootsById.get('profiles:'+locator.key);
        if(!row){entries.push({locator,cacheKey,json:null});continue;}
        const root=decode(row);
        const parts=[root];
        if(root.chunked){
          const count=root.value?.count;
          if(manifest.documentFormat!==1||!Number.isSafeInteger(count)||count<1||count>128)
            fail('DATABASE_INVALID_DOCUMENT_FRAGMENTS');
          const prefix=documents.PREFIX+Buffer.from(root._id).toString('base64url')+':';
          let size=0;
          for(let offset=0;offset<count;offset+=16){
            const ids=Array.from({length:Math.min(16,count-offset)},(_,i)=>prefix+(offset+i));
            const batch=await readRows(ids);if(batch.length!==ids.length)fail('DATABASE_INVALID_DOCUMENT_FRAGMENTS');
            for(const row of batch){
              const part=decode(row);
              if(typeof part.value!=='string'||part.chunked)fail('DATABASE_INVALID_DOCUMENT_FRAGMENTS');
              size+=Buffer.byteLength(part.value);if(size>this.maxLogicalBytes)fail('PG_PROFILE_TOO_LARGE');
              if(logicalBytes+size>this.maxBatchBytes)fail('PG_PROFILE_BATCH_TOO_LARGE');
              parts.push(part);
            }
          }
        }
        const restored=documents.restore(parts,manifest.documentFormat??0);
        if(restored.length!==1||restored[0]._id!==root._id)fail('PG_CORRUPT_DOCUMENT');
        const json=JSON.stringify(restored[0].value);
        admit(json);
        entries.push({locator,cacheKey,json});newCache.push({cacheKey,json});
      }
      const profiles=new Map();
      for(const {locator,json} of entries){
        const profile=json===null?null:JSON.parse(json);
        if(profile!==null&&(!profile||Array.isArray(profile)||profile.id!==locator.id))fail('PG_PROFILE_IDENTITY');
        profiles.set(locator.id,profile);
      }
      return {manifest,profiles,newCache,logicalBytes};
    },{readOnly:true});
    // Failed batches cannot publish partially verified cache entries.
    for(const {cacheKey,json} of fetched.newCache)this.remember(cacheKey,json);
    this.metrics.logicalBytes+=fetched.logicalBytes;
    return {sourceId:fetched.manifest.sourceId,generation:fetched.manifest.generation,
      revision:fetched.manifest.revision,profiles:fetched.profiles};
    } finally {this.pending--;}
  }
}
module.exports={ProfileReader};
