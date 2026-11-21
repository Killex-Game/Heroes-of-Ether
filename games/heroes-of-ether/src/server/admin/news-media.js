"use strict";
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {fail}=require('./content-actions');
const pattern=/^\/news-media\/([a-f0-9]{64})\.png$/;
const crcTable=Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
const crc=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
function decode(value){
  if(typeof value!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))fail('Выбери изображение PNG, JPEG или WebP в редакторе.');
  const data=Buffer.from(value.slice(22),'base64');
  if(data.length>1024*1024||data.length<45||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.toString('ascii',12,16)!=='IHDR'||data.toString('ascii',data.length-8,data.length-4)!=='IEND')fail('Некорректный или слишком большой баннер (до 1 МиБ).');
  const w=data.readUInt32BE(16),h=data.readUInt32BE(20);
  if(!w||!h||w>2048||h>2048||w*h>4*1024*1024)fail('Слишком большой размер баннера.');
  const chunks=[];let offset=8,ended=false,header=false;
  while(offset<data.length){
    if(offset+12>data.length)fail('Повреждён баннер PNG.');
    const length=data.readUInt32BE(offset),end=offset+12+length;
    if(end>data.length||crc(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))fail('Повреждён баннер PNG.');
    const type=data.toString('ascii',offset+4,offset+8);
    if(type==='IHDR'){if(header||offset!==8||length!==13)fail('Повреждён заголовок PNG.');header=true;}
    if(type==='IDAT')chunks.push(data.subarray(offset+8,end-4));
    if(type==='IEND'){if(length!==0||end!==data.length)fail('Повреждён конец PNG.');ended=true;}
    offset=end;
  }
  if(!ended||!chunks.length||data[24]!==8||![2,6].includes(data[25])||data[26]||data[27]||data[28])fail('Редактор должен подготовить обычный PNG-баннер.');
  const stride=w*(data[25]===6?4:3)+1;
  try{const raw=require('node:zlib').inflateSync(Buffer.concat(chunks),{maxOutputLength:stride*h});if(raw.length!==stride*h)throw Error();for(let row=0;row<h;row++)if(raw[row*stride]>4)throw Error();}catch{fail('Повреждены пиксели баннера.');}
  return data;
}
class NewsMedia {
  constructor(directory=null){this.directory=directory;this.memory=directory?null:new Map();}
  async upload(value){const data=decode(value),id=createHash('sha256').update(data).digest('hex'),name=id+'.png';
    if(this.directory){await fs.mkdir(this.directory,{recursive:true});const dest=path.join(this.directory,name),temp=dest+'.'+randomUUID()+'.tmp';
      try{
        // Identical uploads share one immutable file; retries survive Windows rename semantics.
        let exists=false;try{exists=(await fs.readFile(dest)).equals(data);}catch(e){if(e.code!=='ENOENT')throw e;}
        if(!exists){const file=await fs.open(temp,'wx',0o600);try{await file.writeFile(data);await file.sync();}finally{await file.close();}
          try{await fs.rename(temp,dest);}catch(e){if(!['EEXIST','EPERM'].includes(e.code)||!(await fs.readFile(dest)).equals(data))throw e;}
        }
      }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      if(process.platform!=='win32'){const dir=await fs.open(this.directory,'r');try{await dir.sync();}finally{await dir.close();}}
    }else this.memory.set(name,data);
    return {image:'/news-media/'+name};
  }
  async exists(url){const m=pattern.exec(url);if(!m)return false;const name=m[1]+'.png';if(this.memory)return this.memory.has(name);try{return(await fs.stat(path.join(this.directory,name))).isFile();}catch{return false;}}
  async serve(req,res,pathname){const m=pattern.exec(pathname);if(!m||!['GET','HEAD'].includes(req.method)){res.writeHead(404);return res.end();}
    try{const data=this.memory?this.memory.get(m[1]+'.png'):await fs.readFile(path.join(this.directory,m[1]+'.png'));if(!data)throw Error();res.writeHead(200,{'Content-Type':'image/png','Content-Length':data.length,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end();}}
}
module.exports={NewsMedia,decode};
