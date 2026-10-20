'use strict';
import {AdaptiveJustIntonation, applyJustIntonation} from './adaptive-ji.mjs';
const $=id=>document.getElementById(id);
const state={transpose:0,voice:'Fl',pure:false,hold:false,oct:0,reference:442,volume:.45,metroVolume:.6,bpm:100,beats:4,accent:true,clickVoice:'wood',rhythmMode:1};
let ctx,master,metroMaster,playing=false,timer,nextTime=0,tick=0,generation=0;
const active=new Map(),owners=new Map(),scheduled=new Set(),visualTimers=new Set();
const noteNames=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
const tuner=new AdaptiveJustIntonation();
let tuning={chord:null,ambiguous:false,cents:{},candidates:[]};
function frequency(midi){return state.reference*2**((midi-69)/12+(tuning.cents[midi]??0)/1200);}
// Recompute the full sounding set on every change, including latched notes.
function retune(){
  tuner.a4=state.reference;
  const voices=new Map([...active.values()].map(v=>[v.midi,v]));
  if(state.pure)tuning=tuner.update([...voices.keys()]);
  else {tuner.reset();tuning={chord:null,ambiguous:false,candidates:[],cents:Object.fromEntries([...voices.keys()].map(n=>[n,0]))};}
  if(ctx){
    // Start new voices at the corrected pitch; glide only already sounding ones.
    const held=new Map();
    for(const [midi,v] of voices){
      if(!v.started){v.osc.detune.value=tuning.cents[midi]??0;v.osc.start();v.started=true;}
      else held.set(midi,v);
    }
    applyJustIntonation(tuning,held,ctx);
  }
  renderNotes();
}
function audio(){if(!ctx){ctx=new AudioContext({latencyHint:'interactive'});master=ctx.createGain();metroMaster=ctx.createGain();master.gain.value=state.volume*.18;metroMaster.gain.value=state.metroVolume*.32;master.connect(ctx.destination);metroMaster.connect(ctx.destination);}if(ctx.state==='suspended')ctx.resume().catch(()=>{console.warn('Audio resume requires another user gesture');});return ctx;}
const spectra={Fl:[1,.12,.06,.02],Cl:[1,0,.55,0,.25,0,.12],Brass:[1,.7,.5,.35,.23,.16],Organ:[1,.45,.3,.15,.1],Piano:[1,.5,.28,.14,.07]};
function makeVoice(key){audio();const t=ctx.currentTime,midi=60+key+state.transpose+12*state.oct,osc=ctx.createOscillator(),gain=ctx.createGain();const spec=spectra[state.voice],real=new Float32Array(spec.length+1),imag=new Float32Array(spec.length+1);spec.forEach((v,i)=>imag[i+1]=v);osc.setPeriodicWave(ctx.createPeriodicWave(real,imag));osc.frequency.value=state.reference*2**((midi-69)/12);gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.7,t+.02);if(state.voice==='Piano'){gain.gain.exponentialRampToValueAtTime(.1,t+.9);gain.gain.exponentialRampToValueAtTime(.001,t+4);}osc.connect(gain).connect(master);return {osc,gain,midi,started:false};}
function release(key,recalculate=true){const v=active.get(key);if(!v)return;v.gain.gain.cancelScheduledValues(ctx.currentTime);v.gain.gain.setTargetAtTime(0,ctx.currentTime,.018);v.osc.stop(ctx.currentTime+.12);v.osc.onended=()=>{v.osc.disconnect();v.gain.disconnect();};active.delete(key);if(recalculate)retune();}
function press(key,owner){audio();if(owners.has(owner))return;owners.set(owner,key);if(state.hold&&active.has(key)){release(key);return;}if(!active.has(key))active.set(key,makeVoice(key));retune();}
function unpress(owner){const key=owners.get(owner);owners.delete(owner);if(key!==undefined&&!state.hold&&![...owners.values()].includes(key))release(key);}
function stopNotes(){[...active.keys()].forEach(k=>release(k,false));owners.clear();tuner.reset();retune();}
function refreshVoices(){const keys=[...active.keys()];keys.forEach(k=>release(k,false));keys.forEach(k=>active.set(k,makeVoice(k)));retune();}
function renderNotes(){
  document.querySelectorAll('.key').forEach(el=>{
    const on=active.has(+el.dataset.key);
    el.classList.toggle('sounding',on);
    el.setAttribute('aria-pressed',String(on));
    const midi=60+(+el.dataset.key)+state.transpose+12*state.oct;
    el.setAttribute('aria-label',noteNames[((midi%12)+12)%12]+(Math.floor(midi/12)-1));
  });
}
function group(id,items,current,select){const container=$(id);container.innerHTML='';items.forEach(([value,label])=>{const b=document.createElement('button');b.textContent=label;b.classList.toggle('active',value===current);b.setAttribute('aria-pressed',String(value===current));b.onclick=()=>select(value);container.append(b);});}
function drawControls(){group('transpose',[[0,'C'],[-2,'B♭'],[3,'E♭'],[5,'F']],state.transpose,v=>{state.transpose=v;tuner.reset();refreshVoices();drawControls();});group('voices',['Piano','Fl','Cl','Brass','Organ','Custom'].map(v=>[v,v]),state.voice,v=>{if(v==='Custom')return;state.voice=v;refreshVoices();drawControls();});group('temperament',[[false,'平均律'],[true,'純正律']],state.pure,v=>{state.pure=v;retune();drawControls();});$('doInfo').textContent='ド = '+noteNames[(state.transpose+12)%12];$('pitchInfo').textContent=`A = ${state.reference} Hz · ${state.pure?'純正律':'平均律'}`;}
const keyMap=['a','w','s','e','d','f','t','g','y','h','u','j','k','o','l','p',';'];
// A fixed C2–C7 instrument; navigation changes only the visible window.
const firstKey=-24,lastKey=36,visibleWhites=15;
const whiteKeys=[];
for(let i=firstKey;i<=lastKey;i++)if(![1,3,6,8,10].includes(((i%12)+12)%12))whiteKeys.push(i);
let viewIndex=14,viewStart=0;
function setRange(index){
  viewIndex=Math.max(0,Math.min(whiteKeys.length-visibleWhites,Math.round(index)));
  viewStart=whiteKeys[viewIndex];
  $('rangeSlider').value=viewIndex;
  $('rangeSlider').setAttribute('aria-valuetext',noteNames[((viewStart%12)+12)%12]+(Math.floor((60+viewStart)/12)-1)+' から');
  const width=$('keyboard').scrollWidth;
  $('keyViewport').scrollLeft=width*viewIndex/whiteKeys.length;
  const end=whiteKeys[viewIndex+visibleWhites-1];
  document.querySelectorAll('.key').forEach(el=>{el.hidden=+el.dataset.key<viewStart||+el.dataset.key>end;});
  const name=k=>noteNames[((k%12)+12)%12]+(Math.floor((60+k)/12)-1);
  $('octLabel').textContent=name(viewStart)+' – '+name(end);
  $('octDown').disabled=viewIndex===0;
  $('octUp').disabled=viewIndex===whiteKeys.length-visibleWhites;
}
for(let i=firstKey;i<=lastKey;i++){
  const black=[1,3,6,8,10].includes(((i%12)+12)%12),b=document.createElement('button');
  b.className='key '+(black?'black':'white');b.dataset.key=i;b.setAttribute('aria-pressed','false');
  const preceding=whiteKeys.filter(k=>k<i).length;
  const left=(black?preceding-.31:whiteKeys.indexOf(i))*100/whiteKeys.length;
  const width=(black?.62:1)*100/whiteKeys.length;
  b.style.left=left+'%';b.style.width=width+'%';
  b.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();b.setPointerCapture(e.pointerId);press(i,'p'+e.pointerId);};
  b.onpointerup=e=>unpress('p'+e.pointerId);b.onpointercancel=e=>unpress('p'+e.pointerId);b.onlostpointercapture=e=>unpress('p'+e.pointerId);
  b.onkeydown=e=>{if(e.code==='Enter'){e.preventDefault();if(!e.repeat)press(i,'focus'+i);}};
  b.onkeyup=e=>{if(e.code==='Enter')unpress('focus'+i);};b.onblur=()=>unpress('focus'+i);b.oncontextmenu=e=>e.preventDefault();
  $('keyboard').append(b);
  const mini=document.createElement('span');mini.className=black?'mini-black':'mini-white';mini.style.left=left+'%';mini.style.width=width+'%';$('miniKeys').append(mini);
}
const rangeSlider=$('rangeSlider');
let rangeDrag=null;
rangeSlider.onpointerdown=e=>{
  if(e.button!==0||!e.isPrimary)return;
  e.preventDefault();
  const rect=rangeSlider.getBoundingClientRect();
  rangeDrag={pointerId:e.pointerId,startX:e.clientX,startIndex:viewIndex,width:rect.width};
  rangeSlider.setPointerCapture(e.pointerId);
  rangeSlider.classList.add('dragging');
};
rangeSlider.onpointermove=e=>{
  if(!rangeDrag||e.pointerId!==rangeDrag.pointerId)return;
  e.preventDefault();
  const delta=(e.clientX-rangeDrag.startX)/rangeDrag.width;
  setRange(rangeDrag.startIndex+delta*(whiteKeys.length-visibleWhites));
};
function finishRangeDrag(e){
  if(!rangeDrag||e.pointerId!==rangeDrag.pointerId)return;
  rangeDrag=null;
  rangeSlider.classList.remove('dragging');
}
rangeSlider.onpointerup=finishRangeDrag;
rangeSlider.onpointercancel=finishRangeDrag;
rangeSlider.onlostpointercapture=finishRangeDrag;
rangeSlider.oninput=e=>{if(!rangeDrag)setRange(+e.target.value);};
window.addEventListener('resize',()=>setRange(viewIndex));
$('hold').onclick=()=>{state.hold=!state.hold;$('hold').classList.toggle('active',state.hold);$('hold').setAttribute('aria-pressed',String(state.hold));$('hold').innerHTML=`持続 <b>${state.hold?'ON':'OFF'}</b>`;if(!state.hold)stopNotes();};
$('volume').oninput=e=>{state.volume=+e.target.value/100;$('volumeValue').textContent=e.target.value+'%';if(master)master.gain.setTargetAtTime(state.volume*.18,ctx.currentTime,.02);};
for(const [id,delta]of [['octDown',-1],['octUp',1]])$(id).onclick=()=>{setRange(viewIndex+delta*7);};
$('settingsOpen').onclick=()=>$('settingsDialog').showModal();$('settingsClose').onclick=()=>$('settingsDialog').close();
$('reference').onchange=e=>{const n=Number(e.target.value);state.reference=Number.isFinite(n)?Math.max(430,Math.min(450,n)):442;e.target.value=state.reference;for(const v of active.values())v.osc.frequency.setTargetAtTime(state.reference*2**((v.midi-69)/12),ctx.currentTime,.025);retune();drawControls();};
noteNames.forEach((name,i)=>{const o=document.createElement('option');o.value=i;o.textContent=name;$('contextKey').append(o);});
function updateContext(){tuner.setKey(+$('contextKey').value,$('contextMode').value);tuner.reset();retune();}
$('contextKey').onchange=updateContext;$('contextMode').onchange=updateContext;
const tempoMarks=[40,42,44,46,48,50,52,54,56,58,60,63,66,69,72,76,80,84,88,92,96,100,104,108,112,116,120,126,132,138,144,152,160,168,176,184,192,200,208];
const rhythmModes=[[1,'♩','4分モード'],[2,'♪','8分モード'],[4,'♬','16分モード'],[3,'③','3連符モード']];
function drawRhythmModes(){
  $('mixer').innerHTML='';
  rhythmModes.forEach(([value,symbol,label])=>{
    const button=document.createElement('button');
    button.className='rhythm-mode';button.setAttribute('aria-pressed',String(value===state.rhythmMode));
    button.innerHTML='<span aria-hidden="true">'+symbol+'</span><b>'+label+'</b>';
    button.onclick=()=>{state.rhythmMode=value;const was=playing;if(was)stopMetro();drawRhythmModes();if(was)startMetro();};
    $('mixer').append(button);
  });
}
function drawTempoScale(){
  $('tempoScale').innerHTML='';
  tempoMarks.forEach((bpm,i)=>{
    const mark=document.createElement('span');
    mark.className='tempo-mark';mark.style.top=(i/(tempoMarks.length-1)*100)+'%';
    if([40,60,80,100,120,144,176,208].includes(bpm)){mark.textContent=bpm;mark.className+=' labeled';}
    $('tempoScale').append(mark);
  });
}
function clickAt(time,level,strong){if(level<=0)return;const o=ctx.createOscillator(),g=ctx.createGain();o.type=state.clickVoice==='wood'?'triangle':state.clickVoice==='beep'?'sine':'square';o.frequency.setValueAtTime(state.clickVoice==='wood'?(strong?1500:950):state.clickVoice==='beep'?(strong?1320:880):(strong?2200:1500),time);g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(level*(strong?1:.65),time+.001);g.gain.exponentialRampToValueAtTime(.0001,time+(state.clickVoice==='beep'?.065:.025));o.connect(g).connect(metroMaster);scheduled.add(o);o.onended=()=>{scheduled.delete(o);g.disconnect();};o.start(time);o.stop(time+.08);}
function scheduler(){while(playing&&nextTime<ctx.currentTime+.12){const sub=tick%12,beat=Math.floor(tick/12)%state.beats;if(sub%(12/state.rhythmMode)===0)clickAt(nextTime,.8,state.accent&&beat===0&&sub===0);if(sub===0){const gen=generation;const id=setTimeout(()=>{visualTimers.delete(id);if(gen!==generation)return;document.querySelectorAll('.dot').forEach((el,i)=>el.classList.toggle('lit',i===beat));},Math.max(0,(nextTime-ctx.currentTime)*1000));visualTimers.add(id);}tick++;nextTime+=60/state.bpm/12;}}
function startMetro(){audio();playing=true;generation++;tick=0;nextTime=ctx.currentTime+.05;timer=setInterval(scheduler,25);scheduler();$('play').textContent='停止';$('play').classList.add('playing');$('play').setAttribute('aria-pressed','true');}
function stopMetro(){playing=false;generation++;clearInterval(timer);visualTimers.forEach(clearTimeout);visualTimers.clear();scheduled.forEach(o=>{try{o.stop();}catch{}});scheduled.clear();$('play').textContent='開始';$('play').classList.remove('playing');$('play').setAttribute('aria-pressed','false');document.querySelectorAll('.dot').forEach(el=>el.classList.remove('lit'));}
function drawDots(){$('beatDots').innerHTML='<span class="dot"></span>'.repeat(state.beats);}
function setBpm(n){
  if(!Number.isFinite(n))n=100;
  let index=0;
  tempoMarks.forEach((value,i)=>{if(Math.abs(value-n)<Math.abs(tempoMarks[index]-n))index=i;});
  state.bpm=tempoMarks[index];$('bpm').value=state.bpm;
  $('tempoWeight').value=index;$('tempoWeight').setAttribute('aria-valuetext',state.bpm+' BPM');
  $('tempoRail').style.setProperty('--tempo-pos',index/(tempoMarks.length-1));
}
$('play').onclick=()=>playing?stopMetro():startMetro();$('bpm').onchange=e=>setBpm(+e.target.value);
$('slower').onclick=()=>setBpm(tempoMarks[Math.max(0,tempoMarks.indexOf(state.bpm)-1)]);
$('faster').onclick=()=>setBpm(tempoMarks[Math.min(tempoMarks.length-1,tempoMarks.indexOf(state.bpm)+1)]);
let taps=[];$('tap').onclick=()=>{const now=performance.now();if(taps.length&&now-taps.at(-1)>2000)taps=[];taps.push(now);taps=taps.slice(-5);if(taps.length>1)setBpm(60000/((taps.at(-1)-taps[0])/(taps.length-1)));};
$('beats').onchange=e=>{state.beats=+e.target.value;const was=playing;if(was)stopMetro();drawDots();if(was)startMetro();};$('accent').onchange=e=>state.accent=e.target.checked;$('clickVoice').onchange=e=>state.clickVoice=e.target.value;
$('metroVolume').oninput=e=>{state.metroVolume=+e.target.value/100;$('metroVolumeValue').textContent=e.target.value+'%';if(metroMaster)metroMaster.gain.setTargetAtTime(state.metroVolume*.32,ctx.currentTime,.02);};

