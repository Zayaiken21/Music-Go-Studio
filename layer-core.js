// Nondestructive clip, track, and timeline helpers shared by the UI and mixer.
const limit=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const id=()=>globalThis.crypto?.randomUUID?.()||`audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const MAX_LAYERS=12,MAX_CLIPS=128;
export const MAX_FILE_BYTES=30*1024*1024,MAX_DECODED_BYTES=192*1024*1024;
export function normalizeClip(raw={},bpm=90) {
  const duration=limit(raw.duration,.01,600,.01),trimStart=limit(raw.trimStart,0,Math.max(0,duration-.01),0);
  return {id:text(raw.id,100)||id(),assetId:text(raw.assetId,100),name:text(raw.name,200)||'Audio clip',filename:text(raw.filename,240)||'audio.wav',duration,start:limit(raw.start,0,1800,0),trimStart,trimEnd:limit(raw.trimEnd,trimStart+.01,duration,duration),volume:limit(raw.volume,0,1.5,1),muted:raw.muted===true,loop:raw.loop===true,loopLength:limit(raw.loopLength,0,1800,0),phase:limit(raw.phase,0,600,0),fadeIn:limit(raw.fadeIn,0,10,0),fadeOut:limit(raw.fadeOut,0,10,0),reverse:raw.reverse===true,autoLevel:raw.autoLevel!==false,followTempo:raw.followTempo!==false,sourceBpm:limit(raw.sourceBpm,40,240,bpm),speed:limit(raw.speed,.5,2,1)};
}
export function normalizeLayer(raw={},bpm=90) {
  const legacy=!Array.isArray(raw.clips),clips=legacy?(raw.assetId?[{...raw,id:id(),volume:1,muted:false,loopLength:0}]:[]):raw.clips;
  return {id:text(raw.id,100)||id(),name:text(raw.name,200)||'Audio track',volume:limit(raw.volume,0,1.5,.8),pan:limit(raw.pan,-1,1,0),muted:raw.muted===true,solo:raw.solo===true,clips:clips.slice(0,MAX_CLIPS).filter(c=>c&&typeof c==='object').map(c=>normalizeClip(c,bpm)).sort((a,b)=>a.start-b.start)};
}
export function clipRate(clip,bpm=clip.sourceBpm||90) {return (clip.speed||1)*(clip.followTempo===false?1:bpm/(clip.sourceBpm||bpm));}
export function clipTiming(clip,bufferDuration=clip.duration,bpm=clip.sourceBpm||90) {
  const duration=Math.max(.01,Number(bufferDuration)||.01),from=limit(clip.trimStart,0,duration-.01,0),to=limit(clip.trimEnd,from+.01,duration,duration);
  return {from,to,length:(to-from)/clipRate(clip,bpm),start:Math.max(0,Number(clip.start)||0)};
}
export function clipEnd(clip,sessionEnd,track,bpm=90) {
  const timing=clipTiming(clip,clip.duration,bpm);
  if(!clip.loop)return clip.start+timing.length;
  if(clip.loopLength>0)return clip.start+clip.loopLength;
  const next=track?.clips.filter(c=>c.id!==clip.id&&c.start>clip.start+.0001).sort((a,b)=>a.start-b.start)[0];
  return Math.max(clip.start+.01,Math.min(next?.start??Infinity,Math.max(sessionEnd,clip.start+timing.length)));
}
export function allClips(tracks=[]) {return tracks.flatMap(track=>track.clips||[]);}
export function sessionLength(guideSeconds,tracks=[],bpm=90) {
  return Math.max(.01,Number(guideSeconds)||0,...allClips(tracks).map(clip=>clip.start+(clip.loop&&clip.loopLength>0?clip.loopLength:clipTiming(clip,clip.duration,bpm).length)));
}
export function layerGain(layer,layers) {return layer.muted||(layers.some(track=>track.solo)&&!layer.solo)?0:layer.volume;}
export function scheduleClip(clip,bufferDuration,position,sessionEnd,bpm=clip.sourceBpm||90,track) {
  const timing=clipTiming(clip,bufferDuration,bpm),end=Math.min(sessionEnd,clipEnd(clip,sessionEnd,track,bpm)),start=Math.max(position,clip.start);
  if(start>=end-.00001)return null;
  const elapsed=Math.max(0,start-clip.start),rate=clipRate(clip,bpm);
  return {delay:Math.max(0,start-position),offset:timing.from+(clip.loop?(elapsed*rate+(clip.phase||0))%(timing.to-timing.from):elapsed*rate),duration:end-start,loop:clip.loop,loopStart:timing.from,loopEnd:timing.to};
}
export function snapPosition(desired,length,clips,bpm,mode='beats',tolerance=.12,excludeId) {
  desired=Math.max(0,desired);if(mode==='off')return {start:desired,snapped:false};
  const edges=[0,...clips.filter(c=>c.id!==excludeId).flatMap(c=>[c.start,c.start+(c.loop&&c.loopLength>0?c.loopLength:clipTiming(c,c.duration,bpm).length)])];
  let best=null;
  for(const edge of edges)for(const start of [edge,edge-length])if(start>=0&&Math.abs(start-desired)<=tolerance&&(!best||Math.abs(start-desired)<best.distance))best={start,distance:Math.abs(start-desired),snapped:true};
  if(best)return best;
  if(mode==='beats'){const beat=60/bpm,start=Math.max(0,Math.round(desired/beat)*beat);if(Math.abs(start-desired)<=tolerance)return {start,snapped:true};}
  return {start:desired,snapped:false};
}
// Choose the closest free gap. Never overwrite, merge, or push an existing clip.
export function placeClip(clip,track,desired,bpm=90,mode='beats',tolerance=.12) {
  const length=clip.loop&&clip.loopLength>0?clip.loopLength:clipTiming(clip,clip.duration,bpm).length;
  const clips=track.clips.filter(c=>c.id!==clip.id).sort((a,b)=>a.start-b.start),snap=snapPosition(desired,length,clips,bpm,mode,tolerance,clip.id),gaps=[];
  let cursor=0;
  for(const other of clips){if(other.start-cursor>=length-.000001)gaps.push([cursor,other.start-length]);cursor=Math.max(cursor,other.start+(other.loop&&other.loopLength>0?other.loopLength:clipTiming(other,other.duration,bpm).length));}
  if(cursor<=1800)gaps.push([cursor,1800]);
  const candidates=gaps.filter(([a])=>a<=1800).map(([a,b])=>limit(snap.start,a,Math.min(b,1800),a));if(!candidates.length)return {start:clip.start,snapped:false,blocked:true};
  const start=candidates.reduce((a,b)=>Math.abs(b-snap.start)<Math.abs(a-snap.start)?b:a);
  return {start:Math.min(1800,Math.max(0,start)),snapped:Math.abs(start-snap.start)<.000001&&snap.snapped};
}
export function splitClip(clip,position,end,bpm=90,newId=id()) {
  if(position<=clip.start+.02||position>=end-.02)return null;
  const left={...clip},right={...clip,id:newId,start:position},rate=clipRate(clip,bpm),elapsed=(position-clip.start)*rate;
  left.fadeOut=0;right.fadeIn=0;
  if(clip.loop){left.loopLength=position-clip.start;right.loopLength=end-position;right.phase=((clip.phase||0)+elapsed)%(clip.trimEnd-clip.trimStart);}
  else if(clip.reverse){left.trimStart=clip.trimEnd-elapsed;right.trimEnd=left.trimStart;}
  else {left.trimEnd=clip.trimStart+elapsed;right.trimStart=left.trimEnd;}
  return [left,right];
}
export function trimClip(clip,edge,delta,bpm=90,span=clipTiming(clip,clip.duration,bpm).length) {
  const result={...clip},rate=clipRate(clip,bpm);
  if(clip.loop){if(edge==='left'){delta=limit(delta,-clip.start,span-.02,0);result.start+=delta;result.phase=((clip.phase||0)+delta*rate+600*(clip.trimEnd-clip.trimStart))%(clip.trimEnd-clip.trimStart);result.loopLength=span-delta;}else result.loopLength=limit(span+delta,.02,1800,span);return result;}
  if(edge==='left'){
    delta=limit(delta,Math.max(-clip.start,-(clip.reverse?clip.duration-clip.trimEnd:clip.trimStart)/rate),span-.02,0);result.start+=delta;
    if(clip.reverse)result.trimEnd-=delta*rate;else result.trimStart+=delta*rate;
  }else {delta=limit(delta,-span+.02,(clip.reverse?clip.trimStart:clip.duration-clip.trimEnd)/rate,0);if(clip.reverse)result.trimStart-=delta*rate;else result.trimEnd+=delta*rate;}
  return normalizeClip(result,bpm);
}
export function rescaleArrangement(tracks,oldBpm,newBpm) {
  const ratio=oldBpm/newBpm;
  for(const track of tracks){track.clips.sort((a,b)=>a.start-b.start);let end=0;for(const clip of track.clips){clip.start=Math.max(end,clip.start*ratio);if(clip.loopLength>0&&clip.followTempo!==false)clip.loopLength*=ratio;end=clip.start+(clip.loop&&clip.loopLength>0?clip.loopLength:clipTiming(clip,clip.duration,newBpm).length);}}
}
export function waveformPeaks(buffer,bins=160) {
  const samples=buffer.getChannelData(0),result=[];
  for(let bin=0;bin<bins;bin++){let peak=0;const start=Math.floor(bin*samples.length/bins),end=Math.max(start+1,Math.floor((bin+1)*samples.length/bins));for(let i=start;i<Math.min(samples.length,end);i++)peak=Math.max(peak,Math.abs(samples[i]));result.push(peak);}
  return result;
}
export function encodeWav(buffer) {
  const channels=Math.min(2,buffer.numberOfChannels),frames=buffer.length,bytes=frames*channels*2,output=new ArrayBuffer(44+bytes),view=new DataView(output);
  const write=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  write(0,'RIFF');view.setUint32(4,36+bytes,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,bytes,true);
  const data=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));let peak=1;for(const channel of data)for(let i=0;i<frames;i++)if(Number.isFinite(channel[i]))peak=Math.max(peak,Math.abs(channel[i]));
  const scale=peak>1?.98/peak:1;let offset=44;for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){const value=Number.isFinite(data[c][i])?Math.max(-1,Math.min(1,data[c][i]*scale)):0;view.setInt16(offset,Math.round(value*(value<0?32768:32767)),true);offset+=2;}
  return new Blob([output],{type:'audio/wav'});
}
