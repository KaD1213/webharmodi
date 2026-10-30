import {detectPitch} from './pitch-detector.mjs';
const $=id=>document.getElementById(id);
const names=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
const panel=$('panel-tuner'),scroll=$('pitchScroll'),canvas=$('pitchTrace'),axis=$('pitchAxis');
let points=[],elapsed=0,stream=null,audio=null,source=null,timer=null,pending=false,run=0,last=0,connected=false,sample=false;
const noteName=m=>names[((m%12)+12)%12];
function reading(f){
 const reference=Number($('reference').value)||442;
 const m=69+12*Math.log2(f/reference),nearest=Math.round(m);
 return {m,nearest,cents:100*(m-nearest)};
}
function status(text){$('tunerStatus').textContent=text;}
function showReading(p){
 $('tunerNote').textContent=noteName(p.nearest);
 $('tunerCents').textContent=(p.cents>=0?'+':'−')+Math.abs(p.cents).toFixed(1)+' ct';
 $('tunerHz').textContent=p.frequency.toFixed(1)+' Hz';
}
function append(f,dt){
 
 const p={...reading(f),frequency:f,t:elapsed,connect:connected};
 if(points.length&&p.nearest!==points.at(-1).nearest)p.connect=false;
 points.push(p);elapsed+=dt;connected=true;
 // Keep only the latest eight seconds of voiced measurements.
 while(points.length&&p.t-points[0].t>8)points.shift();
 showReading(p);draw();
}
function setup(c,w,h){
 const d=Math.min(devicePixelRatio||1,2);c.width=Math.round(w*d);c.height=Math.round(h*d);
 c.style.width=w+'px';c.style.height=h+'px';const g=c.getContext('2d');g.scale(d,d);return g;
}
function draw(){
 if(panel.hidden)return;

 const viewportWidth=scroll.clientWidth;
 const newest=points.at(-1)?.t||0;
 const h=Math.max(120,scroll.clientHeight),w=viewportWidth;
 const dark=document.documentElement.dataset.theme==='dark';
 const fg=dark?'#afb6c2':'#646b77',line=dark?'#343b46':'#e1e4e9',accent=dark?'#8ab4f8':'#007aff';
 const g=setup(canvas,w,h),a=setup(axis,54,h);
 const headX=connected?w/2:w-16;
 const y=cents=>22+(50-cents)/100*(h-44),x=t=>headX-(newest-t)/8*Math.max(1,headX-12);
 g.font='10px -apple-system,sans-serif';a.font='11px -apple-system,sans-serif';
 for(const cents of [-50,-25,0,25,50]){
  g.strokeStyle=cents===0?(dark?'#5caf9a':'#469d81'):line;
  g.lineWidth=cents===0?1.5:1;g.setLineDash(cents===0?[]:[3,5]);
  g.beginPath();g.moveTo(0,y(cents));g.lineTo(w,y(cents));g.stroke();g.setLineDash([]);
  a.fillStyle=fg;a.fillText(cents>0?'+'+cents:String(cents),3,y(cents)+4);
 }
 a.fillStyle=fg;a.fillText('cent',3,11);
 // History moves left; only this layer is blurred during voiced input.
 g.save();
 if(connected){g.filter='blur(5px)';g.globalAlpha=.3;}
 g.strokeStyle=accent;g.lineWidth=2;g.lineJoin='round';g.lineCap='round';g.beginPath();
 for(let i=0;i<points.length;i++){
  const p=points[i];if(!p.connect||!i)g.moveTo(x(p.t),y(p.cents));else g.lineTo(x(p.t),y(p.cents));
 }
 g.stroke();
 // Every new breath or detected note starts a separate, named segment.
 for(let i=0;i<points.length;i++)if(!points[i].connect||i===0){
  g.fillStyle=fg;g.fillText(noteName(points[i].nearest),x(points[i].t),13);
 }
 g.restore();
 if(points.length){
  const p=points.at(-1),cx=headX,cy=y(p.cents);
  // The live marker stays horizontally fixed, moving only with pitch (vertical).
  g.strokeStyle=accent;g.lineWidth=connected?6:3;g.lineCap='round';
  const markerHalf=connected?Math.min(46,w*.16):10;
  g.beginPath();g.moveTo(cx-markerHalf,cy);g.lineTo(cx+markerHalf,cy);g.stroke();
  g.fillStyle=accent;g.beginPath();g.arc(cx,cy,connected?9:4,0,Math.PI*2);g.fill();
  g.font=(connected?'bold 32px':'bold 15px')+' -apple-system,sans-serif';g.textAlign=connected?'center':'right';
  g.fillText(noteName(p.nearest),cx,connected?38:16);
  if(connected){
   g.font='600 22px -apple-system,sans-serif';
   g.fillText((p.cents>=0?'+':'−')+Math.abs(p.cents).toFixed(1)+' ct',cx,66);
  }
 }
}
function stop(){
 run++;pending=false;clearInterval(timer);timer=null;
 stream?.getTracks().forEach(t=>t.stop());stream=null;source?.disconnect();source=null;
 audio?.close().catch(()=>{});audio=null;connected=false;last=0;draw();
 $('tab-tuner').dataset.active='false';
 status(points.length?'計測を停止 · 軌跡を確認できます':'音を吹くと計測します');
}
async function start(){
 if(stream||pending||panel.hidden||document.hidden)return;
 const token=++run;pending=true;$('tunerRetry').hidden=true;
 status('マイクの使用を許可してください');
 let localAudio=null,media=null;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
  // Resume during the tab gesture, before waiting for the microphone prompt (Safari).
  localAudio=new (window.AudioContext||window.webkitAudioContext)();audio=localAudio;
  const resumed=localAudio.resume();resumed.catch(()=>{});
  try{if(navigator.audioSession)navigator.audioSession.type='play-and-record';}catch{}
  media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  if(token!==run){media.getTracks().forEach(t=>t.stop());localAudio.close().catch(()=>{});return;}
  stream=media;await resumed;if(token!==run)return;
  if(sample)clear();sample=false;
  const analyser=localAudio.createAnalyser();analyser.fftSize=4096;
  source=localAudio.createMediaStreamSource(media);source.connect(analyser);
  const raw=new Float32Array(4096),down=new Float32Array(2048);pending=false;
  $('tab-tuner').dataset.active='true';status('音を吹くと計測します');
  timer=setInterval(()=>{
   if(document.hidden||panel.hidden){stop();return;}
   analyser.getFloatTimeDomainData(raw);
   for(let i=0;i<down.length;i++)down[i]=(raw[2*i]+raw[2*i+1])*.5;
   const now=performance.now(),p=detectPitch(down,localAudio.sampleRate/2);
   const dt=last?Math.min((now-last)/1000,.12):.05;last=now;
   if(p){append(p.frequency,dt);status('計測中');}
   else{const wasConnected=connected;connected=false;if(wasConnected)draw();status(points.length?'音を待っています · 軌跡を保持中':'音を吹くと計測します');}
  },50);
 }catch(e){
  if(token!==run)return;stop();$('tunerRetry').hidden=false;
  status(e.name==='NotAllowedError'?'マイクを許可すると自動で計測します':e.name==='NotFoundError'?'マイクが見つかりません':'マイク設定を確認してください');
 }
}
function clear(){
 if(sample){clearInterval(timer);timer=null;} points=[];elapsed=0;connected=false;sample=false;
 $('tunerNote').textContent='—';$('tunerCents').textContent='— ct';
 $('tunerHz').textContent='A = '+($('reference').value||442)+' Hz';
 status(stream?'音を吹くと計測します':'音を待っています');draw();
}
$('tunerRetry').onclick=start;$('tunerClear').onclick=clear;
$('tunerDemo').onclick=()=>{
 stop();clear();sample=true;
 let i=0;status('サンプル再生中 · 実際の計測ではありません');
 timer=setInterval(()=>{
  if(i===70)connected=false;
  const cents=32*Math.exp(-(i%70)/8)+4*Math.sin(i*.24);
  append(442*2**(((i<70?69:70)-69)/12+cents/1200),.05);i++;
  if(i===140){clearInterval(timer);timer=null;connected=false;draw();status('サンプル表示 · 実際の計測ではありません');}
 },50);
};
$('tab-tuner').addEventListener('click',()=>{draw();start();});
new ResizeObserver(()=>draw()).observe(scroll);
new MutationObserver(()=>{if(panel.hidden)stop();else{draw();start();}}).observe(panel,{attributes:true,attributeFilter:['hidden']});
new MutationObserver(()=>draw()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-design']});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else if(!panel.hidden)start();});
window.addEventListener('pagehide',stop);window.addEventListener('keydown',e=>{if(e.key==='Escape')stop();});
$('reference').addEventListener('change',()=>{for(const p of points)Object.assign(p,reading(p.frequency));draw();});
