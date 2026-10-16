let context;
export async function audioContext(resume=true) {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) throw new Error('Audio playback is unavailable in this browser.');
  if(!context || context.state==='closed') context=new Audio();
  if(resume&&context.state==='suspended') await context.resume();
  return context;
}
function tone(ctx, frequency, when, length=.04, volume=.12, type='sine') {
  const oscillator=ctx.createOscillator(), gain=ctx.createGain();
  oscillator.type=type;oscillator.frequency.value=frequency;
  gain.gain.setValueAtTime(.0001,when);
  gain.gain.exponentialRampToValueAtTime(volume,when+.005);
  gain.gain.exponentialRampToValueAtTime(.0001,when+length);
  oscillator.connect(gain);gain.connect(ctx.destination);
  oscillator.start(when);oscillator.stop(when+length+.02);
}
export async function playPitch(key, minor=false) {
  const ctx=await audioContext();
  const notes={C:0,'C#':1,D:2,Eb:3,E:4,F:5,'F#':6,G:7,Ab:8,A:9,Bb:10,B:11};
  const midi=60+(notes[key]||0), now=ctx.currentTime;
  tone(ctx,440*2**((midi-69)/12),now,.9,.12);
  // A root note is a reference pitch, independent of the song's mode.
  return minor;
}
export class Rehearsal {
  constructor(onTick, onEnd, onError) {
    this.onTick=onTick;this.onEnd=onEnd;this.onError=onError;this.playing=false;this.position=0;this.frame=0;this.ctx=null;this.mixer=null;this.epoch=0;this.started=null;this.clockAudio=false;
  }
  load(song, length) {this.pause();this.song=song;this.length=length;this.position=0;this.onTick(0,false,0);}
  async play(options) {
    if(!this.song || this.playing) return;
    this.options=options;this.playing=true;const epoch=++this.epoch;
    this.clockAudio=false;
    if(options.metronome||this.mixer?.ready) {
      try {this.ctx=await audioContext();this.clockAudio=true;} catch(e) {this.options.metronome=false;this.onError?.(e.message);if(this.mixer?.ready){this.pause();return;}}
    }
    if(!this.playing||epoch!==this.epoch) return;
    if(this.position>=this.length) this.position=0;
    const count=this.position===0 && options.countIn ? this.song.meter*60/this.song.bpm : 0;
    this.offset=this.position-count;
    this.started=performance.now();
    this.audioStarted=this.ctx?.currentTime||0;
    this.scheduledBeat=Math.ceil(this.offset/(60/this.song.bpm))-1;
    if(this.mixer?.ready)this.mixer.play(this.ctx,this.offset,this.length);
    this.tick();
  }
  tick=()=>{
    if(!this.playing) return;
    const beatSeconds=60/this.song.bpm;
    let position=this.clockPosition();
    if(position>=this.length) {
      if(this.options.loop && this.length>0) {
        position%=this.length;this.offset=position;this.started=performance.now();this.audioStarted=this.ctx?.currentTime||0;this.scheduledBeat=Math.ceil(position/beatSeconds)-1;if(this.mixer?.ready)this.mixer.play(this.ctx,position,this.length);
      } else {this.position=this.length;this.pause();this.onTick(this.length,false,0);this.onEnd?.();return;}
    }
    this.position=position;
    const beat=Math.floor(position/beatSeconds);
    if(this.options.metronome && this.ctx) {
      const minimumBeat=Math.ceil((position-.03)/beatSeconds);
      this.scheduledBeat=Math.max(this.scheduledBeat,minimumBeat-1);
      while((this.scheduledBeat+1)*beatSeconds<position+.1) {
        this.scheduledBeat++;
        const beatAt=this.scheduledBeat*beatSeconds;
        if(beatAt>=this.length) break;
        const accent=((this.scheduledBeat%this.song.meter)+this.song.meter)%this.song.meter===0;
        tone(this.ctx,accent?1200:800,this.ctx.currentTime+Math.max(0,beatAt-position),.025,accent?.12:.07,'triangle');
      }
    }
    this.onTick(position,true,((beat%this.song.meter)+this.song.meter)%this.song.meter);
    this.frame=requestAnimationFrame(this.tick);
  };
  clockPosition() {return this.offset+(this.clockAudio?this.ctx.currentTime-this.audioStarted:(performance.now()-this.started)/1000);}
  pause() {if(this.playing&&this.started!==null)this.position=this.clockPosition();this.playing=false;this.epoch++;cancelAnimationFrame(this.frame);this.position=Math.max(0,Math.min(this.length||0,this.position));this.started=null;this.mixer?.stop();}
  seek(seconds) {
    this.position=Math.max(0,Math.min(this.length,seconds));
    this.offset=this.position;this.started=performance.now();this.audioStarted=this.ctx?.currentTime||0;this.scheduledBeat=Math.ceil(this.position/(60/this.song.bpm))-1;
    if(this.playing&&this.mixer?.ready)this.mixer.play(this.ctx,this.position,this.length);
    this.onTick(this.position,this.playing,0);
  }
  async setMetronome(value) {
    if(value) {try{const position=this.playing?this.clockPosition():this.position;this.ctx=await audioContext();if(this.playing&&!this.clockAudio){this.offset=position;this.audioStarted=this.ctx.currentTime;this.started=performance.now();this.clockAudio=true;}}catch(e){this.onError?.(e.message);return false;}}
    if(this.options) this.options.metronome=value;
    return true;
  }
}
export class VoiceMemo {
  constructor(onStatus, onDone) {this.onStatus=onStatus;this.onDone=onDone;this.recorder=null;this.active=false;this.starting=false;this.timer=null;this.stream=null;}
  async start() {
    if(this.active || this.starting) return;
    if(!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('Recording needs a supported browser over HTTPS. Try Safari or Chrome on the live site.');
    this.starting=true;
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      this.stream=stream;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      this.recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
      const chunks=[];
      this.recorder.ondataavailable=e=>{if(e.data.size) chunks.push(e.data);};
      this.recorder.onstop=()=>{
        clearInterval(this.timer);stream.getTracks().forEach(t=>t.stop());this.active=false;
        const type=this.recorder.mimeType || chunks[0]?.type || 'audio/webm';
        this.onDone(new Blob(chunks,{type}),type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm');
      };
      this.recorder.onerror=()=>{this.stop();this.onStatus('Recording stopped because the microphone reported an error.');};
      this.recorder.start(1000);this.active=true;
      const start=Date.now();this.onStatus('Recording… 0:00');
      this.timer=setInterval(()=>{const seconds=Math.floor((Date.now()-start)/1000);this.onStatus(`Recording… ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);if(seconds>=600)this.stop();},1000);
    } catch(e) {this.stream?.getTracks().forEach(t=>t.stop());throw e;}
    finally {this.starting=false;}
  }
  stop() {if(this.recorder && this.recorder.state!=='inactive') this.recorder.stop();clearInterval(this.timer);this.stream?.getTracks().forEach(t=>t.stop());}
}
