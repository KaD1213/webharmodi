'use strict';
import {AdaptiveJustIntonation, applyJustIntonation} from './adaptive-ji.mjs';
import {TapTempo} from './tap-tempo.mjs';
import {restoreMeter,chooseMeter,chooseRhythm,meterView} from './meter-state.mjs';
import {pendulumAngleAtPhase} from './pendulum-motion.mjs';
const $=id=>document.getElementById(id);
const designs=[['default','標準'],['studio','Studio'],['modern','Modern'],['paper','Paper']];
let designPreference='default';
try{const savedDesign=localStorage.getItem('webharmodi-design');if(designs.some(([id])=>id===savedDesign))designPreference=savedDesign;}catch{}
const themeQuery=window.matchMedia('(prefers-color-scheme: dark)');
let themePreference='system';
try{const preference=localStorage.getItem('webharmodi-theme');if(['system','light','dark'].includes(preference))themePreference=preference;}catch{}
function syncTheme(){
  const dark=themePreference==='dark'||(themePreference==='system'&&themeQuery.matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.documentElement.dataset.design=designPreference;
  const button=$('themeToggle');
  button.setAttribute('aria-pressed',String(dark));
  button.setAttribute('aria-label',dark?'ライトモードに切り替え':'ダークモードに切り替え');
  button.innerHTML=dark
    ?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
    :'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z"/></svg>';
  const colors={default:['#f2f2f7','#111318'],studio:['#e7eceb','#101a1b'],modern:['#f7f5f0','#1d1b19'],paper:['#f4eddd','#242019']};
  document.querySelector('meta[name="theme-color"]').content=colors[designPreference][dark?1:0];
  syncAppearanceUI();
}
function syncAppearanceUI(){
  document.querySelectorAll('[data-design-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.designChoice===designPreference)));
  document.querySelectorAll('.design-current').forEach(label=>label.textContent=designs.find(([id])=>id===designPreference)[1]);
  document.querySelectorAll('[data-color-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.colorChoice===themePreference)));
}
$('themeToggle').onclick=()=>{
  themePreference=document.documentElement.dataset.theme==='dark'?'light':'dark';
  try{localStorage.setItem('webharmodi-theme',themePreference);}catch{}
  syncTheme();
};
themeQuery.addEventListener('change',()=>{if(themePreference==='system')syncTheme();});
syncTheme();
const state={transpose:0,voice:'Fl',pure:false,hold:false,oct:0,reference:442,balance:0,bpm:100,beats:4,accent:true,clickVoice:'wood',rhythmMode:1};
// Restore only bounded musical settings. Playback and held notes never auto-start.
let saved={};
try{saved=JSON.parse(localStorage.getItem('webharmodi-settings')||'{}')||{};}catch{}
const numericSettings={reference:[430,450],balance:[-100,100],bpm:[40,208],beats:[1,12]};
for(const [name,[min,max]] of Object.entries(numericSettings)){
  if(typeof saved[name]==='number'&&Number.isFinite(saved[name]))state[name]=Math.max(min,Math.min(max,saved[name]));
}
state.beats=Math.round(state.beats);state.bpm=Math.round(state.bpm);
for(const [name,allowed] of Object.entries({transpose:[0,-2,3,5],voice:['Piano','Fl','Cl','Brass','Organ'],clickVoice:['wood','beep','click'],rhythmMode:[1,2,3,4]})){
  if(allowed.includes(saved[name]))state[name]=saved[name];
}
for(const name of ['pure','accent'])if(typeof saved[name]==='boolean')state[name]=saved[name];
restoreMeter(state,saved);
let contextKey=Number.isInteger(saved.contextKey)&&saved.contextKey>=0&&saved.contextKey<12?saved.contextKey:0;
let contextMode=saved.contextMode==='minor'?'minor':'major';
let keepAwake=saved.keepAwake!==false;
// A loaded preset is already saved; keep the outgoing page from replacing it.
let presetReloadPending=false;
function persist(){
  if(presetReloadPending)return;
  const {hold,oct,...musical}=state;
  try{localStorage.setItem('webharmodi-settings',JSON.stringify({...musical,contextKey,contextMode,keepAwake,viewIndex}));}catch{}
}
let ctx,master,metroMaster,playing=false,timer,nextTime=0,tick=0,generation=0;
let pendulumFrames=[],pendulumRAF=0,pendulumAngle=0;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
function balanceGains(){
  const position=(state.balance+100)/200;
  // Equal-power crossfade: keep the combined energy steady while moving the mix.
  // Fixed calibration compensates for the different tone/click envelopes.
  return {harmony:position===1?0:.12*Math.cos(position*Math.PI/2),metronome:position===0?0:.28*Math.sin(position*Math.PI/2)};
}
function syncBalance(){
  $('balance').value=state.balance;
  const description=state.balance===0?'中央':state.balance===-100?'ハーモニーのみ':state.balance===100?'メトロノームのみ':(state.balance<0?'ハーモニー寄り ':'メトロノーム寄り ')+Math.round(Math.abs(state.balance))+'%';
  $('balanceValue').textContent=description;$('balance').setAttribute('aria-valuetext',description);
  const gains=balanceGains();
  if(ctx&&master&&metroMaster)for(const [node,value]of [[master,gains.harmony],[metroMaster,gains.metronome]]){
    const param=node.gain,now=ctx.currentTime;
    if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);else{param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);}
    param.linearRampToValueAtTime(value,now+.025);
  }
}
const active=new Map(),owners=new Map(),scheduled=new Set(),visualTimers=new Set();
const noteNames=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
const tuner=new AdaptiveJustIntonation({a4:state.reference,key:contextKey,mode:contextMode});
const tapTempo=new TapTempo();
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
  syncWakeLock();
}
function audio(){try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
  if(!ctx||ctx.state==='closed'){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw new Error('このブラウザでは音声を再生できません。');
    ctx=new Audio({latencyHint:'interactive'});master=ctx.createGain();metroMaster=ctx.createGain();
    const gains=balanceGains();master.gain.value=gains.harmony;metroMaster.gain.value=gains.metronome;
    // Reserve output headroom for full chords and the metronome together.
    const compressor=ctx.createDynamicsCompressor();
    compressor.threshold.value=-10;compressor.knee.value=8;compressor.ratio.value=16;
    compressor.attack.value=.003;compressor.release.value=.12;
    master.connect(compressor);metroMaster.connect(compressor);compressor.connect(ctx.destination);
    ctx.addEventListener('statechange',()=>{
      if(ctx.state==='interrupted'||ctx.state==='closed'){stopNotes();stopMetro();}
    });
  }
  if(ctx.state!=='running')ctx.resume().catch(()=>{stopNotes();stopMetro();toast('音声を開始できませんでした。もう一度鍵盤を押してください。');});
  return ctx;
}
const spectra={Fl:[1,.12,.06,.02],Cl:[1,0,.55,0,.25,0,.12],Brass:[1,.7,.5,.35,.23,.16],Organ:[1,.45,.3,.15,.1],Piano:[1,.5,.28,.14,.07]};
function makeVoice(key){audio();const t=ctx.currentTime,midi=60+key+state.transpose+12*state.oct,osc=ctx.createOscillator(),gain=ctx.createGain();const spec=spectra[state.voice],real=new Float32Array(spec.length+1),imag=new Float32Array(spec.length+1);spec.forEach((v,i)=>imag[i+1]=v);osc.setPeriodicWave(ctx.createPeriodicWave(real,imag));osc.frequency.value=state.reference*2**((midi-69)/12);gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.7,t+.02);if(state.voice==='Piano'){gain.gain.exponentialRampToValueAtTime(.1,t+.9);gain.gain.exponentialRampToValueAtTime(.001,t+4);}osc.connect(gain).connect(master);return {osc,gain,midi,started:false};}
function release(key,recalculate=true){const v=active.get(key);if(!v)return;const param=v.gain.gain;if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(ctx.currentTime);else{param.cancelScheduledValues(ctx.currentTime);param.setValueAtTime(param.value,ctx.currentTime);}param.setTargetAtTime(0,ctx.currentTime,.018);try{v.osc.stop(ctx.currentTime+.12);}catch{}v.osc.onended=()=>{v.osc.disconnect();v.gain.disconnect();};active.delete(key);if(recalculate)retune();}
function press(key,owner){
  if(owners.has(owner))return;
  const midi=60+key+state.transpose;if(midi<0||midi>127)return;
  try{audio();}catch(error){toast(error.message);return;}
  const alreadyHeld=[...owners.values()].includes(key);
  if(!active.has(key)&&active.size>=24)return;
  owners.set(owner,key);
  if(state.hold&&active.has(key)&&!alreadyHeld){release(key);return;}
  if(!active.has(key))active.set(key,makeVoice(key));retune();
}
function unpress(owner,force=false){const key=owners.get(owner);owners.delete(owner);if(key!==undefined&&(force||!state.hold)&&![...owners.values()].includes(key))release(key);}
function stopNotes(){[...active.keys()].forEach(k=>release(k,false));owners.clear();pedal.clear();deferred.clear();tuner.reset();retune();}
function refreshVoices(){const keys=[...active.keys()];keys.forEach(k=>release(k,false));keys.forEach(k=>active.set(k,makeVoice(k)));retune();}
function keyPitchName(key){
  const midi=60+key+state.transpose+12*state.oct;
  return noteNames[((midi%12)+12)%12]+(Math.floor(midi/12)-1);
}
function renderNotes(){
  $('tab-harmony').dataset.active=String(active.size>0);
  $('tab-harmony').setAttribute('aria-label',active.size?'ハーモニー（発音中）':'ハーモニー');
  document.querySelectorAll('.key').forEach(el=>{
    const on=active.has(+el.dataset.key);
    el.classList.toggle('sounding',on);
    el.setAttribute('aria-pressed',String(on));
    const pitch=keyPitchName(+el.dataset.key);
    el.setAttribute('aria-label',pitch);
    const label=el.querySelector('.key-note');
    if(label)label.textContent=pitch;
  });
}
function group(id,items,current,select){const container=$(id),focused=container.contains(document.activeElement)?document.activeElement.textContent:null;container.innerHTML='';items.forEach(([value,label])=>{const b=document.createElement('button');b.textContent=label;b.classList.toggle('active',value===current);b.setAttribute('aria-pressed',String(value===current));if(value==='Custom'){b.setAttribute('aria-disabled','true');b.title='準備中';}b.onclick=()=>select(value);container.append(b);if(label===focused)b.focus({preventScroll:true});});}
function drawControls(){group('transpose',[[0,'C'],[-2,'B♭'],[3,'E♭'],[5,'F']],state.transpose,v=>{state.transpose=v;tuner.reset();refreshVoices();drawControls();});group('voices',['Piano','Fl','Cl','Brass','Organ'].map(v=>[v,v]),state.voice,v=>{if(v==='Custom')return;state.voice=v;refreshVoices();drawControls();});group('temperament',[[false,'平均律'],[true,'純正律']],state.pure,v=>{state.pure=v;retune();drawControls();});$('doInfo').textContent='ド = '+noteNames[(state.transpose+12)%12];$('pitchInfo').textContent=`A = ${state.reference} Hz · ${state.pure?'純正律 · '+noteNames[contextKey]+(contextMode==='major'?' 長調':' 短調'):'平均律'}`;renderNotes();setRange(viewIndex);}
const keyMap=['a','w','s','e','d','f','t','g','y','h','u','j','k','o','l','p',';'];
// A fixed C2–C7 instrument; navigation changes only the visible window.
const firstKey=-24,lastKey=36,visibleWhites=15;
const whiteKeys=[];
for(let i=firstKey;i<=lastKey;i++)if(![1,3,6,8,10].includes(((i%12)+12)%12))whiteKeys.push(i);
let viewIndex=typeof saved.viewIndex==='number'&&Number.isFinite(saved.viewIndex)?Math.max(0,Math.min(21,saved.viewIndex)):14,viewStart=0;
function setRange(index){
  viewIndex=Math.max(0,Math.min(whiteKeys.length-visibleWhites,index));
  viewStart=whiteKeys[Math.round(viewIndex)];
  $('rangeSlider').value=viewIndex;
  $('rangeSlider').setAttribute('aria-valuetext',keyPitchName(viewStart)+' から');
  const width=$('keyboard').scrollWidth;
  // Translate by fractional key positions so the range glides continuously;
  // the viewport naturally clips keys at either edge during the movement.
  $('keyboard').style.transform=`translate3d(${-width*viewIndex/whiteKeys.length}px,0,0)`;
  const end=whiteKeys[Math.min(whiteKeys.length-1,Math.round(viewIndex+visibleWhites-1))];
  $('octLabel').textContent=keyPitchName(viewStart)+' – '+keyPitchName(end);
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
  if(!black&&((i%12)+12)%12===0){
    const octave=Math.floor((60+i)/12)-1,label=document.createElement('span');
    label.className='key-note';label.textContent='C'+octave;label.setAttribute('aria-hidden','true');
    b.append(label);
  }
  b.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();b.setPointerCapture(e.pointerId);press(i,'p'+e.pointerId);};
  b.onpointermove=e=>{
    if(!b.hasPointerCapture(e.pointerId)||state.hold)return;
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.key');
    const owner='p'+e.pointerId,key=target?+target.dataset.key:null;
    if(owners.get(owner)===key)return;
    unpress(owner);if(key!==null)press(key,owner);
  };
  b.onpointerup=e=>unpress('p'+e.pointerId);b.onpointercancel=e=>unpress('p'+e.pointerId,true);b.onlostpointercapture=e=>unpress('p'+e.pointerId);
  b.onkeydown=e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();e.stopPropagation();if(!e.repeat)press(i,'focus'+i);}};
  b.onkeyup=e=>{if(e.code==='Enter'||e.code==='Space')unpress('focus'+i);};b.onblur=()=>unpress('focus'+i,true);b.oncontextmenu=e=>e.preventDefault();
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
  // Normalize to the thumb's actual travel, not the full rail width.
  const travel=rangeDrag.width*(1-visibleWhites/whiteKeys.length);
  const delta=(e.clientX-rangeDrag.startX)/Math.max(1,travel);
  setRange(rangeDrag.startIndex+delta*(whiteKeys.length-visibleWhites));
};
function finishRangeDrag(e){
  if(!rangeDrag||e.pointerId!==rangeDrag.pointerId)return;
  rangeDrag=null;
  rangeSlider.classList.remove('dragging');
  persist();
}
rangeSlider.onpointerup=finishRangeDrag;
rangeSlider.onpointercancel=finishRangeDrag;
rangeSlider.onlostpointercapture=finishRangeDrag;
rangeSlider.oninput=e=>{if(!rangeDrag)setRange(+e.target.value);};
window.addEventListener('resize',()=>setRange(viewIndex));
$('hold').onclick=()=>{state.hold=!state.hold;$('hold').classList.toggle('active',state.hold);$('hold').setAttribute('aria-pressed',String(state.hold));$('hold').innerHTML=`持続 <b>${state.hold?'ON':'OFF'}</b>`;if(!state.hold)for(const key of [...active.keys()])if(![...owners.values()].includes(key))release(key);};
$('balance').oninput=e=>{state.balance=Math.max(-100,Math.min(100,+e.target.value));syncBalance();};
$('balanceReset').onclick=()=>{state.balance=0;syncBalance();};
for(const [id,delta]of [['octDown',-1],['octUp',1]])$(id).onclick=()=>{setRange(viewIndex+delta*7);persist();};
$('settingsOpen').onclick=()=>$('settingsDialog').showModal();$('settingsClose').onclick=()=>$('settingsDialog').close();
$('reference').onchange=e=>{const n=e.target.value.trim()===''?state.reference:Number(e.target.value);state.reference=Number.isFinite(n)?Math.max(430,Math.min(450,n)):state.reference;e.target.value=state.reference;for(const v of active.values())v.osc.frequency.setTargetAtTime(state.reference*2**((v.midi-69)/12),ctx.currentTime,.025);retune();drawControls();};
noteNames.forEach((name,i)=>{const o=document.createElement('option');o.value=i;o.textContent=name;$('contextKey').append(o);});
function updateContext(){contextKey=+$('contextKey').value;contextMode=$('contextMode').value;tuner.setKey(contextKey,contextMode);tuner.reset();retune();drawControls();}
$('contextKey').onchange=updateContext;$('contextMode').onchange=updateContext;
const tempoMarks=[40,42,44,46,48,50,52,54,56,58,60,63,66,69,72,76,80,84,88,92,96,100,104,108,112,116,120,126,132,138,144,152,160,168,176,184,192,200,208];
const rhythmModes=[[1,'♩','4分モード'],[2,'♪','8分モード'],[4,'♬','16分モード'],[3,'③','3連符モード']];
function rhythmIcon(value,compound=false){
  if(compound&&value===3)return '<svg viewBox="0 0 38 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 27V10h22v17M19 10v17"/>'+[4,15,26].map(x=>'<ellipse cx="'+x+'" cy="28" rx="4.3" ry="3" fill="currentColor"/>').join('')+'</svg>';
  const quarter='<ellipse cx="12" cy="26" rx="5" ry="3.5" transform="rotate(-20 12 26)" fill="currentColor"/><path d="M16 25V5"/>';
  const symbols={
    1:quarter,
    2:'<path d="M10 26V8h21v18"/><path d="M10 8h21" stroke-width="3.5"/>'+[6,27].map(x=>'<ellipse cx="'+x+'" cy="27" rx="4.5" ry="3.2" transform="rotate(-20 '+x+' 27)" fill="currentColor"/>').join(''),
    4:'<path d="M7 26V6m9 20V6m9 20V6m9 20V6"/><path d="M7 6h27M7 12h27" stroke-width="3"/>'+[3,12,21,30].map(x=>'<ellipse cx="'+x+'" cy="27" rx="3.7" ry="2.8" transform="rotate(-20 '+x+' 27)" fill="currentColor"/>').join(''),
    3:'<path d="M8 27V15h22v12M19 15v12M4 7V4h7m14 0h8v3"/><text x="18" y="9" stroke="none" fill="currentColor" text-anchor="middle" font-size="11" font-family="sans-serif">3</text>'+[4,15,26].map(x=>'<ellipse cx="'+x+'" cy="28" rx="4.3" ry="3" transform="rotate(-20 '+x+' 28)" fill="currentColor"/>').join('')
  };
  return '<svg viewBox="0 0 38 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+symbols[value]+'</svg>';
}
function drawRhythmModes(){
  $('mixer').innerHTML='';
  rhythmModes.forEach(([value,symbol,label])=>{
    const button=document.createElement('button');
    button.className='rhythm-mode';button.setAttribute('aria-pressed',String(value===state.rhythmMode));
    button.innerHTML='<span aria-hidden="true">'+rhythmIcon(value,state.meterDenominator===8)+'</span><b>'+(state.meterDenominator===8&&value===3?'8分モード（3分割）':label)+'</b>';
    button.onclick=()=>{const was=playing;if(was)stopMetro();chooseRhythm(state,value);syncMeterControls();if(was)startMetro();};
    $('mixer').append(button);
  });
}
function syncMeterControls(){
  const view=meterView(state);
  $('beats').value=view.selection;$('meterPreset').value=view.preset;
  $('meterInfo').textContent=view.label;
  $('bpm').setAttribute('aria-label',state.meterDenominator===8?'テンポ（付点4分音符）':'テンポ（4分音符）');
  drawDots();drawRhythmModes();
}
function setMeter(value){
  const was=playing;if(was)stopMetro();
  chooseMeter(state,value);syncMeterControls();
  if(was)startMetro();persist();
}
function drawTempoScale(){
  $('tempoScale').innerHTML='';
  const length=$('tempoRail').offsetHeight||180;
  let lastLabel=-Infinity;
  tempoMarks.forEach((bpm,i)=>{
    const mark=document.createElement('span');
    mark.className='tempo-mark';mark.style.top=(i/(tempoMarks.length-1)*100)+'%';
    const y=i/(tempoMarks.length-1)*length;
    if([40,60,80,100,120,144,176,208].includes(bpm)&&(y-lastLabel>=16||i===0)&&((length-y)>=16||i===tempoMarks.length-1)){
      mark.textContent=bpm;mark.className+=' labeled';lastLabel=y;
    }
    $('tempoScale').append(mark);
  });
}
function clickAt(time,level,strong){if(level<=0)return;const o=ctx.createOscillator(),g=ctx.createGain();o.type=state.clickVoice==='wood'?'triangle':state.clickVoice==='beep'?'sine':'square';o.frequency.setValueAtTime(state.clickVoice==='wood'?(strong?1500:950):state.clickVoice==='beep'?(strong?1320:880):(strong?2200:1500),time);g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(level*(strong?1:.65),time+.001);g.gain.exponentialRampToValueAtTime(.0001,time+(state.clickVoice==='beep'?.065:.025));o.connect(g).connect(metroMaster);scheduled.add(o);o.onended=()=>{scheduled.delete(o);o.disconnect();g.disconnect();};o.start(time);o.stop(time+.08);}
function scheduler(){
  // A blocked main thread must not replay a backlog of clicks all at once.
  if(playing&&nextTime<ctx.currentTime-.05)nextTime=ctx.currentTime+.015;
  while(playing&&nextTime<ctx.currentTime+.12){const sub=tick%12,beat=Math.floor(tick/12)%state.beats;
    // Share the audio scheduler's phase, including tempo changes between beats.
    pendulumFrames.push({time:nextTime,phase:tick/12});
    if(pendulumFrames.length>256)pendulumFrames.splice(0,pendulumFrames.length-256);
    if(sub%(12/state.rhythmMode)===0)clickAt(nextTime,.8,state.accent&&beat===0&&sub===0);if(sub===0){const gen=generation;const id=setTimeout(()=>{visualTimers.delete(id);if(gen!==generation)return;document.querySelectorAll('.dot').forEach((el,i)=>el.classList.toggle('lit',i===beat));},Math.max(0,(nextTime-ctx.currentTime)*1000));visualTimers.add(id);}tick++;nextTime+=60/state.bpm/12;}
}
function startMetro(){if(playing)return;try{audio();}catch(error){toast(error.message);return;}playing=true;generation++;tick=0;pendulumFrames=[];nextTime=ctx.currentTime+.05;timer=setInterval(scheduler,25);scheduler();startPendulum();$('play').textContent='停止';$('play').classList.add('playing');$('play').setAttribute('aria-pressed','true');$('tab-metronome').dataset.active='true';$('tab-metronome').setAttribute('aria-label','メトロノーム（再生中）');syncWakeLock();}
function stopMetro(){playing=false;stopPendulum();generation++;clearInterval(timer);visualTimers.forEach(clearTimeout);visualTimers.clear();scheduled.forEach(o=>{try{o.stop();}catch{}});scheduled.clear();$('play').textContent='開始';$('play').classList.remove('playing');$('play').setAttribute('aria-pressed','false');$('tab-metronome').dataset.active='false';$('tab-metronome').setAttribute('aria-label','メトロノーム');document.querySelectorAll('.dot').forEach(el=>el.classList.remove('lit'));syncWakeLock();}
function drawDots(){$('beatDots').innerHTML='<span class="dot"></span>'.repeat(state.beats);}
function setBpm(n,{fromTap=false}={}){
  if(!fromTap)tapTempo.reset();
  if(!Number.isFinite(n))n=100;
  state.bpm=Math.round(Math.max(40,Math.min(208,n)));$('bpm').value=state.bpm;
  const high=tempoMarks.findIndex(mark=>mark>=state.bpm);
  const index=high===0?0:high-1+(state.bpm-tempoMarks[high-1])/(tempoMarks[high]-tempoMarks[high-1]);
  $('tempoWeight').value=Math.round(index);$('tempoWeight').setAttribute('aria-valuetext',state.bpm+' BPM');
  $('tempoRail').style.setProperty('--tempo-pos',index/(tempoMarks.length-1));
}
$('play').onclick=()=>playing?stopMetro():startMetro();$('bpm').onchange=e=>setBpm(e.target.value.trim()===''?state.bpm:Number(e.target.value));
$('slower').onclick=()=>setBpm(tempoMarks.filter(mark=>mark<state.bpm).at(-1)??40);
$('faster').onclick=()=>setBpm(tempoMarks.find(mark=>mark>state.bpm)??208);
function recordTap(){const bpm=tapTempo.tap(performance.now());if(bpm!==null){setBpm(bpm,{fromTap:true});persist();}}
// Measure the press, not the release; different finger hold times do not affect BPM.
$('tap').onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();recordTap();};
$('tap').onclick=e=>{if(e.detail===0)recordTap();};
$('beats').onchange=e=>setMeter(e.target.value);$('accent').onchange=e=>state.accent=e.target.checked;$('clickVoice').onchange=e=>state.clickVoice=e.target.value;

