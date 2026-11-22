"use strict";
(() => {
  const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
  const trigger=document.getElementById('writeFeedback'),dialog=node('dialog','social-dialog player-feedback-dialog');
  dialog.id='playerFeedbackDialog';dialog.setAttribute('aria-labelledby','playerFeedbackTitle');
  const header=node('header','personal-heading'),title=node('h2','','Написать отзыв'),close=node('button','personal-close','×');
  title.id='playerFeedbackTitle';close.type='button';close.setAttribute('aria-label','Закрыть отзыв');close.onclick=()=>dialog.close();header.append(title,close);
  const form=node('form','player-feedback-form'),label=node('label','','Твой отзыв'),text=node('textarea'),count=node('span','feedback-count','0 / 1000'),message=node('p','feedback-message'),send=node('button','sf-button sf-primary','Отправить');
  // Native maxlength counts UTF-16 units; the visible/server limit counts Unicode characters.
  const LIMIT=1000;
  text.id='playerFeedbackText';text.rows=8;text.maxLength=LIMIT*2;text.required=true;text.placeholder='Расскажи, что произошло, или поделись предложением';
  label.htmlFor=text.id;count.id='playerFeedbackCount';text.setAttribute('aria-describedby',count.id);message.setAttribute('role','status');send.type='submit';
  form.append(label,text,count,message,send);dialog.append(header,form);document.body.append(dialog);
  let pending=null,busy=false;
  const prefix=(value,limit)=>{let end=0,n=0;for(const character of value){if(n++>=limit)break;end+=character.length;}return value.slice(0,end);};
  const enforce=()=>{const value=prefix(text.value,LIMIT);if(value!==text.value){const start=text.selectionStart,end=text.selectionEnd,direction=text.selectionDirection;text.value=value;text.setSelectionRange(Math.min(start,value.length),Math.min(end,value.length),direction);}};
  const refresh=()=>{enforce();const length=Array.from(text.value).length;count.textContent=length+' / '+LIMIT;send.disabled=busy||!text.value.trim();};
  const insertLimited=value=>{
    const start=text.selectionStart,end=text.selectionEnd;
    const available=LIMIT-Array.from(text.value.slice(0,start)).length-Array.from(text.value.slice(end)).length;
    const accepted=prefix(value,Math.max(0,available));
    if(accepted===value)return false;
    text.setRangeText(accepted,start,end,'end');text.dispatchEvent(new Event('input',{bubbles:true}));return true;
  };
  text.addEventListener('beforeinput',event=>{
    if(!event.cancelable||!event.inputType.startsWith('insert'))return;
    if(busy||text.readOnly){event.preventDefault();return;}
    const value=event.data??event.dataTransfer?.getData('text/plain')??(['insertLineBreak','insertParagraph'].includes(event.inputType)?'\n':null);
    if(typeof value==='string'&&insertLimited(value.replace(/\r\n?/g,'\n')))event.preventDefault();
  });
  text.addEventListener('paste',event=>{
    if(busy||text.readOnly){event.preventDefault();return;}
    if(event.clipboardData&&insertLimited(event.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n')))event.preventDefault();
  });
  text.addEventListener('input',()=>{message.textContent='';refresh();});refresh();
  trigger.addEventListener('click',()=>{document.getElementById('closeSettings')?.click();window.KillexWindows.open(dialog);if(dialog.open)text.focus();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();refresh();if(busy||send.disabled)return;
    const value=text.value.replace(/\r\n?/g,'\n').trim();
    if(!pending||pending.text!==value)pending={text:value,requestId:window.KillexRequestIds.create()};
    busy=true;refresh();text.readOnly=true;message.textContent='';
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось отправить отзыв.');
      pending=null;text.value='';message.textContent='Спасибо! Отзыв № '+result.number+' отправлен. Срок обработки - 72 часа.';
    }catch(error){message.textContent=error.name==='AbortError'?'Ответ задержался. Повтори отправку - дубликат не появится.':error.message;}
    finally{clearTimeout(timeout);busy=false;text.readOnly=false;refresh();}
  });
})();
