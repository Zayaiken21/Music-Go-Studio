// Shared timing and PCM helpers for playback and exports.
const limit=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
export const MAX_LAYERS=12;
export const MAX_FILE_BYTES=30*1024*1024;
export const MAX_DECODED_BYTES=192*1024*1024;
export function normalizeLayer(raw={}) {
  const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
  const duration=limit(raw.duration,.01,600,.01);
  const trimStart=limit(raw.trimStart,0,Math.max(0,duration-.01),0);
  return {id:text(raw.id,100),assetId:text(raw.assetId,100),name:text(raw.name,200)||'Audio layer',filename:text(raw.filename,240)||'audio.wav',duration,start:limit(raw.start,0,1800,0),trimStart,trimEnd:limit(raw.trimEnd,trimStart+.01,duration,duration),volume:limit(raw.volume,0,1.5,.8),pan:limit(raw.pan,-1,1,0),muted:raw.muted===true,solo:raw.solo===true,loop:raw.loop===true};
}
export function clipTiming(layer,bufferDuration=layer.duration) {
  const duration=Math.max(.01,Number(bufferDuration)||.01);
  const from=Math.max(0,Math.min(duration-.01,Number(layer.trimStart)||0));
  const to=Math.max(from+.01,Math.min(duration,Number(layer.trimEnd)||duration));
  return {from,to,length:to-from,start:Math.max(0,Number(layer.start)||0)};
}
export function sessionLength(guideSeconds,layers=[]) {return Math.max(Number(guideSeconds)||0,...layers.map(layer=>{const clip=clipTiming(layer);return clip.start+clip.length;}));}
export function layerGain(layer,layers) {return layer.muted||(layers.some(track=>track.solo)&&!layer.solo)?0:layer.volume;}
export function scheduleClip(layer,bufferDuration,position,sessionEnd) {
  const clip=clipTiming(layer,bufferDuration),end=layer.loop?sessionEnd:Math.min(sessionEnd,clip.start+clip.length),start=Math.max(position,clip.start);
  if(start>=end-.00001)return null;
  const elapsed=Math.max(0,start-clip.start);
  return {delay:Math.max(0,start-position),offset:clip.from+(layer.loop?elapsed%clip.length:elapsed),duration:end-start,loop:layer.loop,loopStart:clip.from,loopEnd:clip.to};
}
export function waveformPeaks(buffer,bins=100) {
  const samples=buffer.getChannelData(0),step=Math.max(1,Math.floor(samples.length/bins)),result=[];
  for(let bin=0;bin<bins;bin++){let peak=0;const start=bin*step,end=bin===bins-1?samples.length:Math.min(samples.length,start+step);for(let i=start;i<end;i++)peak=Math.max(peak,Math.abs(samples[i]));result.push(peak);}
  return result;
}
export function encodeWav(buffer) {
  const channels=Math.min(2,buffer.numberOfChannels),frames=buffer.length,bytes=frames*channels*2,output=new ArrayBuffer(44+bytes),view=new DataView(output);
  const write=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,36+bytes,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,bytes,true);
  const data=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
  let peak=1;for(const channel of data)for(let i=0;i<frames;i++)if(Number.isFinite(channel[i]))peak=Math.max(peak,Math.abs(channel[i]));
  const scale=peak>1?.98/peak:1;let offset=44;
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){const value=Number.isFinite(data[c][i])?Math.max(-1,Math.min(1,data[c][i]*scale)):0;view.setInt16(offset,Math.round(value*(value<0?32768:32767)),true);offset+=2;}
  return new Blob([output],{type:'audio/wav'});
}
