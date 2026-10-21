/** Ideal steady mechanical pendulum, theta'' = -sin(theta).
 * Finite-amplitude waveform, numerically integrated with velocity Verlet.
 * BPM sets the period; the escapement is idealized as maintaining amplitude.
 * phase 0,1,2... is each quarter-note beat near the central crossing.
 */
const curves=new Map();
function quarterCurve(degrees){
  if(curves.has(degrees))return curves.get(degrees);
  const amplitude=degrees*Math.PI/180,dt=1/2000;
  let angle=amplitude,velocity=0,time=0;
  const points=[{time,angle}];
  while(angle>0&&time<3){
    const half=velocity-.5*Math.sin(angle)*dt;
    angle+=half*dt;velocity=half-.5*Math.sin(angle)*dt;time+=dt;
    points.push({time,angle});
  }
  const last=points.at(-1),before=points.at(-2);
  const crossing=before.time+(last.time-before.time)*before.angle/(before.angle-last.angle);
  const curve=new Float64Array(257);let index=0;
  for(let i=0;i<=256;i++){
    const t=crossing*i/256;
    while(index<points.length-2&&points[index+1].time<t)index++;
    const a=points[index],b=points[index+1];
    curve[i]=Math.max(0,(a.angle+(b.angle-a.angle)*(t-a.time)/(b.time-a.time))*180/Math.PI);
  }
  curve[0]=degrees;curve[256]=0;curves.set(degrees,curve);return curve;
}
export function pendulumAngleAtPhase(phase,amplitude=38){
  if(!Number.isFinite(phase)||!Number.isFinite(amplitude)||amplitude<=0||amplitude>=90)return 0;
  const cycle=((phase%2)+2)%2,quarter=Math.floor(cycle*2),progress=cycle*2-quarter;
  const position=(quarter%2===0?1-progress:progress)*256;
  const index=Math.min(255,Math.floor(position)),curve=quarterCurve(amplitude);
  const angle=curve[index]+(curve[index+1]-curve[index])*(position-index);
  return (quarter<2?-1:1)*angle;
}
