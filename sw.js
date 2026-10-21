'use strict';
const release='10805532f3465469';
const prefix='webharmodi:'+new URL(self.registration.scope).pathname+':';
const cacheName=prefix+release;
const files=['./','./index.html','./style.css?v='+release,'./themes.css?v='+release,'./app.js?v='+release,'./adaptive-ji.mjs','./tap-tempo.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(files))));
// A running session keeps its own version. Updates activate after it is closed.
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==cacheName)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data==='APPLY_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      // Keep HTML, scripts and tuning policy from the same installed release.
      return (await (await caches.open(cacheName)).match('./index.html'))||fetch(request);
    })());
  }else event.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    return await cache.match(request)||fetch(request);
  })());
});
