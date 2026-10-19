import {audioContext} from './audio.js';
import {allClips,clipTiming,clipRate,clipEnd,layerGain,encodeWav,MAX_FILE_BYTES,MAX_DECODED_BYTES} from './layer-core.js';
import {processPCM,levelGain} from './audio-process.js';
const adjacent=(a,b)=>Math.abs(a-b)<.002;
export class LayerMixer {
  constructor(){this.layers=[];this.buffers=new Map();this.cache=new Map();this.levels=new WeakMap();this.nodes=[];this.volume=.85;this.bpm=90;this.smooth=true;this.ctx=null;this.master=null;this.limiter=null;this.prepareVersion=0;this.auditionClip=null;this.auditionTrack=null;}
  setLayers(layers){this.stop();this.layers=layers;}
  reset(layers=[]){this.setLayers(layers);this.buffers.clear();this.cache.clear();this.prepared=[];this.prepareVersion++;this.auditionClip=null;this.auditionTrack=null;}
  get ready(){return allClips(this.layers).some(clip=>this.buffers.has(clip.assetId));}
  get decodedBytes(){return [...this.buffers.values()].reduce((n,buffer)=>n+buffer.length*buffer.numberOfChannels*4,0);}
  async decode(file){
    if(!file.size)throw new Error('This audio file is empty.');
    if(file.size>MAX_FILE_BYTES)throw new Error('Choose audio files smaller than 30 MB each.');
    const ctx=await audioContext(false);let buffer;
    try{buffer=await ctx.decodeAudioData(await file.arrayBuffer());}catch(e){throw new Error('This file could not be decoded. Try PCM WAV, MP3, M4A, OGG, or FLAC supported by your browser.');}
    if(!buffer.duration||buffer.duration>600)throw new Error('Keep each source recording to ten minutes or fewer.');
    if(buffer.length*buffer.numberOfChannels*4+this.decodedBytes>MAX_DECODED_BYTES)throw new Error('These sources use too much audio memory. Reopen the song after deleting unused clips, or use shorter files.');
    return buffer;
  }
  plan(end){
    const entries=[];
    for(const track of this.layers){
      const clips=[...track.clips].sort((a,b)=>a.start-b.start);
      for(const clip of clips)entries.push({track,clip,end:clipEnd(clip,end,track,this.bpm),tail:0,connectedIn:false,connectedOut:false,joinIn:false});
    }
    for(const entry of entries){
      const next=entries.find(e=>e.track===entry.track&&e.clip!==entry.clip&&adjacent(e.clip.start,entry.end));if(!next)continue;
      const a=entry.clip,b=next.clip;
      const continuous=a.assetId===b.assetId&&!a.loop&&!b.loop&&a.reverse===b.reverse&&adjacent(clipRate(a,this.bpm),1)&&adjacent(clipRate(b,this.bpm),1)&&a.volume===b.volume&&a.autoLevel===b.autoLevel&&a.muted===b.muted&&adjacent(a.reverse?a.trimStart:a.trimEnd,b.reverse?b.trimEnd:b.trimStart)&&!a.fadeOut&&!b.fadeIn;
      if(continuous){entry.connectedOut=true;next.connectedIn=true;}
      else if(this.smooth&&!a.fadeOut){entry.tail=Math.min(.025,(entry.end-a.start)/4,(next.end-b.start)/4);next.joinIn=entry.tail;}
    }
    return entries;
  }
  async process(buffer,options){
    const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i).slice());
    if(typeof Worker==='undefined')return processPCM(channels,buffer.sampleRate,options);
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./audio-process.js',import.meta.url),{type:'module'});
      worker.onmessage=event=>{worker.terminate();event.data.error?reject(new Error(event.data.error)):resolve(event.data);};
      worker.onerror=()=>{worker.terminate();reject(new Error('Audio processing could not start. Reload the page and try again.'));};
      worker.postMessage({channels,sampleRate:buffer.sampleRate,options},channels.map(channel=>channel.buffer));
    });
  }
  async prepare(ctx,end){
    const version=++this.prepareVersion,entries=this.plan(end),cache=new Map();let processedBytes=0;
    for(const entry of entries){
      const {clip}=entry,buffer=this.buffers.get(clip.assetId);if(!buffer)continue;
      const rate=clipRate(clip,this.bpm),timing=clipTiming(clip,buffer.duration,this.bpm),options={from:timing.from,to:timing.to,rate,reverse:clip.reverse,smoothLoop:this.smooth&&clip.loop,tailSeconds:clip.loop?0:entry.tail};
      const key=JSON.stringify([clip.assetId,options]),needsProcess=clip.reverse||Math.abs(rate-1)>.000001||options.smoothLoop||options.tailSeconds>0;
      let prepared=cache.get(key)||this.cache.get(key);
      if(!prepared){
        if(needsProcess){
          const estimate=(timing.length+entry.tail)*buffer.sampleRate*Math.min(2,buffer.numberOfChannels)*4;
          if(processedBytes+estimate>MAX_DECODED_BYTES)throw new Error('This tempo needs too much audio memory. Trim long clips or use a smaller tempo change.');
          const result=await this.process(buffer,options);if(version!==this.prepareVersion)return false;
          const output=ctx.createBuffer(result.channels.length,result.channels[0].length,buffer.sampleRate);result.channels.forEach((channel,i)=>output.copyToChannel(channel,i));
          prepared={buffer:output,offset:0,cycle:result.cycle,tail:result.tail};
        }else prepared={buffer,offset:timing.from,cycle:timing.length,tail:0};
      }
      if(!cache.has(key)&&needsProcess)processedBytes+=prepared.buffer.length*prepared.buffer.numberOfChannels*4;
      cache.set(key,prepared);const joinTail=entry.tail;Object.assign(entry,prepared);if(clip.loop)entry.tail=joinTail;
      if(!this.levels.has(buffer))this.levels.set(buffer,levelGain(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i))));
      entry.autoGain=clip.autoLevel?this.levels.get(buffer):1;
    }
    if(version!==this.prepareVersion)return false;
    this.cache=cache;this.prepared=entries;return true;
  }
  connect(ctx){
    if(this.ctx===ctx&&this.master){this.master.gain.setValueAtTime(this.volume,ctx.currentTime);return;}
    this.master?.disconnect();this.limiter?.disconnect();this.ctx=ctx;this.master=ctx.createGain();this.master.gain.value=this.volume;
    this.limiter=ctx.createDynamicsCompressor();this.limiter.threshold.value=-1;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.003;this.limiter.release.value=.08;this.master.connect(this.limiter);this.limiter.connect(ctx.destination);
  }
  envelope(param,entry,start,end,when){
    const {clip}=entry,span=end-clip.start,fadeIn=Math.min(span/2,Math.max(clip.fadeIn,this.smooth?(entry.joinIn|| (entry.connectedIn?0:.005)):0)),fadeOut=Math.min(span/2,Math.max(clip.fadeOut,this.smooth?(entry.tail|| (entry.connectedOut?0:.008)):0));
    const value=t=>Math.max(0,Math.min(1,fadeIn?(t-clip.start)/fadeIn:1,fadeOut?(end-t)/fadeOut:1));
    param.setValueAtTime(start>clip.start+.001?0:value(start),when);
    const attackEnd=Math.min(end,start+.004);if(start>clip.start+.001)param.linearRampToValueAtTime(value(attackEnd),when+attackEnd-start);
    const points=[clip.start+fadeIn,end-fadeOut,end].filter(t=>t>Math.max(start,start>clip.start+.001?attackEnd:start)+.000001).sort((a,b)=>a-b);
    for(const t of [...new Set(points)])param.linearRampToValueAtTime(value(t),when+t-start);
  }
  play(ctx,position,end){
    this.stop();this.connect(ctx);const now=ctx.currentTime;
    for(const entry of this.prepared||[]){
      const {clip,track,buffer}=entry;if(!buffer||this.auditionClip&&clip.id!==this.auditionClip||this.auditionTrack&&track.id!==this.auditionTrack)continue;
      const stop=Math.min(end,entry.end+entry.tail),start=Math.max(position,clip.start);if(start>=stop-.00001)continue;
      const source=ctx.createBufferSource(),envelope=ctx.createGain(),gain=ctx.createGain();source.buffer=buffer;gain.gain.value=this.clipGain(track,clip)*entry.autoGain;
      source.connect(envelope);envelope.connect(gain);let pan=null;
      if(ctx.createStereoPanner){pan=ctx.createStereoPanner();pan.pan.value=track.pan;gain.connect(pan);pan.connect(this.master);}else gain.connect(this.master);
      source.loop=clip.loop;source.loopStart=entry.offset;source.loopEnd=entry.offset+entry.cycle;
      const when=now+Math.max(0,start-position),elapsed=Math.max(0,start-clip.start),phase=(clip.phase||0)/clipRate(clip,this.bpm),offset=entry.offset+(clip.loop?(elapsed+phase)%entry.cycle:elapsed);
      this.envelope(envelope.gain,entry,start,Math.min(end,entry.end+entry.tail),when);
      const node={trackId:track.id,clipId:clip.id,source,envelope,gain,pan,autoGain:entry.autoGain};
      source.onended=()=>{source.disconnect();envelope.disconnect();gain.disconnect();pan?.disconnect();this.nodes=this.nodes.filter(n=>n!==node);};
      source.start(when,offset);source.stop(when+stop-start);this.nodes.push(node);
    }
  }
  clipGain(track,clip){const audition=this.auditionClip||this.auditionTrack;return (audition?track.volume:layerGain(track,this.layers))*(clip.muted&&!audition?0:clip.volume);}
  syncGains(){
    for(const node of this.nodes){const track=this.layers.find(item=>item.id===node.trackId),clip=track?.clips.find(item=>item.id===node.clipId);if(!clip)continue;const buffer=this.buffers.get(clip.assetId);node.autoGain=clip.autoLevel?(this.levels.get(buffer)||1):1;node.gain.gain.setTargetAtTime(this.clipGain(track,clip)*node.autoGain,this.ctx.currentTime,.012);node.pan?.pan.setTargetAtTime(track.pan,this.ctx.currentTime,.012);}
    if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.012);
  }
  stop(){
    for(const node of this.nodes){try{const now=this.ctx?.currentTime||0;if(node.envelope.gain.cancelAndHoldAtTime)node.envelope.gain.cancelAndHoldAtTime(now);else {const v=node.envelope.gain.value;node.envelope.gain.cancelScheduledValues(now);node.envelope.gain.setValueAtTime(v,now);}node.envelope.gain.linearRampToValueAtTime(0,now+.006);node.source.stop(now+.008);}catch(e){try{node.source.stop();}catch(e){}}}
    this.nodes=[];
  }
  async exportWav(length){
    const audible=this.layers.flatMap(track=>track.clips.filter(clip=>layerGain(track,this.layers)>0&&!clip.muted&&clip.volume>0));
    if(!audible.length||!this.ready)throw new Error('Import and unmute a clip before exporting.');
    if(audible.some(clip=>!this.buffers.has(clip.assetId)))throw new Error('Relink or mute missing clips before exporting your mix.');
    if(length>600)throw new Error('WAV mix exports support sessions up to ten minutes.');
    const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;if(!Offline)throw new Error('Audio mix export is unavailable in this browser.');
    const rate=44100,ctx=new Offline(2,Math.max(1,Math.ceil(length*rate)),rate),offline=new LayerMixer();offline.layers=this.layers;offline.buffers=this.buffers;offline.cache=this.cache;offline.levels=this.levels;offline.volume=this.volume;offline.bpm=this.bpm;offline.smooth=this.smooth;
    await offline.prepare(ctx,length);offline.play(ctx,0,length);try{return encodeWav(await ctx.startRendering());}finally{offline.stop();}
  }
}