document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,select,textarea')||$('settingsDialog').open||$('fullscreenHelp').open)return;if(e.code==='Space'){if(e.target.closest('button'))return;e.preventDefault();if(!e.repeat)playing?stopMetro():startMetro();return;}const key=keyMap.indexOf(e.key.toLowerCase());if(key>=0){e.preventDefault();if(!e.repeat)press(viewStart+key,'k'+e.code);}});
document.addEventListener('keyup',e=>unpress('k'+e.code));window.addEventListener('blur',()=>{for(const owner of [...owners.keys()])if(!owner.startsWith('m:'))unpress(owner,true);});document.addEventListener('visibilitychange',()=>{if(document.hidden){stopNotes();stopMetro();}else syncWakeLock();});
document.addEventListener('keydown',e=>{if(e.code==='Escape'){stopNotes();stopMetro();}});
// Native range keeps dragging, touch and keyboard access in sync with BPM.
$('tempoWeight').oninput=e=>setBpm(tempoMarks[+e.target.value]);
for(const view of ['harmony','metronome','tuner'])$('tab-'+view).onclick=()=>{
  for(const name of ['harmony','metronome','tuner']){
    const selected=name===view;
    $('tab-'+name).setAttribute('aria-selected',String(selected));
    $('panel-'+name).hidden=!selected;
    $('tab-'+name).tabIndex=selected?0:-1;
    if(selected&&name==='harmony')setRange(viewIndex);
  }
};
for(const id of ['reference','beats','clickVoice'])$(id).value=state[id==='reference'?'reference':id];
$('contextKey').value=contextKey;$('contextMode').value=contextMode;$('accent').checked=state.accent;
syncBalance();
$('keepAwake').checked=keepAwake;
drawControls();drawDots();renderNotes();drawRhythmModes();drawTempoScale();setBpm(state.bpm);setRange(viewIndex);
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
// Reserve the complete swing envelope, rather than shifting the arm off-center.
function layoutMechanism(){
  const mechanism=tempoRail.closest('.mechanism');
  const width=mechanism.clientWidth,height=mechanism.clientHeight;
  if(!width||!height)return;
  const length=Math.max(24,Math.min(height-50,(width/2-44)/Math.sin(38*Math.PI/180)));
  mechanism.style.setProperty('--arm-length',length+'px');
  mechanism.style.setProperty('--body-width',Math.min(width-12,(length+40)*.58)+'px');
  mechanism.style.setProperty('--body-top',(height-28-length-14)+'px');
  drawTempoScale();
}
new ResizeObserver(layoutMechanism).observe(tempoRail.closest('.mechanism'));
function setPendulumAngle(angle){pendulumAngle=angle;tempoRail.style.setProperty('--pendulum-angle',angle+'deg');}
function audibleTime(){
  const stamp=ctx.getOutputTimestamp?.();
  if(stamp?.performanceTime>0&&stamp.contextTime>0)return Math.min(ctx.currentTime,stamp.contextTime+Math.max(0,(performance.now()-stamp.performanceTime)/1000));
  return Math.max(0,ctx.currentTime-(ctx.outputLatency||0));
}
function paintPendulum(){
  if(!playing)return;
  const now=audibleTime();
  while(pendulumFrames.length>1&&pendulumFrames[1].time<=now)pendulumFrames.shift();
  const from=pendulumFrames[0],to=pendulumFrames[1];
  if(from&&!weightDrag&&!$('panel-metronome').hidden){
    const phase=now<from.time?from.phase:to?from.phase+(to.phase-from.phase)*(now-from.time)/(to.time-from.time):from.phase+(now-from.time)*state.bpm/60;
    // Finite-amplitude pendulum: slow reversal, fast central crossing.
    // The central beat reference alternates direction; subdivisions do not speed up the arm.
    setPendulumAngle(pendulumAngleAtPhase(phase,reducedMotion.matches?6:38));
  }
  pendulumRAF=requestAnimationFrame(paintPendulum);
}
function startPendulum(){cancelAnimationFrame(pendulumRAF);tempoRail.classList.add('swaying');paintPendulum();}
function stopPendulum(){cancelAnimationFrame(pendulumRAF);pendulumRAF=0;pendulumFrames=[];tempoRail.classList.remove('swaying');if(!weightDrag)setPendulumAngle(0);}
function railPosition(clientX,clientY){
  // offset geometry is unrotated. Invert the visible arm's rotation around its pivot.
  const parent=tempoRail.offsetParent.getBoundingClientRect();
  const transform=getComputedStyle(tempoRail).transform;
  const matrix=transform==='none'?{a:1,b:0}:new DOMMatrixReadOnly(transform);
  const dx=clientX-parent.left-tempoRail.offsetLeft-tempoRail.offsetWidth/2;
  const dy=clientY-parent.top-tempoRail.offsetTop-tempoRail.offsetHeight;
  return {y:-matrix.b*dx+matrix.a*dy+tempoRail.offsetHeight,height:tempoRail.offsetHeight,angle:Math.atan2(matrix.b,matrix.a)*180/Math.PI};
}
function moveWeight(clientX,clientY){
  const point=railPosition(clientX,clientY);
  if(point.height<=0)return;
  const fraction=Math.max(0,Math.min(1,(point.y-weightDrag.offset)/point.height));
  const index=Math.round(fraction*(tempoMarks.length-1));
  setBpm(tempoMarks[index]);
}
tempoRail.onpointerdown=e=>{
  if(e.button!==0||weightDrag)return;
  e.preventDefault();
  const point=railPosition(e.clientX,e.clientY);
  const center=parseFloat(tempoRail.style.getPropertyValue('--tempo-pos'))*point.height;
  // Preserve where the finger grabbed the weight; no initial jump.
  const grabbedWeight=e.target===visibleWeight||visibleWeight.contains(e.target);
  weightDrag={id:e.pointerId,offset:grabbedWeight?point.y-center:0};
  tempoRail.classList.add('adjusting');setPendulumAngle(point.angle);
  tempoRail.setPointerCapture(e.pointerId);
  tempoRail.classList.add('dragging');
  if(!grabbedWeight)moveWeight(e.clientX,e.clientY);
};
tempoRail.onpointermove=e=>{
  if(weightDrag?.id!==e.pointerId)return;
  e.preventDefault();moveWeight(e.clientX,e.clientY);
};
function finishWeightDrag(e){
  if(weightDrag?.id!==e.pointerId)return;
  weightDrag=null;tempoRail.classList.remove('dragging','adjusting');
  if(!playing)setPendulumAngle(0);
}
tempoRail.onpointerup=finishWeightDrag;
tempoRail.onpointercancel=finishWeightDrag;
tempoRail.onlostpointercapture=finishWeightDrag;
tempoRail.oncontextmenu=e=>e.preventDefault();

