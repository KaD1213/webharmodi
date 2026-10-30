// `beats` counts quarters in simple meters, dotted quarters in compound meters.
export function restoreMeter(state,saved){
  state.meterDenominator=saved.meterDenominator===8&&[2,3,4].includes(state.beats)&&state.rhythmMode===3?8:4;
}
export function chooseMeter(state,value){
  if(['6/8','9/8','12/8'].includes(String(value))){
    state.meterDenominator=8;state.beats=Number(String(value).split('/')[0])/3;state.rhythmMode=3;
  }else{
    const wasCompound=state.meterDenominator===8;
    state.meterDenominator=4;state.beats=Math.max(1,Math.min(12,Math.round(Number(value)||4)));
    if(wasCompound)state.rhythmMode=1;
  }
}
export function chooseRhythm(state,value){
  state.rhythmMode=value;
  if(value!==3)state.meterDenominator=4;
}
export function meterView(state){
  const compound=state.meterDenominator===8;
  return {selection:compound?state.beats*3+'/8':String(state.beats),preset:compound?String(state.beats):'',
    label:compound?state.beats*3+'/8 · 付点4分音符 = BPM':state.beats+'/4 · 4分音符 = BPM'};
}
