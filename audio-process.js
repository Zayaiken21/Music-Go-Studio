// Stereo-linked waveform similarity overlap-add. Grains retain their original
// sample rate (and pitch); only their placement changes the duration.
export function stretchPCM(channels,rate,sampleRate) {
  if(!Number.isFinite(rate)||rate<=0)throw new Error('Invalid audio tempo.');
  const n=channels[0].length,target=Math.max(1,Math.round(n/rate));
  if(Math.abs(rate-1)<.000001)return channels.map(c=>c.slice());
  const output=channels.map(()=>new Float32Array(target));
  const hop=Math.max(16,Math.round(sampleRate*.02)),frame=hop*2,search=Math.round(sampleRate*.012);
  if(n<frame*2){for(let c=0;c<channels.length;c++)for(let i=0;i<target;i++)output[c][i]=channels[c][Math.min(n-1,Math.round(i*rate))]||0;return output;}
  let reference=0,highest=0;
  channels.forEach((channel,c)=>{let energy=0;for(let i=0;i<n;i+=64)energy+=channel[i]*channel[i];if(energy>highest){reference=c;highest=energy;}});
  for(let c=0;c<channels.length;c++)output[c].set(channels[c].subarray(0,Math.min(frame,target)));
  const input=channels[reference],ref=output[reference];
  for(let pos=hop;pos<target;pos+=hop){
    const expected=Math.min(n-frame,Math.round(pos*rate)),lo=Math.max(0,expected-search),hi=Math.min(n-frame,expected+search),overlap=Math.min(hop,target-pos);
    let best=expected,bestScore=-Infinity;
    const score=offset=>{let xy=0,xx=0,yy=0;for(let j=0;j<overlap;j+=8){const a=ref[pos+j],b=input[offset+j];xy+=a*b;xx+=a*a;yy+=b*b;}return xy/Math.sqrt(xx*yy+1e-15)-.015*Math.abs(offset-expected)/Math.max(1,search);};
    for(let at=lo;at<=hi;at+=8){const value=score(at);if(value>bestScore){bestScore=value;best=at;}}
    const coarse=best;for(let at=Math.max(lo,coarse-7);at<=Math.min(hi,coarse+7);at++){const value=score(at);if(value>bestScore){bestScore=value;best=at;}}
    for(let c=0;c<channels.length;c++)for(let j=0;j<Math.min(frame,target-pos);j++){
      const value=channels[c][best+j]||0;
      if(j<hop){const mix=.5-.5*Math.cos(Math.PI*j/hop);output[c][pos+j]=output[c][pos+j]*(1-mix)+value*mix;}else output[c][pos+j]=value;
    }
  }
  return output;
}
export function levelGain(channels) {
  let squares=0,count=0,peak=0;
  for(const channel of channels)for(let i=0;i<channel.length;i++){const v=Number.isFinite(channel[i])?channel[i]:0;peak=Math.max(peak,Math.abs(v));if(i%8===0){squares+=v*v;count++;}}
  const rms=Math.sqrt(squares/Math.max(1,count));
  return rms<.0005||peak===0?1:Math.min(3,.16/rms,.92/peak);
}
export function processPCM(channels,sampleRate,options={}) {
  const n=channels[0].length,from=Math.max(0,Math.min(n-1,Math.round((options.from||0)*sampleRate))),to=Math.max(from+1,Math.min(n,Math.round((options.to??n/sampleRate)*sampleRate)));
  const segment=channels.map(c=>{const part=c.slice(from,to);if(options.reverse)part.reverse();return part;});
  let result=stretchPCM(segment,options.rate||1,sampleRate),length=result[0].length;
  const seam=options.smoothLoop?Math.min(Math.round(sampleRate*.035),Math.floor(length/8)):0;
  if(seam>1)for(const channel of result){const tail=channel.slice(length-seam);for(let i=0;i<seam;i++){const mix=.5-.5*Math.cos(Math.PI*i/(seam-1));channel[i]=tail[seam-1-i]*(1-mix)+channel[i]*mix;}}
  const tailFrames=Math.min(Math.floor(length/4),Math.round((options.tailSeconds||0)*sampleRate));
  if(tailFrames>0)result=result.map((channel,c)=>{const out=new Float32Array(length+tailFrames);out.set(channel);for(let i=0;i<tailFrames;i++){const real=to+i;out[length+i]=!options.reverse&&Math.abs((options.rate||1)-1)<.000001&&real<n?channels[c][real]:channel[length-1-i];}return out;});
  return {channels:result,cycle:length/sampleRate,tail:tailFrames/sampleRate};
}
// Called only inside the dedicated module worker; never detaches source assets.
if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope){
  globalThis.onmessage=event=>{try{const {channels,sampleRate,options}=event.data,result=processPCM(channels,sampleRate,options);globalThis.postMessage(result,result.channels.map(c=>c.buffer));}catch(error){globalThis.postMessage({error:error.message});}};
}
