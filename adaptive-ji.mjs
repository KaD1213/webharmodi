/** Adaptive just intonation. No dependencies; browser ES module / Node.js. */
const pc = n => ((n % 12) + 12) % 12;
const names = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const template = (type, intervals, ratios) => ({type, intervals, ratios});
// Ratios are an explicit musical policy, not a universal definition of JI.
const templates = [
  template('maj', [0,4,7], [1,5/4,3/2]),
  template('min', [0,3,7], [1,6/5,3/2]),
  template('7', [0,4,7,10], [1,5/4,3/2,7/4]),
  template('maj7', [0,4,7,11], [1,5/4,3/2,15/8]),
  template('min7', [0,3,7,10], [1,6/5,3/2,9/5]),
  template('dim', [0,3,6], [1,6/5,7/5]),
  template('m7b5', [0,3,6,10], [1,6/5,7/5,9/5]),
  template('sus2', [0,2,7], [1,9/8,3/2]),
  template('sus4', [0,5,7], [1,4/3,3/2]),
];
const diatonic = {
  major: [[0,'maj'],[2,'min'],[4,'min'],[5,'maj'],[7,'maj'],[9,'min'],[11,'dim'],[7,'7']],
  minor: [[0,'min'],[2,'dim'],[3,'maj'],[5,'min'],[7,'min'],[8,'maj'],[10,'maj'],[7,'7']],
};
export const ratioToCents = (ratio, semitones) => 1200*Math.log2(ratio)-100*semitones;

export class AdaptiveJustIntonation {
  constructor({a4=440, key=0, mode='major', movementWeight=.12,
    switchThreshold=2, maxMissing=2}={}) {
    if (!(a4>0 && Number.isFinite(a4))) throw new RangeError('Invalid a4');
    if (!(movementWeight>=0 && Number.isFinite(movementWeight)) ||
        !(switchThreshold>=0 && Number.isFinite(switchThreshold)) ||
        !Number.isInteger(maxMissing) || maxMissing<0) throw new RangeError('Invalid costs');
    this.a4=a4; this.movementWeight=movementWeight;
    this.switchThreshold=switchThreshold; this.maxMissing=maxMissing;
    this.setKey(key, mode); this.reset();
  }
  setKey(key, mode='major') {
    if (!Number.isInteger(key) || !diatonic[mode]) throw new RangeError('Invalid key/mode');
    this.key=pc(key); this.mode=mode;
  }
  reset() { this.previous=null; this.previousCents=new Map(); }