// Save settings locally, without ever saving playback state or active notes.
document.addEventListener('click',persist);
document.addEventListener('change',persist);
let saveTimer;
document.addEventListener('input',()=>{clearTimeout(saveTimer);saveTimer=setTimeout(persist,150);});
window.addEventListener('pagehide',()=>{persist();stopNotes();stopMetro();});
rangeSlider.addEventListener('change',persist);
for(const tab of ['harmony','metronome','tuner'])$('tab-'+tab).addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const views=['harmony','metronome','tuner'];const target=e.key==='Home'?views[0]:e.key==='End'?views.at(-1):views[(views.indexOf(tab)+(e.key==='ArrowRight'?1:2))%views.length];
  $('tab-'+target).click();$('tab-'+target).focus();
});

let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
let wakeLock=null,wakePending=false;
function needsWakeLock(){return keepAwake&&!document.hidden&&(playing||active.size>0);}
async function syncWakeLock(){
  if(!needsWakeLock()){if(wakeLock){const lock=wakeLock;wakeLock=null;await lock.release().catch(()=>{});}return;}
  if(!navigator.wakeLock||wakeLock||wakePending)return;
  wakePending=true;
  try{
    const lock=await navigator.wakeLock.request('screen');
    if(!needsWakeLock()){await lock.release();return;}
    wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});
  }catch{}finally{wakePending=false;}
}
$('keepAwake').onchange=e=>{keepAwake=e.target.checked;syncWakeLock();};
if(!navigator.wakeLock){$('keepAwake').disabled=true;$('keepAwake').closest('label').title='このブラウザは画面点灯の維持に対応していません';}

