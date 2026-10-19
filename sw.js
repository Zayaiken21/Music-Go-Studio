const CACHE='music-go-studio-v1.2.1';
const APP=['./','./index.html','./styles.css?v=1.2.1','./app.js?v=1.2.1','./core.js?v=1.2.1','./audio.js?v=1.2.1','./audio-process.js?v=1.2.1','./layers.js?v=1.2.1','./layer-core.js?v=1.2.1','./audio-store.js?v=1.2.1','./layer-ui.js?v=1.2.1','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('music-go-studio-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(!APP.some(path=>new URL(path,self.registration.scope).href===url.href))return;
  event.respondWith(fetch(event.request,{cache:'no-cache'}).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||Promise.reject(new Error('Offline asset unavailable')))));
});