  /** Call with sounding MIDI notes on EVERY note-on/off, including hold changes.
   * Root stays at equal temperament: no accumulating global pitch drift.
   * Costs choose the chord; smoothing the audio is a separate operation below.
   */
  update(input) {
    if (!Array.isArray(input) || input.some(n=>!Number.isInteger(n)||n<0||n>127))
      throw new RangeError('Expected an array of integer MIDI notes 0..127');
    const notes=[...new Set(input)].sort((a,b)=>a-b);
    if (!notes.length) { this.reset(); return this.result([],null,[],false); }
    const pcs=[...new Set(notes.map(pc))];
    // Melodic notes and octave doublings use the explicitly selected key.
    // Clear chord history so the old chord's role cannot override the melody.
    if (pcs.length===1) {
      const ratios=this.mode==='minor'
        ?[1,16/15,10/9,6/5,5/4,4/3,45/32,3/2,8/5,5/3,16/9,15/8]
        :[1,16/15,9/8,6/5,5/4,4/3,45/32,3/2,8/5,5/3,9/5,15/8];
      const cents=Object.fromEntries(notes.map(n=>{
        const interval=pc(n-this.key);
        return [n,ratioToCents(ratios[interval],interval)];
      }));
      this.previous=null;
      this.previousCents=new Map(notes.map(n=>[n,cents[n]]));
      return this.result(notes,null,[],true,cents);
    }
    const candidates=[];
    for (let root=0;root<12;root++) for (const t of templates) {
      const rel=pcs.map(n=>pc(n-root));
      // Never silently force non-chord notes into a convenient template.
      if (rel.some(i=>!t.intervals.includes(i))) continue;
      const missing=t.intervals.filter(i=>!rel.includes(i));
      if (missing.length>this.maxMissing) continue;
      const cents=Object.fromEntries(notes.map(n=>{
        const interval=pc(n-root), index=t.intervals.indexOf(interval);
        return [n,ratioToCents(t.ratios[index],interval)];
      }));
      // Compare held pitches only. Do not match octave doublings by pitch class.
      const held=notes.filter(n=>this.previousCents.has(n));
      const movement=held.length?Math.sqrt(held.reduce((s,n)=>
        s+(cents[n]-this.previousCents.get(n))**2,0)/held.length):0;
      const inKey=diatonic[this.mode].some(([offset,type])=>
        pc(this.key+offset)===root && type===t.type);
      const rootMissing=!rel.includes(0);
      // Structure dominates; context is a soft prior, never a forced key lock.
      const structure=missing.length*4+(rootMissing?2:0);
      const context=inKey?-3:0;
      const bassPenalty=pc(notes[0])===root?0:.25; // very weak inversion preference
      const continuity=this.previous?.id===`${root}:${t.type}`?-4:0;
      const score=structure+context+bassPenalty+continuity+this.movementWeight*movement;
      candidates.push({id:`${root}:${t.type}`,root,type:t.type,
        name:names[root]+(t.type==='maj'?'':t.type==='min'?'m':t.type),
        bass:pc(notes[0]),rootMissing,missing,cents,movement,score});
    }
    candidates.sort((a,b)=>a.score-b.score || a.root-b.root || a.type.localeCompare(b.type));
    if (!candidates.length) {
      // Correct only recognized chords; an unknown cluster remains at ET.
      const cents=Object.fromEntries(notes.map(n=>[n,0]));
      this.previous=null; this.previousCents=new Map(notes.map(n=>[n,cents[n]]));
      return this.result(notes,null,[],true,cents);
    }
    let chosen=candidates[0];
    const previous=candidates.find(c=>c.id===this.previous?.id);
    // Hysteresis: change only when the new candidate wins by enough cost units.
    // An incompatible old chord is never retained merely to avoid retuning.
    if(previous && previous.score-chosen.score<=this.switchThreshold) chosen=previous;
    const alternative=candidates.find(c=>c.id!==chosen.id);
    const ambiguous=pcs.length<3 || Boolean(alternative&&Math.abs(alternative.score-chosen.score)<2);
    this.previous=chosen; this.previousCents=new Map(notes.map(n=>[n,chosen.cents[n]]));
    return this.result(notes,chosen,candidates,ambiguous);
  }
  result(notes,chosen,candidates,ambiguous,cents=chosen?.cents??{}) {
    return {
      chord:chosen?{name:chosen.name,root:chosen.root,type:chosen.type,
        bass:chosen.bass,rootMissing:chosen.rootMissing}:null,
      ambiguous,
      // The candidate list exposes ambiguity; scores are costs, not probabilities.
      candidates:candidates.slice(0,6).map(c=>({name:c.name,root:c.root,
        type:c.type,score:c.score,movementCents:c.movement})),
      cents,
      frequencies:Object.fromEntries(notes.map(n=>[n,this.a4*2**((n-69)/12+cents[n]/1200)])),
    };
  }
}

/** voices: Map<MIDI note, {osc: OscillatorNode}>.
 * Each oscillator's base frequency must already be ET at the same a4.
 * Call update() once per event, then apply() to ALL sounding voices.
 * Set a newly created oscillator's detune before starting it to avoid an attack glide.
 */
export function applyJustIntonation(result, voices, audioContext, {tau=.025}={}) {
  if (!(tau>0 && Number.isFinite(tau))) throw new RangeError('tau must be positive');
  const now=audioContext.currentTime;
  for(const [midi,{osc}] of voices) {
    const cents=result.cents[midi];
    if(cents===undefined) continue;
    const param=osc.detune;
    if(typeof param.cancelAndHoldAtTime==='function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    // ~95% of the transition completes in 3*tau (75 ms by default).
    param.setTargetAtTime(cents,now,tau);
  }
}