// Optional Web MIDI: requested only after pressing Connect; no sysex access.
let midiAccess=null;
const pedal=new Set(),deferred=new Set();
function releaseMidi(prefix){
  for(const owner of [...owners.keys()])if(owner.startsWith(prefix)){deferred.delete(owner);unpress(owner,true);}
  for(const id of [...pedal])if(id.startsWith(prefix))pedal.delete(id);
}
function midiMessage(input,event){
  const [status,note,velocity]=event.data,command=status&0xf0,channel=status&0xf;
  const prefix='m:'+input.id+':'+channel+':',owner=prefix+note;
  if(command===0x90&&velocity>0){deferred.delete(owner);if(owners.has(owner))unpress(owner,true);press(note-60,owner);}
  else if(command===0x80||(command===0x90&&velocity===0)){
    if(pedal.has(prefix))deferred.add(owner);else unpress(owner);
  }else if(command===0xb0&&note===64){
    if(velocity>=64)pedal.add(prefix);
    else {pedal.delete(prefix);for(const held of [...deferred])if(held.startsWith(prefix)){deferred.delete(held);unpress(held);}}
  }else if(command===0xb0&&note===120)stopNotes();
  else if(command===0xb0&&note===123)releaseMidi(prefix);
}
function syncMidi(){
  const inputs=[...midiAccess.inputs.values()].filter(input=>input.state==='connected');
  for(const input of inputs)input.onmidimessage=event=>midiMessage(input,event);
  const ids=new Set(inputs.map(input=>input.id));
  for(const owner of [...owners.keys()])if(owner.startsWith('m:')&&!ids.has(owner.split(':').slice(1,-2).join(':')))unpress(owner,true);
  $('midiStatus').textContent=inputs.length?inputs.map(input=>input.name||'MIDI').join('、'):'機器が見つかりません';
  $('midiConnect').textContent='再確認';
}
$('midiConnect').onclick=async()=>{
  if(!navigator.requestMIDIAccess)return;
  $('midiConnect').disabled=true;
  try{midiAccess??=await navigator.requestMIDIAccess({sysex:false});midiAccess.onstatechange=event=>{if(event.port.type==='input'&&event.port.state==='disconnected')stopNotes();syncMidi();};syncMidi();}
  catch{$('midiStatus').textContent='接続できませんでした';}
  finally{$('midiConnect').disabled=false;}
};
if(!navigator.requestMIDIAccess){$('midiConnect').disabled=true;$('midiStatus').textContent='このブラウザは未対応';}

