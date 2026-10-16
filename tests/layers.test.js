import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeLayer,clipTiming,scheduleClip,sessionLength,layerGain,encodeWav,waveformPeaks} from '../layer-core.js';
import {LayerMixer} from '../layers.js';
import {Rehearsal} from '../audio.js';
import {createSong,normalizeSong,exportLyrics} from '../core.js';
import {AudioStore} from '../audio-store.js';

const layer=props=>normalizeLayer({id:'piano',assetId:'asset-piano',duration:14,trimEnd:14,...props});
test('layer trims and offsets are finite, bounded, and never produce a zero-length clip',()=>{
  const a=layer({start:-2,volume:9,pan:2,trimStart:99,trimEnd:1});
  assert.equal(a.start,0);assert.equal(a.volume,1.5);assert.equal(a.pan,1);assert.ok(clipTiming(a).length>.009);
  assert.deepEqual(clipTiming(layer({trimStart:2,trimEnd:8,start:4})),{from:2,to:8,length:6,start:4});
});
test('scheduling accounts for count-in, clip start, trim, and seeks into a clip',()=>{
  const a=layer({start:3,trimStart:2,trimEnd:8});
  assert.deepEqual(scheduleClip(a,14,-2,30),{delay:5,offset:2,duration:6,loop:false,loopStart:2,loopEnd:8});
  assert.equal(scheduleClip(a,14,5,30).offset,4);assert.equal(scheduleClip(a,14,5,30).duration,4);assert.equal(scheduleClip(a,14,9,30),null);
});
test('looping a trimmed clip resumes at the correct phase after seeking',()=>{
  const a=layer({start:3,trimStart:2,trimEnd:8,loop:true}),scheduled=scheduleClip(a,14,11,30);
  assert.equal(scheduled.offset,4);assert.equal(scheduled.duration,19);assert.equal(scheduled.delay,0);assert.equal(scheduled.loopStart,2);assert.equal(scheduled.loopEnd,8);
});
test('audio tails extend rehearsal while a loop honors the song guide length',()=>{
  assert.equal(sessionLength(10,[layer({start:2})]),16);assert.equal(sessionLength(125,[layer({loop:true})]),125);assert.equal(sessionLength(0,[layer()]),14);
});
test('solo, mute, and volume combine predictably',()=>{
  const a=layer({volume:.7}),b=layer({id:'vocal',solo:true,volume:.9});assert.equal(layerGain(a,[a,b]),0);assert.equal(layerGain(b,[a,b]),.9);b.muted=true;assert.equal(layerGain(b,[a,b]),0);b.solo=false;assert.equal(layerGain(a,[a,b]),.7);
});
test('legacy songbooks migrate and JSON backups preserve settings without audio bytes',()=>{
  const song=createSong();song.audioLayers=[layer({start:1.25,loop:true,pan:-.5})];song.masterVolume=.6;
  const copied=normalizeSong(JSON.parse(exportLyrics(song,'json')).song);assert.equal(copied.audioLayers[0].assetId,'asset-piano');assert.equal(copied.audioLayers[0].start,1.25);assert.equal(copied.audioLayers[0].loop,true);assert.notEqual(copied.audioLayers[0].id,song.audioLayers[0].id);assert.equal(copied.masterVolume,.6);
  const old={...song};delete old.audioLayers;delete old.masterVolume;assert.deepEqual(normalizeSong(old).audioLayers,[]);assert.equal(normalizeSong(old).masterVolume,.85);
  assert.ok(!exportLyrics(song,'plain').includes('asset-piano'));
});
test('WAV export writes valid stereo PCM headers, correct interleaving, and clipping protection',async()=>{
  const channels=[new Float32Array([1,-1,.5]),new Float32Array([0,.25,-.5])],buffer={numberOfChannels:2,length:3,sampleRate:48000,getChannelData:i=>channels[i]};
  const blob=encodeWav(buffer),bytes=await blob.arrayBuffer(),view=new DataView(bytes);
  assert.equal(blob.type,'audio/wav');assert.equal(bytes.byteLength,56);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');assert.equal(view.getUint32(4,true),48);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(24,true),48000);assert.equal(view.getUint32(40,true),12);assert.deepEqual(Array.from({length:6},(_,i)=>view.getInt16(44+i*2,true)),[32767,0,-32768,8192,16384,-16384]);
  channels[0][0]=2;const limited=new DataView(await encodeWav(buffer).arrayBuffer());assert.ok(limited.getInt16(44,true)<=32113);assert.ok(limited.getInt16(48,true)>-32768);
});
test('waveform data comes from actual peak amplitudes',()=>{
  assert.deepEqual(waveformPeaks({getChannelData:()=>new Float32Array([0,.5,-1,.25])},2),[.5,1]);
});
const param=()=>({value:0,setTargetAtTime(value){this.value=value;}});
class MockContext {
  constructor(){this.currentTime=10;this.state='running';this.destination={};this.sources=[];}
  createGain(){return {gain:param(),connect(){},disconnect(){}};}
  createDynamicsCompressor(){return {threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect(){}};}
  createStereoPanner(){return {pan:param(),connect(){},disconnect(){}};}
  createBufferSource(){const node={connect(){},disconnect(){},start(...args){this.startArgs=args;},stop(...args){this.stopArgs=args;}};this.sources.push(node);return node;}
}
test('live mixer schedules simultaneous layers and stops old sources on seek/restart',()=>{
  const mixer=new LayerMixer(),ctx=new MockContext(),a=layer({start:2,trimStart:1,trimEnd:5}),b=layer({id:'voice',assetId:'voice',loop:true});
  mixer.layers=[a,b];mixer.buffers.set(a.assetId,{duration:14});mixer.buffers.set(b.assetId,{duration:14});mixer.play(ctx,-2,30);
  assert.deepEqual(ctx.sources[0].startArgs,[14,1,4]);assert.deepEqual(ctx.sources[1].startArgs,[12,0]);assert.deepEqual(ctx.sources[1].stopArgs,[42]);
  const original=ctx.sources[0];ctx.currentTime=20;mixer.play(ctx,3,30);assert.deepEqual(original.stopArgs,[]);assert.deepEqual(ctx.sources[2].startArgs,[20,2,3]);
  a.muted=true;mixer.syncGains();assert.equal(mixer.nodes[0].gain.gain.value,0);mixer.stop();assert.equal(mixer.nodes.length,0);
});
test('rehearsal audio clock, seek, count-in, and pause control the mixer together',async()=>{
  const previousAudio=globalThis.AudioContext,previousRaf=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame;
  globalThis.AudioContext=MockContext;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  try {
    const calls=[],mixer={ready:true,play:(...args)=>calls.push(args),stop:()=>calls.push('stop')},song=createSong(),player=new Rehearsal(()=>{},()=>{});song.bpm=120;song.meter=4;player.mixer=mixer;player.load(song,30);await player.play({countIn:true,metronome:false,loop:false});
    assert.equal(calls.find(Array.isArray)[1],-2);player.ctx.currentTime+=3;player.tick();assert.equal(player.position,1);player.seek(7);assert.equal(calls.at(-1)[1],7);player.ctx.currentTime+=2;player.pause();assert.equal(player.position,9);assert.equal(calls.at(-1),'stop');assert.equal(player.playing,false);
  }finally{globalThis.AudioContext=previousAudio;globalThis.requestAnimationFrame=previousRaf;globalThis.cancelAnimationFrame=previousCancel;}
});
test('failed device storage keeps the current audio in memory instead of claiming it was saved',async()=>{
  const store=new AudioStore(),asset={id:'session-only',blob:new Blob(['audio'])};await assert.rejects(store.put(asset),/storage is unavailable/);assert.equal(await store.get(asset.id),asset);
});
test('all layer controls have markup anchors and offline modules are cached',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),ui=await readFile(new URL('../layer-ui.js',import.meta.url),'utf8'),sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  for(const match of ui.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(html.includes(`id="${match[1]}"`),`Missing ${match[1]}`);
  for(const module of ['layers.js','layer-core.js','audio-store.js','layer-ui.js'])assert.ok(sw.includes(`./${module}`));
  assert.ok(html.includes('id="audio-import"'));assert.ok(html.includes('data-audio-action="import"'));assert.ok(html.includes('aria-controls="layers-view"'));
});
