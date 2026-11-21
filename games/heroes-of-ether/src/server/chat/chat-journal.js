'use strict';
const {ProfileJournal}=require('../profiles/profile-journal');
const {BoosterError}=require('../boosters/booster-catalog');
class ChatJournal {
  constructor(file){this.journal=new ProfileJournal(file);this.tail=Promise.resolve();this.pending=0;this.authors=new Map();}
  enqueue(work,author){
    if(this.closed||this.pending>=1024) return Promise.reject(new BoosterError('Чат занят. Повтори отправку чуть позже.',503));
    if(author && (this.authors.get(author)||0)>=8)
      return Promise.reject(new BoosterError('Слишком часто. Подожди пару секунд.',429));
    if(author)this.authors.set(author,(this.authors.get(author)||0)+1);
    this.pending++;
    const result=this.tail.then(work);
    this.tail=result.catch(()=>{}).finally(()=>{
      this.pending--;if(author){const left=this.authors.get(author)-1;if(left)this.authors.set(author,left);else this.authors.delete(author);}
    });
    return result;
  }
  async commit(tables,publish){
    const saved=await this.journal.commitDelta({set:{version:1},remove:[],tables:{
      clans:{set:{},remove:[]},achievementCounts:{set:{},remove:[]},messageReceipts:{set:{},remove:[]},...tables,
    }},publish);
    if(!saved)throw Error('Chat journal commit was superseded');
  }
  async checkpoint(){await this.tail;await this.journal.requestCheckpoint();}
  async close(){this.closed=true;await this.tail;await this.journal.close();}
}
module.exports={ChatJournal};