// Relative URLs keep offline installation valid under GitHub Pages subdirectories.
const localPreview=['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).has('preview');
const appVersion=new URL(import.meta.url).searchParams.get('v');
$('appVersion').textContent=appVersion?'バージョン '+appVersion.slice(0,8):'ローカルプレビュー';
if('serviceWorker'in navigator&&!localPreview){
  let registration=null,applyingUpdate=false,reloading=false,checking=false,lastCheck=0;
  const watched=new WeakSet();
  const status=message=>$('offlineStatus').textContent=message;
  function reloadUpdated(){
    if(!applyingUpdate||reloading)return;
    reloading=true;persist();location.reload();
  }
  function offerUpdate(){
    if(applyingUpdate)return;
    const waiting=registration?.waiting;
    $('applyUpdate').hidden=!waiting||!navigator.serviceWorker.controller;
    if(waiting&&navigator.serviceWorker.controller)status('新しいバージョンがあります');
    else if(registration?.installing)status('新しいバージョンをダウンロード中…');
    else if(registration?.active)status('オフラインで利用できます');
  }
  function watchInstall(){
    const worker=registration.installing;
    offerUpdate();
    if(!worker||watched.has(worker))return;
    watched.add(worker);
    worker.addEventListener('statechange',()=>{
      // The waiting slot is assigned after the statechange event on some browsers.
      setTimeout(()=>{
        if(worker.state==='redundant'&&!applyingUpdate)status('更新を取得できませんでした。もう一度お試しください。');
        else offerUpdate();
      },0);
    });
  }
  const registrationReady=navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(result=>{
    registration=result;watchInstall();registration.addEventListener('updatefound',watchInstall);offerUpdate();return result;
  });
  // Keep registration failures handled even before the user opens settings.
  registrationReady.catch(()=>status('オンラインで利用中。更新を確認できます。'));
  function waitForInstall(worker){
    if(worker?.state==='redundant')return Promise.reject(new Error('Update install failed'));
    if(!worker||['installed','activated'].includes(worker.state))return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);worker.removeEventListener('statechange',changed);resolve();};
      const changed=()=>{
        if(worker.state==='redundant'){clearTimeout(timer);worker.removeEventListener('statechange',changed);reject(new Error('Update install failed'));}
        else if(['installed','activated'].includes(worker.state))finish();
      };
      const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('Update timeout'));},25000);
      worker.addEventListener('statechange',changed);changed();
    });
  }
  async function checkUpdate(manual=false){
    if(checking||applyingUpdate||(!manual&&Date.now()-lastCheck<60000))return;
    checking=true;lastCheck=Date.now();$('checkUpdate').disabled=true;$('checkUpdate').textContent='確認中…';
    try{
      status('更新を確認中…');await registrationReady;await registration.update();
      await waitForInstall(registration.installing);
      // Allow Safari to expose the newly installed waiting worker.
      await new Promise(resolve=>setTimeout(resolve,0));offerUpdate();
      if(!registration.waiting&&!registration.installing)status('最新バージョンです · オフラインで利用できます');
    }catch{status('更新を確認できませんでした。通信を確認してもう一度お試しください。');}
    finally{checking=false;$('checkUpdate').disabled=false;$('checkUpdate').textContent='更新を確認';}
  }
  $('checkUpdate').onclick=()=>checkUpdate(true);
  $('settingsOpen').addEventListener('click',()=>checkUpdate());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdate();});
  $('applyUpdate').onclick=()=>{
    if(playing||active.size){toast('発音とメトロノームを停止してから更新してください。');return;}
    const worker=registration?.waiting;
    if(!worker){checkUpdate(true);return;}
    applyingUpdate=true;persist();$('applyUpdate').disabled=true;$('checkUpdate').disabled=true;
    $('applyUpdate').textContent='更新中…';status('更新を適用しています…');
    // controllerchange is the primary signal; the active worker check is a fallback
    // for a missed event on a suspended iPhone / Home Screen session.
    worker.addEventListener('statechange',()=>{if(worker.state==='activated')setTimeout(reloadUpdated,150);});
    worker.postMessage('APPLY_UPDATE');
    setTimeout(()=>{
      if(reloading)return;
      if(worker.state==='activated'||registration.active===worker)reloadUpdated();
      else{applyingUpdate=false;$('applyUpdate').disabled=false;$('checkUpdate').disabled=false;$('applyUpdate').textContent='更新を適用';status('更新を完了できませんでした。もう一度お試しください。');}
    },8000);
  };
  navigator.serviceWorker.addEventListener('controllerchange',reloadUpdated);
}else{
  $('offlineStatus').textContent=localPreview?'ローカルプレビューを表示中':'このブラウザではオンラインでご利用ください';
  $('checkUpdate').hidden=true;
}