document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,select,textarea')||$('settingsDialog').open||$('metroSettingsDialog').open||$('fullscreenHelp').open)return;if(e.code==='Space'){e.preventDefault();if(!e.repeat)playing?stopMetro():startMetro();return;}const key=keyMap.indexOf(e.key.toLowerCase());if(key>=0){e.preventDefault();if(!e.repeat)press(viewStart+key,'k'+e.code);}});
document.addEventListener('keyup',e=>unpress('k'+e.code));window.addEventListener('blur',()=>{for(const owner of [...owners.keys()])unpress(owner);});document.addEventListener('visibilitychange',()=>{if(document.hidden){stopNotes();stopMetro();}});
// Native range keeps dragging, touch and keyboard access in sync with BPM.
$('tempoWeight').oninput=e=>setBpm(tempoMarks[+e.target.value]);
for(const view of ['harmony','metronome'])$('tab-'+view).onclick=()=>{
  for(const name of ['harmony','metronome']){
    const selected=name===view;
    $('tab-'+name).setAttribute('aria-selected',String(selected));
    $('panel-'+name).hidden=!selected;
    if(selected&&name==='harmony')setRange(viewIndex);
  }
};
$('metroSettingsOpen').onclick=()=>$('metroSettingsDialog').showModal();
$('metroSettingsClose').onclick=()=>$('metroSettingsDialog').close();
drawControls();drawDots();renderNotes();drawRhythmModes();drawTempoScale();setBpm(state.bpm);setRange(viewIndex);
const portraitGate=window.matchMedia?.('(orientation: portrait) and (max-width: 600px)');
portraitGate?.addEventListener('change',e=>{if(e.matches){stopNotes();stopMetro();}});
// Fullscreen must be requested directly from a user gesture. Never fake browser fullscreen.
function syncFullscreen(){
  const full=Boolean(document.fullscreenElement||document.webkitFullscreenElement);
  $('fullscreen').setAttribute('aria-pressed',String(full));
  $('fullscreen').setAttribute('aria-label',full?'フルスクリーンを終了':'フルスクリーン');
}
$('fullscreen').onclick=async()=>{
  try{
    if(document.fullscreenElement||document.webkitFullscreenElement){
      const exit=document.exitFullscreen||document.webkitExitFullscreen;
      if(exit)await exit.call(document);
    }else{
      const root=document.documentElement;
      const request=root.requestFullscreen||root.webkitRequestFullscreen;
      if(!request){$('fullscreenHelp').showModal();return;}
      await request.call(root);
    }
    syncFullscreen();
  }catch{syncFullscreen();$('fullscreenHelp').showModal();}
};
document.addEventListener('fullscreenchange',syncFullscreen);
document.addEventListener('webkitfullscreenchange',syncFullscreen);
$('fullscreenHelpClose').onclick=()=>$('fullscreenHelp').close();
syncFullscreen();

