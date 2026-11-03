export function createRecordingWaveform(canvas) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return {start(){}, stop(){}};
  let context;
  try { context = new Audio({latencyHint:'interactive'}); } catch { return {start(){},stop(){}}; }
  // Resume inside the record-button gesture, before waiting for microphone permission.
  const ready = context.resume().catch(()=>{});
  let source, analyser, frame=0, stopped=false, last=0;
  const bars=[];
  function stop(){
    stopped=true;cancelAnimationFrame(frame);source?.disconnect();
    context.close().catch(()=>{});canvas.hidden=true;
  }
  async function start(stream){
    await ready;
    if(stopped)return;
    try {
      source=context.createMediaStreamSource(stream);
      analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
      const samples=new Float32Array(analyser.fftSize);
      canvas.hidden=false;
      const paint=now=>{
        if(stopped)return;
        if(now-last>=65){
          last=now;analyser.getFloatTimeDomainData(samples);
          let energy=0;for(const sample of samples)energy+=sample*sample;
          const rms=Math.sqrt(energy/samples.length);
          bars.push(Math.min(1,Math.sqrt(rms)*2.4));
          const width=canvas.clientWidth,height=canvas.clientHeight;
          const count=Math.max(1,Math.floor(width/6));
          if(bars.length>count)bars.splice(0,bars.length-count);
          const ratio=Math.min(window.devicePixelRatio||1,2);
          canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
          const g=canvas.getContext('2d');g.scale(ratio,ratio);
          g.strokeStyle='#ed4452';g.lineWidth=3;g.lineCap='round';
          const offset=width-bars.length*6+3;
          for(let i=0;i<bars.length;i++){
            const length=Math.max(2,bars[i]*(height-14)),x=offset+i*6;
            g.beginPath();g.moveTo(x,(height-length)/2);g.lineTo(x,(height+length)/2);g.stroke();
          }
        }
        frame=requestAnimationFrame(paint);
      };
      frame=requestAnimationFrame(paint);
    }catch{stop();}
  }
  return {start,stop};
}