// One shared settings sheet for sound, metronome, balance and appearance.
for(const dialog of [$('settingsDialog')]){
  const appearance=document.createElement('details');appearance.className='appearance-settings';
  appearance.innerHTML='<summary>デザイン<span class="design-current"></span></summary><div class="design-picker" role="group" aria-label="デザインテーマ"></div><div class="appearance-label">明るさ</div><div class="color-picker" role="group" aria-label="ライトとダーク"></div>';
  const picker=appearance.querySelector('.design-picker');
  for(const [id,name]of designs){
    const button=document.createElement('button');button.className='design-choice';button.dataset.designChoice=id;
    button.innerHTML='<span class="design-swatch swatch-'+id+'" aria-hidden="true"><i></i><i></i><i></i></span><span class="design-name">'+name+'</span>';
    button.onclick=()=>{designPreference=id;try{localStorage.setItem('webharmodi-design',id);}catch{}syncTheme();};picker.append(button);
  }
  for(const [id,label]of [['system','端末に合わせる'],['light','ライト'],['dark','ダーク']]){
    const button=document.createElement('button');button.textContent=label;button.dataset.colorChoice=id;
    button.onclick=()=>{themePreference=id;try{localStorage.setItem('webharmodi-theme',id);}catch{}syncTheme();};appearance.querySelector('.color-picker').append(button);
  }
  dialog.querySelector('.settings-grid').after(appearance);
}
syncAppearanceUI();

