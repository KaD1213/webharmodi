export function createKeyboardVoice(context, output, midi, reference, kind) {
  const now = context.currentTime;
  const fundamental = reference * 2 ** ((midi - 69) / 12);
  const gain = context.createGain();
  gain.connect(output);
  const sources = [], nodes = [];
  const piano = kind === 'Piano';
  const decay = Math.max(1.2, Math.min(7, 5 * 2 ** ((60 - midi) / 36)));
  // Each string partial has its own decay, so the attack loses brightness naturally.
  const partials = piano
    ? [1, .5, .28, .16, .1, .065, .04, .025].map((level, i) => ({ratio: (i+1)*Math.sqrt(1+.00012*(i+1)**2), level, decay: decay/(1+i*.48)}))
    : [{ratio:.5,level:.16},{ratio:1,level:.48},{ratio:2,level:.22},{ratio:3,level:.055},{ratio:4,level:.10},{ratio:6,level:.025},{ratio:8,level:.025}];
  const total = partials.reduce((sum, p) => sum+p.level, 0);
  for (const partial of partials) {
    if (fundamental*partial.ratio > context.sampleRate*.44) continue;
    const source = context.createOscillator(), envelope = context.createGain();
    source.frequency.value = fundamental*partial.ratio;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(partial.level/total, now+(piano?.003:.055));
    if (piano) {
      envelope.gain.exponentialRampToValueAtTime(partial.level/total*.45, now+.14);
      envelope.gain.exponentialRampToValueAtTime(.00001, now+partial.decay);
    }
    source.connect(envelope).connect(gain);
    sources.push(source);nodes.push(envelope);
  }
  // A slightly detuned companion string adds piano unison beating.
  if (piano && fundamental < context.sampleRate*.4) {
    const string=context.createOscillator(),envelope=context.createGain();
    string.frequency.value=fundamental*2**(1.4/1200);
    envelope.gain.setValueAtTime(0,now);envelope.gain.linearRampToValueAtTime(.13,now+.005);
    envelope.gain.exponentialRampToValueAtTime(.00001,now+decay);
    string.connect(envelope).connect(gain);sources.push(string);nodes.push(envelope);
  }
  gain.gain.value = piano ? .85 : .7;
  // Match the existing voice interface so chord retuning, hold and MIDI still work.
  const detune = {
    get value(){return sources[0].detune.value;},
    set value(value){for(const source of sources)source.detune.value=value;},
    cancelScheduledValues(time){for(const source of sources)source.detune.cancelScheduledValues(time);},
    setValueAtTime(value,time){for(const source of sources)source.detune.setValueAtTime(value,time);},
    setTargetAtTime(value,time,constant){for(const source of sources)source.detune.setTargetAtTime(value,time,constant);},
    linearRampToValueAtTime(value,time){for(const source of sources)source.detune.linearRampToValueAtTime(value,time);}
  };
  const osc = {
    detune, onended:null,
    start(){for(const source of sources)source.start();},
    stop(time){for(const source of sources)source.stop(time);},
    disconnect(){for(const source of sources)source.disconnect();for(const node of nodes)node.disconnect();}
  };
  sources[0].onended=()=>osc.onended?.();
  return {osc,gain,midi,started:false};
}
