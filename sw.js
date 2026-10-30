'use strict';
const release='44c0fe14f282caad';
const prefix='webharmodi:'+new URL(self.registration.scope).pathname+':';
const cacheName=prefix+release;
const files=['./','./index.html','./style.css?v='+release,'./themes.css?v='+release,'./app.js?v='+release,'./adaptive-ji.mjs','./tap-tempo.mjs','./pendulum-motion.mjs','./meter-state.mjs','./pitch-detector.mjs','./pitch-tuner.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
// Fetch a complete release without reusing Safari's HTTP cache. Unversioned HTML
// or modules from that cache must never be installed under a new release name.
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const assets=await Promise.all(files.filter(file=>file!=='./').map(async file=>{
    const url=new URL(file,self.registration.scope);
    url.searchParams.set('__release',release);
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error('Release download failed: '+file);
    // Consume bodies immediately so parallel downloads cannot exhaust the
    // browser's per-origin connections while waiting for the remaining headers.
    const bytes=await response.arrayBuffer();
    if(file==='./index.html'&&!new TextDecoder().decode(bytes).includes('app.js?v='+release))throw new Error('Release HTML is not ready');
    return {file,response:new Response(bytes,{headers:{'content-type':response.headers.get('content-type')||'application/octet-stream'}})};
  }));
  const cache=await caches.open(cacheName);
  await Promise.all(assets.map(({file,response})=>cache.put(file,response)));
  await cache.put('./',(await cache.match('./index.html')).clone());
})()));
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
