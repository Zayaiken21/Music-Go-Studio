import {audioContext} from './audio.js';
import {layerGain,scheduleClip,encodeWav,MAX_FILE_BYTES,MAX_DECODED_BYTES} from './layer-core.js';
export class LayerMixer {
  constructor() {this.layers=[];this.buffers=new Map();this.nodes=[];this.volume=.85;this.ctx=null;this.master=null;this.limiter=null;}
  setLayers(layers) {this.stop();this.layers=layers;}
  reset(layers=[]) {this.setLayers(layers);this.buffers.clear();}
  get ready() {return this.layers.some(layer=>this.buffers.has(layer.assetId));}
  get decodedBytes() {return [...this.buffers.values()].reduce((n,buffer)=>n+buffer.length*buffer.numberOfChannels*4,0);}
  async decode(file) {
    if(!file.size)throw new Error('This audio file is empty.');
    if(file.size>MAX_FILE_BYTES)throw new Error('Choose audio files smaller than 30 MB each.');
    const ctx=await audioContext(false);let buffer;
    try{buffer=await ctx.decodeAudioData(await file.arrayBuffer());}catch(e){throw new Error('This file could not be decoded. Try PCM WAV, MP3, M4A, OGG, or FLAC supported by your browser.');}
    if(!buffer.duration||buffer.duration>600)throw new Error('Keep each audio layer to ten minutes or fewer.');
    if(buffer.length*buffer.numberOfChannels*4+this.decodedBytes>MAX_DECODED_BYTES)throw new Error('These layers use too much audio memory. Remove a layer or import a shorter clip.');
    return buffer;
  }
  connect(ctx) {
    if(this.ctx===ctx&&this.master){this.master.gain.value=this.volume;return;}
    this.ctx=ctx;this.master=ctx.createGain();this.master.gain.value=this.volume;
    this.limiter=ctx.createDynamicsCompressor();this.limiter.threshold.value=-1;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.003;this.limiter.release.value=.08;this.master.connect(this.limiter);this.limiter.connect(ctx.destination);
  }
  play(ctx,position,end) {
    this.stop();this.connect(ctx);const now=ctx.currentTime;
    for(const layer of this.layers) {
      const buffer=this.buffers.get(layer.assetId);if(!buffer)continue;
      const clip=scheduleClip(layer,buffer.duration,position,end);if(!clip)continue;
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;gain.gain.value=layerGain(layer,this.layers);source.connect(gain);let pan=null;
      if(ctx.createStereoPanner){pan=ctx.createStereoPanner();pan.pan.value=layer.pan;gain.connect(pan);pan.connect(this.master);}else gain.connect(this.master);
      source.loop=clip.loop;source.loopStart=clip.loopStart;source.loopEnd=clip.loopEnd;const when=now+clip.delay;
      if(clip.loop)source.start(when,clip.offset);else source.start(when,clip.offset,clip.duration);
      source.stop(when+clip.duration);this.nodes.push({id:layer.id,source,gain,pan});
    }
  }
  syncGains() {
    for(const node of this.nodes){const layer=this.layers.find(item=>item.id===node.id);if(!layer)continue;node.gain.gain.setTargetAtTime(layerGain(layer,this.layers),this.ctx.currentTime,.012);node.pan?.pan.setTargetAtTime(layer.pan,this.ctx.currentTime,.012);}
    if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.012);
  }
  stop() {for(const node of this.nodes){try{node.source.stop();}catch(e){}node.source.disconnect();node.gain.disconnect();node.pan?.disconnect();}this.nodes=[];}
  async exportWav(length) {
    if(!this.ready)throw new Error('Import or relink an audio layer first.');
    if(!this.layers.some(layer=>this.buffers.has(layer.assetId)&&layerGain(layer,this.layers)>0))throw new Error('Unmute a layer and raise its volume before exporting.');
    if(this.layers.some(layer=>!this.buffers.has(layer.assetId)&&layerGain(layer,this.layers)>0))throw new Error('Relink or mute missing audio layers before exporting your mix.');
    if(length>600)throw new Error('WAV mix exports support sessions up to ten minutes.');
    const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;if(!Offline)throw new Error('Audio mix export is unavailable in this browser.');
    const rate=44100,ctx=new Offline(2,Math.max(1,Math.ceil(length*rate)),rate),offline=new LayerMixer();offline.layers=this.layers;offline.buffers=this.buffers;offline.volume=this.volume;offline.play(ctx,0,length);
    try{return encodeWav(await ctx.startRendering());}finally{offline.stop();}
  }
}
