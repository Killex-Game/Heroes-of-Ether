/* Shared newspaper preview; uploaded media is immutable and retained for restore. */
(() => {
  'use strict';
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  async function png(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Выбери PNG, JPEG или WebP до 15 МиБ.');
    const bitmap=await createImageBitmap(file);
    try{
      let width=Math.min(1600,bitmap.width),height=Math.round(bitmap.height*width/bitmap.width);
      if(height>1600){width=Math.round(width*1600/height);height=1600;}
      const canvas=document.createElement('canvas');
      for(let attempt=0;attempt<7;attempt++){
        canvas.width=Math.max(1,width);canvas.height=Math.max(1,height);
        const ctx=canvas.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const image=canvas.toDataURL('image/png');
        if(image.length<=1398126)return image;
        width=Math.round(width*.8);height=Math.round(height*.8);
      }
      throw Error('Не удалось подготовить изображение. Выбери другой файл.');
    }finally{bitmap.close();}
  }
  function attach({form,fields,item,api,status}){
    const apiLayout=window.KillexNewsLayout,label=node('label','Макет статьи'),select=node('select');
    select.name='layout';select.id='news-layout';
    for(const [id,text] of Object.entries(apiLayout.layouts)){const opt=node('option',text);opt.value=id;select.append(opt);}
    select.value=item?.layout||apiLayout.defaultLayout;label.append(select);form.append(label);fields.layout=select;
    const uploadLabel=node('label','Баннер новости'),file=node('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.id='news-banner';uploadLabel.append(file);
    const reset=node('button','Стандартный баннер раздела');reset.type='button';
    const previewLabel=node('h4','Предпросмотр статьи'),preview=node('article');preview.className='news-article news-editor-preview';
    preview.tabIndex=0;preview.setAttribute('aria-label','Предпросмотр новости');
    form.append(uploadLabel,reset,previewLabel,preview);
    let image=item?.image||'',busy=false,alive=true;
    const values=()=>({title:fields.title.value||'Заголовок новости',body:fields.body.value||'Текст новости',date:fields.date.value||new Date().toISOString().slice(0,10),category:fields.category.value,layout:select.value,image});
    const paint=()=>apiLayout.paint(preview,values());
    reset.onclick=()=>{if(!busy){image=apiLayout.banners[fields.category.value];paint();}};
    const change=()=>paint();form.addEventListener('input',change);form.addEventListener('change',change);
    file.onchange=async()=>{
      if(!file.files[0]||busy)return;busy=true;status.textContent='';file.disabled=true;
      try{const data=await png(file.files[0]);if(!alive||!file.isConnected)return;const result=await api('news/banner',{image:data});
        if(!alive||!file.isConnected)return;image=result.image;paint();status.textContent='Баннер загружен. Сохрани статью, чтобы опубликовать изменения.';
      }catch(e){if(alive&&file.isConnected)status.textContent=e.message;}
      finally{busy=false;file.disabled=false;file.value='';}
    };
    paint();
    return {get busy(){return busy;},get image(){return image;},dispose(){alive=false;form.removeEventListener('input',change);form.removeEventListener('change',change);}};
  }
  window.KillexNewsEditor={attach};
})();