// Direct pointer hit testing shares the same rail coordinates as the visible weight.
// Keep the native range for keyboard / assistive input, not invisible touch geometry.
const tempoRail=$('tempoRail'),visibleWeight=$('visibleTempoWeight');
let weightDrag=null;
function moveWeight(clientY){
  const rect=tempoRail.getBoundingClientRect();
  if(rect.height<=0)return;
  const fraction=Math.max(0,Math.min(1,(clientY-weightDrag.offset-rect.top)/rect.height));
  const index=Math.round(fraction*(tempoMarks.length-1));
  setBpm(tempoMarks[index]);
}
tempoRail.onpointerdown=e=>{
  if(e.button!==0||weightDrag)return;
  e.preventDefault();
  const rect=tempoRail.getBoundingClientRect();
  const center=rect.top+tempoMarks.indexOf(state.bpm)/(tempoMarks.length-1)*rect.height;
  // Preserve where the finger grabbed the weight; no initial jump.
  const grabbedWeight=e.target===visibleWeight||visibleWeight.contains(e.target);
  weightDrag={id:e.pointerId,offset:grabbedWeight?e.clientY-center:0};
  tempoRail.setPointerCapture(e.pointerId);
  tempoRail.classList.add('dragging');
  if(!grabbedWeight)moveWeight(e.clientY);
};
tempoRail.onpointermove=e=>{
  if(weightDrag?.id!==e.pointerId)return;
  e.preventDefault();moveWeight(e.clientY);
};
function finishWeightDrag(e){
  if(weightDrag?.id!==e.pointerId)return;
  weightDrag=null;tempoRail.classList.remove('dragging');
}
tempoRail.onpointerup=finishWeightDrag;
tempoRail.onpointercancel=finishWeightDrag;
tempoRail.onlostpointercapture=finishWeightDrag;
tempoRail.oncontextmenu=e=>e.preventDefault();
