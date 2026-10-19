import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeLayer,normalizeClip,clipTiming,clipRate,clipEnd,scheduleClip,sessionLength,layerGain,placeClip,snapPosition,splitClip,trimClip,rescaleArrangement,encodeWav,waveformPeaks} from '../layer-core.js';
import {stretchPCM,processPCM,levelGain} from '../audio-process.js';
import {LayerMixer} from '../layers.js';
import {Rehearsal} from '../audio.js';
import {createSong,normalizeSong,exportLyrics} from '../core.js';
import {AudioStore} from '../audio-store.js';
const clip=props=>normalizeClip({id:'piano',assetId:'asset-piano',duration:14,trimEnd:14,sourceBpm:120,...props},120);
const track=(clips=[],props={})=>normalizeLayer({id:'track',name:'Piano',clips,...props},120);
const near=(a,b,epsilon=.00001)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
test('clips validate trims, tempo, gains, and separate track settings',()=>{
  const a=clip({start:-2,volume:9,trimStart:99,trimEnd:1,sourceBpm:Infinity});
  assert.equal(a.start,0);assert.equal(a.volume,1.5);assert.equal(a.sourceBpm,120);assert.ok(clipTiming(a).length>.009);
  assert.deepEqual(clipTiming(clip({trimStart:2,trimEnd:8,start:4})),{from:2,to:8,length:6,start:4});assert.equal(track([a],{pan:2}).pan,1);
});
test('old one-file layers migrate without losing source, offsets, trims, pan, or looping',()=>{
  const song=normalizeSong({bpm:100,sections:[],audioLayers:[{id:'old',assetId:'old-source',name:'Piano',filename:'piano.wav',duration:14,start:2,trimStart:1,trimEnd:10,volume:.6,pan:-.5,muted:true,solo:true,loop:true}]});
  const [t]=song.audioLayers,[c]=t.clips;assert.equal(t.volume,.6);assert.equal(t.pan,-.5);assert.equal(t.muted,true);assert.equal(t.solo,true);assert.equal(c.assetId,'old-source');assert.equal(c.start,2);assert.equal(c.trimStart,1);assert.equal(c.trimEnd,10);assert.equal(c.volume,1);assert.equal(c.muted,false);assert.equal(c.loop,true);assert.equal(c.loopLength,0);assert.equal(c.sourceBpm,100);
});
test('JSON backups preserve separate clips and settings, use new ids, and omit audio bytes',()=>{
  const song=createSong();song.audioLayers=[track([clip({start:1.25,loop:true,loopLength:30}),clip({id:'second',start:40,reverse:true,fadeIn:.1})])];song.masterVolume=.6;
  const copied=normalizeSong(JSON.parse(exportLyrics(song,'json')).song);assert.equal(copied.audioLayers[0].clips.length,2);assert.equal(copied.audioLayers[0].clips[0].assetId,'asset-piano');assert.equal(copied.audioLayers[0].clips[0].loopLength,30);assert.equal(copied.audioLayers[0].clips[1].reverse,true);assert.equal(copied.audioLayers[0].clips[1].fadeIn,.1);assert.notEqual(copied.audioLayers[0].id,song.audioLayers[0].id);assert.notEqual(copied.audioLayers[0].clips[0].id,song.audioLayers[0].clips[0].id);assert.equal(copied.masterVolume,.6);assert.ok(!exportLyrics(song,'plain').includes('asset-piano'));
  const old={...song};delete old.audioLayers;delete old.masterVolume;assert.deepEqual(normalizeSong(old).audioLayers,[]);assert.equal(normalizeSong(old).masterVolume,.85);
});
test('malformed or oversized song backups are capped to 12 tracks and 128 clips total',()=>{
  const s=normalizeSong({sections:[],audioLayers:Array.from({length:20},()=>({clips:Array.from({length:80},()=>clip())}))});assert.equal(s.audioLayers.length,12);assert.equal(s.audioLayers.flatMap(t=>t.clips).length,128);
});
test('count-in, trimmed source offsets, seeks, and source tempo share a timeline',()=>{
  const a=clip({start:3,trimStart:2,trimEnd:8});assert.deepEqual(scheduleClip(a,14,-2,30,120),{delay:5,offset:2,duration:6,loop:false,loopStart:2,loopEnd:8});
  assert.equal(scheduleClip(a,14,5,30,120).offset,4);assert.equal(scheduleClip(a,14,9,30,120),null);
  assert.equal(clipTiming(a,14,180).length,4);assert.equal(scheduleClip(a,14,5,30,180).offset,5);
  assert.equal(clipRate({...a,followTempo:false},180),1);
});
test('loops stop at their explicit length, or at the next clip for legacy to-end loops',()=>{
  const a=clip({start:3,trimStart:2,trimEnd:8,loop:true,loopLength:12}),b=clip({id:'b',start:20}),t=track([a,b]);
  assert.equal(clipEnd(a,50,t,120),15);assert.equal(scheduleClip(a,14,11,50,120,t).offset,4);assert.equal(scheduleClip(a,14,15,50,120,t),null);
  a.loopLength=0;assert.equal(clipEnd(a,50,t,120),20);assert.equal(sessionLength(10,[t],120),34);assert.equal(sessionLength(125,[t],120),125);
});
test('snapping lines up either clip edge with another, while off preserves precision',()=>{
  const clips=[clip({start:0,trimEnd:8})];assert.deepEqual(snapPosition(8.07,4,clips,120,'edges',.1),{start:8,distance:.07000000000000028,snapped:true});
  near(snapPosition(3.96,4,clips,120,'edges',.1).start,4);assert.equal(snapPosition(10.04,4,clips,120,'beats',.1).start,10);assert.equal(snapPosition(10.04,4,clips,120,'off',.1).start,10.04);
});
test('placement finds free space without overwriting or merging independent clips',()=>{
  const a=clip({id:'a',start:0,trimEnd:4}),b=clip({id:'b',start:10,trimEnd:6}),c=clip({id:'c',trimEnd:3}),t=track([a,b]);
  assert.equal(placeClip(c,t,4.06,120,'edges',.1).start,4);assert.equal(placeClip(c,t,9,120,'off').start,7);assert.equal(placeClip(c,t,13,120,'off').start,16);assert.deepEqual(t.clips.map(c=>[c.id,c.start]),[['a',0],['b',10]]);
  const moved=placeClip(a,t,3,120,'off');assert.equal(moved.start,3);
});
test('splits preserve source continuity at changed tempos and in reverse',()=>{
  const a=clip({start:2,trimStart:1,trimEnd:13});const [left,right]=splitClip(a,6,10,180,'new');assert.equal(left.trimEnd,7);assert.equal(right.trimStart,7);assert.equal(right.start,6);near(clipTiming(left,14,180).length+clipTiming(right,14,180).length,8);assert.equal(a.trimEnd,13);
  const [rl,rr]=splitClip({...a,reverse:true},6,14,120,'reverse');assert.equal(rl.trimStart,9);assert.equal(rr.trimEnd,9);assert.equal(splitClip(a,2,14,120),null);
});
test('splitting a loop preserves phase and independent bounded lengths',()=>{
  const a=clip({start:2,trimStart:1,trimEnd:5,loop:true,loopLength:16}),[left,right]=splitClip(a,8,18,120,'loop-b');assert.equal(left.loopLength,6);assert.equal(right.loopLength,10);assert.equal(right.phase,2);assert.equal(right.trimStart,1);assert.equal(right.trimEnd,5);
});
test('trim handles respect source bounds and preserve the opposite edge',()=>{
  const a=clip({start:3,trimStart:2,trimEnd:8});const left=trimClip(a,'left',1,180);assert.equal(left.start,4);assert.equal(left.trimStart,3.5);near(left.start+clipTiming(left,14,180).length,7);
  const right=trimClip(a,'right',100,120);assert.equal(right.trimEnd,14);assert.equal(right.start,3);const loop=trimClip({...a,loop:true,loopLength:12},'left',2,120,12);assert.equal(loop.loopLength,10);assert.equal(loop.phase,2);
});
test('BPM changes scale audio duration and clip positions together, maintaining connected edges',()=>{
  const t=track([clip({id:'a',start:0,trimEnd:8}),clip({id:'b',start:8,trimEnd:4}),clip({id:'c',start:12,trimEnd:2,loop:true,loopLength:8})]);rescaleArrangement([t],120,180);
  near(t.clips[1].start,8/1.5);near(t.clips[2].start,12/1.5);near(t.clips[2].loopLength,8/1.5);near(clipEnd(t.clips[0],30,t,180),t.clips[1].start);
  rescaleArrangement([t],180,120);near(t.clips[1].start,8);near(t.clips[2].loopLength,8);
});
test('solo, mute, and volume combine at track level',()=>{
  const a=track([],{volume:.7}),b=track([],{id:'vocal',solo:true,volume:.9});assert.equal(layerGain(a,[a,b]),0);assert.equal(layerGain(b,[a,b]),.9);b.muted=true;assert.equal(layerGain(b,[a,b]),0);
});
test('pitch-preserving time stretch changes duration while retaining a 440 Hz tone',()=>{
  const sr=16000,signal=Float32Array.from({length:sr*2},(_,i)=>.6*Math.sin(2*Math.PI*440*i/sr));
  for(const ratio of [.5,.75,1.25,1.5,2]){const [out,opposite]=stretchPCM([signal,Float32Array.from(signal,v=>-v)],ratio,sr);assert.equal(out.length,Math.round(signal.length/ratio));let crosses=0;const a=Math.round(out.length*.1),b=Math.round(out.length*.9);for(let i=a+1;i<b;i++){if(out[i-1]<=0&&out[i]>0)crosses++;near(out[i]+opposite[i],0,.000001);}const pitch=crosses/((b-a)/sr);assert.ok(Math.abs(pitch-440)<3,`${ratio}x produced ${pitch} Hz`);}
});
test('silence and short clips stretch safely with finite samples and exact duration',()=>{
  for(const n of [32,8000])for(const ratio of [.5,2]){const [out]=stretchPCM([new Float32Array(n)],ratio,16000);assert.equal(out.length,Math.round(n/ratio));assert.ok(out.every(v=>v===0));}
  assert.throws(()=>stretchPCM([new Float32Array(1)],0,16000),/tempo/);
});
test('seam smoothing joins mismatched endpoints without shortening the musical loop',()=>{
  const sr=16000,signal=Float32Array.from({length:10415},(_,i)=>.6*Math.sin(2*Math.PI*437*i/sr)),original=signal.slice(),result=processPCM([signal],sr,{smoothLoop:true});
  assert.equal(result.channels[0].length,signal.length);near(result.cycle,signal.length/sr);near(result.channels[0][0],result.channels[0].at(-1),1e-7);assert.deepEqual(signal,original);
  const seam=Math.round(sr*.035);assert.equal(result.channels[0][seam],signal[seam]);assert.ok(result.channels[0].every(Number.isFinite));
});
test('automatic joins use real source handles where available and a continuous tail at EOF',()=>{
  const sr=1000,signal=Float32Array.from({length:500},(_,i)=>i/1000);const real=processPCM([signal],sr,{from:.1,to:.3,tailSeconds:.025});assert.equal(real.channels[0].length,225);near(real.channels[0][200],signal[300]);
  const eof=processPCM([signal],sr,{from:.2,to:.5,tailSeconds:.025});near(eof.channels[0][300],eof.channels[0][299]);assert.equal(eof.tail,.025);
});
test('auto level uses shared source measurements and does not amplify near-silence',()=>{
  assert.equal(levelGain([new Float32Array(30)]),1);assert.equal(levelGain([new Float32Array(30).fill(.00001)]),1);near(levelGain([new Float32Array(30).fill(.4)]),.4);assert.ok(levelGain([new Float32Array([4,.5,-.5])])<=.23);
});
test('WAV mix writes PCM headers, stereo samples, and clipping protection',async()=>{
  const channels=[new Float32Array([1,-1,.5]),new Float32Array([0,.25,-.5])],buffer={numberOfChannels:2,length:3,sampleRate:48000,getChannelData:i=>channels[i]};const blob=encodeWav(buffer),bytes=await blob.arrayBuffer(),view=new DataView(bytes);
  assert.equal(blob.type,'audio/wav');assert.equal(bytes.byteLength,56);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(24,true),48000);assert.equal(view.getUint32(40,true),12);assert.deepEqual(Array.from({length:6},(_,i)=>view.getInt16(44+i*2,true)),[32767,0,-32768,8192,16384,-16384]);channels[0][0]=2;const limited=new DataView(await encodeWav(buffer).arrayBuffer());assert.ok(limited.getInt16(44,true)<=32113);
});
test('waveform peaks represent actual samples, including very short sources',()=>{assert.deepEqual(waveformPeaks({getChannelData:()=>new Float32Array([0,.5,-1,.25])},2),[.5,1]);assert.equal(waveformPeaks({getChannelData:()=>new Float32Array([.5])},100).length,100);});
class Param{
  constructor(){this.value=0;this.events=[];}setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);}linearRampToValueAtTime(v,t){this.value=v;this.events.push(['ramp',v,t]);}setTargetAtTime(v,t){this.value=v;this.events.push(['target',v,t]);}cancelScheduledValues(t){this.events=this.events.filter(e=>e[2]<t);}cancelAndHoldAtTime(t){this.cancelScheduledValues(t);}
}
class MockContext{
  constructor(){this.currentTime=10;this.state='running';this.destination={};this.sources=[];}
  createGain(){return {gain:new Param(),connect(){},disconnect(){}};}
  createDynamicsCompressor(){return {threshold:new Param(),knee:new Param(),ratio:new Param(),attack:new Param(),release:new Param(),connect(){},disconnect(){}};}
  createStereoPanner(){return {pan:new Param(),connect(){},disconnect(){}};}
  createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate,duration:length/sampleRate,getChannelData:i=>data[i],copyToChannel:(array,i)=>data[i].set(array)};}
  createBufferSource(){const source={connect(){},disconnect(){},start(...args){this.startArgs=args;},stop(...args){this.stopArgs=args;}};this.sources.push(source);return source;}
}
function sample(ctx,duration=14){const b=ctx.createBuffer(1,Math.round(duration*8000),8000);b.getChannelData(0).set(Float32Array.from({length:b.length},(_,i)=>Math.sin(2*Math.PI*440*i/8000)*.5));return b;}
test('mixer schedules multiple clips on one track, together with other tracks, using one clock',async()=>{
  const ctx=new MockContext(),mixer=new LayerMixer(),a=clip({id:'a',start:2,trimStart:1,trimEnd:5}),b=clip({id:'b',start:6,trimStart:5,trimEnd:8}),v=clip({id:'v',assetId:'voice',start:2,trimEnd:6,loop:true,loopLength:20});mixer.bpm=120;mixer.layers=[track([a,b]),track([v],{id:'voice'})];mixer.buffers.set(a.assetId,sample(ctx));mixer.buffers.set(v.assetId,sample(ctx));await mixer.prepare(ctx,30);mixer.play(ctx,-2,30);
  assert.deepEqual(ctx.sources[0].startArgs,[14,1]);assert.deepEqual(ctx.sources[0].stopArgs,[18]);assert.deepEqual(ctx.sources[1].startArgs,[18,5]);assert.deepEqual(ctx.sources[2].startArgs,[14,0]);assert.equal(ctx.sources[2].loop,true);near(ctx.sources[2].loopEnd,6);assert.equal(mixer.nodes.length,3);
  const original=ctx.sources[0];ctx.currentTime=20;mixer.play(ctx,3,30);near(original.stopArgs[0],20.008);assert.deepEqual(ctx.sources[3].startArgs,[20,2]);mixer.layers[0].muted=true;mixer.syncGains();assert.equal(mixer.nodes[0].gain.gain.value,0);mixer.stop();assert.equal(mixer.nodes.length,0);
});
test('adjacent unrelated clips get complementary automatic envelopes without changing their starts',async()=>{
  const ctx=new MockContext(),mixer=new LayerMixer(),a=clip({id:'a',trimEnd:2}),b=clip({id:'b',assetId:'voice',start:2,trimEnd:2});mixer.bpm=120;mixer.layers=[track([a,b])];mixer.buffers.set(a.assetId,sample(ctx));mixer.buffers.set(b.assetId,sample(ctx));await mixer.prepare(ctx,4);mixer.play(ctx,0,4);
  near(ctx.sources[0].stopArgs[0],12.025);assert.deepEqual(ctx.sources[1].startArgs,[12,0]);const outgoing=mixer.nodes[0].envelope.gain.events,incoming=mixer.nodes[1].envelope.gain.events;assert.ok(outgoing.some(e=>e[0]==='ramp'&&Math.abs(e[1]-1)<.00001&&Math.abs(e[2]-12)<.00001));assert.ok(outgoing.some(e=>e[1]===0&&Math.abs(e[2]-12.025)<.00001));assert.ok(incoming.some(e=>Math.abs(e[1]-1)<.00001&&Math.abs(e[2]-12.025)<.00001));assert.equal(a.start,0);assert.equal(b.start,2);
});
test('mixer tempo processing really shortens playback and export uses the same preparation',async()=>{
  const ctx=new MockContext(),mixer=new LayerMixer(),a=clip({trimEnd:4,autoLevel:false});mixer.layers=[track([a])];mixer.bpm=180;mixer.buffers.set(a.assetId,sample(ctx));await mixer.prepare(ctx,10);near(mixer.prepared[0].cycle,4/1.5,.0002);mixer.play(ctx,0,10);near(ctx.sources[0].stopArgs[0]-ctx.sources[0].startArgs[0],4/1.5);assert.equal(ctx.sources[0].startArgs[1],0);
  const oldOffline=globalThis.OfflineAudioContext;let rendered;
  globalThis.OfflineAudioContext=class extends MockContext{constructor(c,n,sr){super();this.currentTime=0;this.output=this.createBuffer(c,n,sr);rendered=this;}async startRendering(){return this.output;}};
  try{const wav=await mixer.exportWav(4/1.5);assert.equal(wav.size,44+Math.ceil(4/1.5*44100)*4);near(rendered.sources[0].startArgs[1],0);near(rendered.sources[0].loopEnd,4/1.5,.0002);}finally{globalThis.OfflineAudioContext=oldOffline;}
});
test('audition isolates clips or tracks without overwriting their saved mute/solo settings',async()=>{
  const ctx=new MockContext(),mixer=new LayerMixer(),a=clip({id:'a',trimEnd:2}),b=clip({id:'b',start:2,trimStart:2,trimEnd:4});mixer.bpm=120;mixer.layers=[track([a,b],{muted:true}),track([],{id:'other',solo:true})];mixer.buffers.set(a.assetId,sample(ctx));await mixer.prepare(ctx,4);mixer.auditionClip='b';mixer.play(ctx,0,4);assert.equal(ctx.sources.length,1);assert.equal(mixer.layers[0].solo,false);assert.equal(mixer.layers[0].muted,true);assert.ok(mixer.nodes[0].gain.gain.value>0);
});
test('rehearsal waits for processed audio and ties count-in, seek, pause, and preview range to the audio clock',async()=>{
  const previousAudio=globalThis.AudioContext,previousRaf=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame;globalThis.AudioContext=MockContext;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  try{const calls=[],mixer={ready:true,prepare:async()=>{calls.push('prepare');return true;},play:(...args)=>calls.push(args),stop:()=>calls.push('stop')},song=createSong(),player=new Rehearsal(()=>{},()=>{});song.bpm=120;song.meter=4;player.mixer=mixer;player.load(song,30);await player.play({countIn:true,metronome:false,loop:false});assert.equal(calls.find(Array.isArray)[1],-2);assert.ok(calls.indexOf('prepare')<calls.findIndex(Array.isArray));player.ctx.currentTime+=3;player.tick();assert.equal(player.position,1);player.seek(7);assert.equal(calls.at(-1)[1],7);player.ctx.currentTime+=2;player.pause();assert.equal(player.position,9);assert.equal(calls.at(-1),'stop');
    player.seek(3);await player.play({countIn:false,metronome:false,loop:false,end:6});player.ctx.currentTime+=4;player.tick();assert.equal(player.playing,false);assert.equal(player.position,6);
    let finish;mixer.prepare=()=>new Promise(resolve=>finish=resolve);player.seek(0);const pending=player.play({countIn:false,metronome:false,loop:false});await new Promise(resolve=>setImmediate(resolve));player.pause();finish(true);await pending;assert.equal(player.playing,false);
  }finally{globalThis.AudioContext=previousAudio;globalThis.requestAnimationFrame=previousRaf;globalThis.cancelAnimationFrame=previousCancel;}
});
test('failed storage retains playable session audio without claiming it was saved',async()=>{const store=new AudioStore(),asset={id:'session-only',blob:new Blob(['audio'])};await assert.rejects(store.put(asset),/storage is unavailable/);assert.equal(await store.get(asset.id),asset);});
test('new timeline controls have markup anchors and the worker is cached offline',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),ui=await readFile(new URL('../layer-ui.js',import.meta.url),'utf8'),sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');const dynamic=['clip-fit-bars'];for(const match of ui.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(html.includes(`id="${match[1]}"`)||dynamic.includes(match[1]),`Missing ${match[1]}`);for(const module of ['layers.js','layer-core.js','audio-store.js','audio-process.js','layer-ui.js'])assert.ok(sw.includes(`./${module}?v=1.2.1`));assert.ok(html.includes('aria-controls="layers-view"'));assert.ok(html.includes('id="audio-snap"'));assert.ok(html.includes('id="clip-inspector"'));
});

test('entrypoint, module imports, and worker all use the release version to avoid stale app code',async()=>{
  const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version,html=await readFile(new URL('../index.html',import.meta.url),'utf8'),sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  assert.ok(html.includes(`src="app.js?v=${version}"`));assert.ok(html.includes(`href="styles.css?v=${version}"`));
  for(const name of ['app.js','core.js','layers.js','layer-ui.js']){const source=await readFile(new URL('../'+name,import.meta.url),'utf8');for(const match of source.matchAll(/from ['"](\.\/[^'"]+)['"]/g))assert.ok(match[1].endsWith(`?v=${version}`),`${name}: ${match[1]}`);}
  assert.ok((await readFile(new URL('../layers.js',import.meta.url),'utf8')).includes(`audio-process.js?v=${version}`));assert.ok(sw.includes("cache:'no-cache'"));
});
