// YIN difference function with a confidence gate. No browser dependencies.
export function detectPitch(samples,sampleRate){
 let energy=0;for(const v of samples)energy+=v*v;
 const rms=Math.sqrt(energy/samples.length);if(rms<.006)return null;
 const min=Math.max(2,Math.floor(sampleRate/1800)),max=Math.min(Math.floor(sampleRate/50),Math.floor(samples.length/2)-1),n=samples.length-max;
 const difference=new Float64Array(max+1);let sum=0;
 for(let lag=1;lag<=max;lag++){
  let d=0;for(let i=0;i<n;i++){const delta=samples[i]-samples[i+lag];d+=delta*delta;}
  sum+=d;difference[lag]=sum?d*lag/sum:1;
 }
 let lag=-1;for(let i=min;i<max;i++)if(difference[i]<.12){while(i+1<=max&&difference[i+1]<difference[i])i++;lag=i;break;}
 if(lag<0||difference[lag]>.18)return null;
 const left=difference[lag-1],mid=difference[lag],right=difference[lag+1]??mid;
 const divisor=left-2*mid+right;
 const refined=lag+(Math.abs(divisor)>1e-12?.5*(left-right)/divisor:0);
 return {frequency:sampleRate/refined,confidence:1-mid,rms};
}