/* ===== iOS refinement & band features ===== */
{
  // Sliding selection thumb for segmented controls and tabs.
  const thumbs=new WeakMap();
  const place=c=>{let t=thumbs.get(c);if(!t){t=document.createElement('i');t.className='thumb';t.style.transition='none';thumbs.set(c,t);requestAnimationFrame(()=>requestAnimationFrame(()=>t.style.transition=''));}
    if(t.parentNode!==c)c.prepend(t);
    const a=c.querySelector(':scope>[aria-selected=true],:scope>.active,:scope>[aria-pressed=true]');
    if(!a||!a.offsetWidth){t.style.opacity=0;return;}
    t.style.opacity=1;t.style.width=a.offsetWidth+'px';t.style.height=a.offsetHeight+'px';t.style.transform=`translate(${a.offsetLeft}px,${a.offsetTop}px)`;};
  const watched=new Set();
  const selectionResize=new ResizeObserver(entries=>entries.forEach(({target})=>place(target)));
  const watch=c=>{if(watched.has(c))return;watched.add(c);new MutationObserver(()=>place(c)).observe(c,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-selected','aria-pressed']});selectionResize.observe(c);place(c);};
  const watchAll=()=>document.querySelectorAll('.tabs,.segments,.color-picker').forEach(watch);
  watchAll();addEventListener('resize',()=>watched.forEach(place));addEventListener('orientationchange',()=>setTimeout(()=>watched.forEach(place),150));
  document.fonts?.ready.then(()=>watched.forEach(place));
  $('settingsDialog').addEventListener('toggle',()=>watched.forEach(place));$('settingsOpen').addEventListener('click',()=>setTimeout(()=>{watchAll();watched.forEach(place)},0));
  // Details toggle does not bubble; capture it and measure after layout is updated.
  $('settingsDialog').addEventListener('toggle',e=>{
    if(e.target.matches('.appearance-settings')&&e.target.open)requestAnimationFrame(()=>{watchAll();watched.forEach(place);});
  },true);

  // Appearance picker (design + light/dark) lives in settings; the header toggle is hidden.
  if(!document.querySelector('.appearance-settings')){
    const choices=designs.filter(([id])=>id!=='default').concat([['default','標準']]).sort((a,b)=>designs.findIndex(d=>d[0]===a[0])-designs.findIndex(d=>d[0]===b[0]));
    const box=document.createElement('details');box.className='appearance-settings';
    box.innerHTML='<summary>外観<span class="design-current"></span></summary><div class="appearance-label">デザイン</div><div class="design-picker">'+choices.map(([id,name])=>`<button class="design-choice" data-design-choice="${id}"><span class="design-name">${name}</span><span class="design-swatch swatch-${id}"><i></i><i></i><i></i></span></button>`).join('')+'</div><div class="appearance-label">配色</div><div class="color-picker">'+[['system','端末に合わせる'],['light','ライト'],['dark','ダーク']].map(([id,name])=>`<button data-color-choice="${id}">${name}</button>`).join('')+'</div>';
    document.querySelector('#settingsDialog .secondary-settings').after(box);
    box.querySelectorAll('[data-design-choice]').forEach(b=>b.onclick=()=>{designPreference=b.dataset.designChoice;try{localStorage.setItem('webharmodi-design',designPreference);}catch{}syncTheme();});
    box.querySelectorAll('[data-color-choice]').forEach(b=>b.onclick=()=>{themePreference=b.dataset.colorChoice;try{localStorage.setItem('webharmodi-theme',themePreference);}catch{}syncTheme();});
    syncAppearanceUI();watchAll();
  }

  // Bottom-sheet behaviour: animated close, drag or swipe down to dismiss.
  const closeSheet=d=>{if(!d.open||d.classList.contains('closing'))return;d.classList.add('closing');
    let timeout;
    const cleanup=()=>{clearTimeout(timeout);d.removeEventListener('animationend',onAnimationEnd);d.removeEventListener('close',done);};
    const done=()=>{cleanup();d.classList.remove('closing');d.style.removeProperty('--drag');d.style.transform='';d.style.transition='';if(d.open)d.close();};
    const onAnimationEnd=e=>{if(e.target===d&&e.animationName==='sheet-down')done();};
    d.addEventListener('animationend',onAnimationEnd);d.addEventListener('close',done);
    timeout=setTimeout(done,420);
  };
  for(const [dialog,close] of [['settingsDialog','settingsClose'],['fullscreenHelp','fullscreenHelpClose']]){
    const d=$(dialog);if(!d)continue;
    $(close).onclick=()=>closeSheet(d);
    d.addEventListener('cancel',e=>{e.preventDefault();closeSheet(d);});
    d.addEventListener('click',e=>{
      if(e.target!==d)return;
      const r=d.getBoundingClientRect();
      if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeSheet(d);
    });
    let drag=null;
    d.addEventListener('pointerdown',e=>{if(!e.target.closest('.sheet-handle,.dialog-head')||e.target.closest('button'))return;drag={id:e.pointerId,y:e.clientY,t:e.timeStamp,dy:0};d.setPointerCapture(e.pointerId);d.style.transition='none';});
    d.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;drag.dy=Math.max(0,e.clientY-drag.y);d.style.transform=`translateY(${drag.dy}px)`;});
    const end=e=>{if(!drag||e.pointerId!==drag.id)return;const {dy,t}=drag,speed=dy/Math.max(1,e.timeStamp-t);drag=null;
      if(dy>110||speed>.6){d.style.setProperty('--drag',dy+'px');closeSheet(d);}else{d.style.transition='transform .35s '+getComputedStyle(document.documentElement).getPropertyValue('--ease');d.style.transform='';}};
    d.addEventListener('pointerup',end);
    d.addEventListener('pointercancel',e=>{if(drag?.id!==e.pointerId)return;drag=null;d.style.transition='';d.style.transform='';});
  }

  // Fullscreen is pointless in the installed app and unsupported on iPhone Safari.
  const root=document.documentElement,installed=navigator.standalone||matchMedia('(display-mode: standalone)').matches;
  if(installed||!(root.requestFullscreen||root.webkitRequestFullscreen))$('fullscreen').hidden=true;

  // Both selectors reflect the same explicit, persisted meter state.
  $('meterPreset').onchange=e=>setMeter(e.target.value?Number(e.target.value)*3+'/8':'4');
  syncMeterControls();

  // Named presets. Loading rewrites the saved settings and reloads, so sound stops cleanly.
  const store=()=>{try{return JSON.parse(localStorage.getItem('webharmodi-presets')||'{}')||{};}catch{return {};}};
  const draw=sel=>{const all=store(),select=$('presetSelect');select.innerHTML='';
    const names=Object.keys(all);if(!names.length)select.append(new Option('保存したものはありません',''));
    names.forEach(n=>select.append(new Option(n,n)));if(sel&&all[sel])select.value=sel;};
  draw();
  $('presetSave').onclick=()=>{const name=(prompt('プリセット名（例：行進曲 6/8 ♩.=100）')||'').trim().slice(0,30);if(!name)return;
    persist();const all=store();try{all[name]=JSON.parse(localStorage.getItem('webharmodi-settings'));localStorage.setItem('webharmodi-presets',JSON.stringify(all));}catch{toast('保存できませんでした。');return;}
    draw(name);toast('「'+name+'」を保存しました。');};
  $('presetLoad').onclick=()=>{
    if(presetReloadPending)return;
    const all=store(),name=$('presetSelect').value;if(!all[name])return;
    try{localStorage.setItem('webharmodi-settings',JSON.stringify(all[name]));}
    catch{toast('読み込めませんでした。');return;}
    // Covers bubbling click/change events, queued saves and pagehide persistence.
    presetReloadPending=true;
    clearTimeout(saveTimer);
    location.reload();
  };
  $('presetDelete').onclick=()=>{const all=store(),name=$('presetSelect').value;if(!all[name]||!confirm('「'+name+'」を削除しますか？'))return;delete all[name];try{localStorage.setItem('webharmodi-presets',JSON.stringify(all));}catch{}draw();};
}
