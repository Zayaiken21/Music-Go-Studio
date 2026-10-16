// Audio bytes stay on this device, outside the small localStorage songbook.
export class AudioStore {
  constructor() {this.pending=null;this.memory=new Map();}
  open() {
    if(this.pending)return this.pending;
    this.pending=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(new Error('Audio storage is unavailable in this browser.'));return;}
      const request=indexedDB.open('music-go-audio',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets',{keyPath:'id'});};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.pending=null;};resolve(db);};
      request.onerror=()=>reject(request.error||new Error('Audio storage could not be opened.'));
      request.onblocked=()=>reject(new Error('Close other studio tabs to open audio storage.'));
    });
    return this.pending;
  }
  async get(id) {
    if(this.memory.has(id))return this.memory.get(id);
    const db=await this.open();
    return new Promise((resolve,reject)=>{const request=db.transaction('assets','readonly').objectStore('assets').get(id);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});
  }
  async put(asset) {
    this.memory.set(asset.id,asset);const db=await this.open();
    await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(asset);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Audio could not be saved.'));});
  }
  async remove(id) {
    this.memory.delete(id);const db=await this.open();
    await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }
}
