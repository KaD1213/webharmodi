/** Tap intervals in milliseconds. Stable taps are averaged; a new pace resets history. */
export class TapTempo {
  constructor(){this.reset();}
  reset(){this.lastTap=null;this.intervals=[];}
  tap(now){
    if(!Number.isFinite(now))return null;
    if(this.lastTap===null){this.lastTap=now;return null;}
    const interval=now-this.lastTap;
    // Ignore an accidental bounce without moving the last valid tap.
    if(interval<180)return null;
    this.lastTap=now;
    if(interval>2000){this.intervals=[];return null;}
    const sorted=[...this.intervals].sort((a,b)=>a-b);
    const middle=Math.floor(sorted.length/2);
    const median=sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
    // A substantial tempo change starts a new estimate immediately instead of
    // mixing old 60 BPM intervals into a newly tapped 120 BPM pattern.
    if(sorted.length&&Math.abs(interval-median)>median*.2)this.intervals=[];
    this.intervals.push(interval);this.intervals=this.intervals.slice(-5);
    const mean=this.intervals.reduce((sum,value)=>sum+value,0)/this.intervals.length;
    return Math.round(Math.max(40,Math.min(208,60000/mean)));
  }
}
