import {uid,esc,stats,timeLabel,clamp} from './core.js';
import {MAX_LAYERS,MAX_CLIPS,normalizeLayer,normalizeClip,allClips,clipTiming,clipRate,clipEnd,sessionLength,waveformPeaks,layerGain,placeClip,snapPosition,splitClip,trimClip,rescaleArrangement} from './layer-core.js';
import {LayerMixer} from './layers.js';
import {AudioStore} from './audio-store.js';
const $=selector=>document.querySelector(selector);
const precise=s=>`${Math.floor(Math.max(0,s)/60)}:${(Math.max(0,s)%60).toFixed(2).padStart(5,'0')}`;
const number=v=>Number(v.toFixed(3));
export class LayerStudio {
  constructor({getSong,player,icon,notify,save,onLengthChanged,onPlay,openView,download,slug}){
    Object.assign(this,{getSong,player,icon,notify,save,onLengthChanged,onPlay,openView,download,slug});
    this.mixer=new LayerMixer();this.store=new AudioStore();this.player.mixer=this.mixer;
    this.busy=false;this.version=0;this.peaks=new Map();this.errors=new Map();this.unsaved=new Set();this.memo=null;this.selection=null;this.pendingImport=null;this.undo=[];this.redo=[];this.zoom=1;this.snap='beats';this.drag=null;this.suppressClick=false;
    document.addEventListener('click',e=>this.click(e));document.addEventListener('input',e=>this.input(e));document.addEventListener('change',e=>this.change(e));
    document.addEventListener('focusin',e=>{if(e.target.matches('[data-layer-field],[data-clip-field],#master-volume'))this.fieldSnapshot=this.snapshot();});
    document.addEventListener('pointerdown',e=>this.pointerDown(e));document.addEventListener('pointermove',e=>this.pointerMove(e));document.addEventListener('pointerup',e=>this.pointerUp(e));document.addEventListener('pointercancel',()=>this.cancelDrag());
    $('#layers-view').addEventListener('dragover',e=>{const target=e.target.closest('.track-lane,#audio-drop');if(!target||this.busy||![...e.dataTransfer.types].includes('Files'))return;e.preventDefault();e.dataTransfer.dropEffect='copy';target.classList.add('drag-over');});
    $('#layers-view').addEventListener('dragleave',e=>e.target.closest('.track-lane,#audio-drop')?.classList.remove('drag-over'));
    $('#layers-view').addEventListener('drop',e=>{const target=e.target.closest('.track-lane,#audio-drop');if(!target)return;e.preventDefault();target.classList.remove('drag-over');if(this.busy)return;const track=this.track(target.closest('[data-track]')?.dataset.track);this.pendingImport=track?{trackId:track.id,start:this.timeAt(target,e.clientX)}:null;this.importFiles([...e.dataTransfer.files]);});
    document.addEventListener('keydown',e=>this.keydown(e));
  }
  get length(){const song=this.getSong();return sessionLength(stats(song).seconds,song.audioLayers||[],song.bpm);}
  get clips(){return allClips(this.getSong().audioLayers||[]);}
  track(id){return this.getSong().audioLayers.find(track=>track.id===id);}
  selected(){for(const track of this.getSong().audioLayers){const clip=track.clips.find(clip=>clip.id===this.selection);if(clip)return {track,clip};}return {};}
  status(text,error=false){$('#audio-status').textContent=text;$('#audio-status').classList.toggle('error',error);}
  snapshot(){const song=this.getSong();return JSON.stringify({tracks:song.audioLayers,bpm:song.bpm,smooth:song.audioSmooth,volume:song.masterVolume,selection:this.selection});}
  checkpoint(snapshot=this.snapshot()){if(this.undo.at(-1)!==snapshot)this.undo.push(snapshot);if(this.undo.length>30)this.undo.shift();this.redo=[];}
  commit(message){this.mixer.layers=this.getSong().audioLayers;this.mixer.bpm=this.getSong().bpm;this.mixer.smooth=this.getSong().audioSmooth!==false;this.save();this.onLengthChanged();this.render();if(message)this.status(message);}
  pause(){this.player.pause();this.setPlaying(false);}
  history(redo=false){if(this.busy)return;const source=redo?this.redo:this.undo,target=redo?this.undo:this.redo;if(!source.length)return;this.pause();target.push(this.snapshot());const state=JSON.parse(source.pop()),song=this.getSong();song.audioLayers=state.tracks;song.bpm=state.bpm;song.audioSmooth=state.smooth;song.masterVolume=state.volume;this.selection=state.selection;this.mixer.volume=song.masterVolume;$('#song-bpm').value=song.bpm;this.commit(redo?'Edit restored.':'Edit undone.');}
  changeTempo(oldBpm,newBpm){this.checkpoint(JSON.stringify({...JSON.parse(this.snapshot()),bpm:oldBpm}));rescaleArrangement(this.getSong().audioLayers,oldBpm,newBpm);this.mixer.bpm=newBpm;this.status(`Audio now follows ${newBpm} BPM, with pitch preserved. Set a clip’s source BPM if its original tempo differs.`);}
  async loadSong(){
    const version=++this.version,song=this.getSong();song.audioLayers||=[];this.cancelDrag();this.selection=null;this.undo=[];this.redo=[];this.fieldSnapshot=null;
    this.mixer.reset(song.audioLayers);this.mixer.volume=song.masterVolume??.85;this.mixer.bpm=song.bpm;this.mixer.smooth=song.audioSmooth!==false;this.peaks.clear();this.errors.clear();this.busy=true;this.render();
    let missing=0;
    for(const clip of allClips(song.audioLayers)){
      if(version!==this.version)return;
      if(this.mixer.buffers.has(clip.assetId)||this.errors.has(clip.assetId))continue;
      try{const asset=await this.store.get(clip.assetId);if(version!==this.version)return;if(!asset)throw new Error('Source file missing on this device.');const buffer=await this.mixer.decode(asset.blob);if(version!==this.version)return;this.mixer.buffers.set(clip.assetId,buffer);this.peaks.set(clip.assetId,waveformPeaks(buffer));}
      catch(e){if(version!==this.version)return;missing++;this.errors.set(clip.assetId,e.message);}
    }
    if(version!==this.version)return;this.busy=false;this.selection=this.clips[0]?.id||null;this.render();this.onLengthChanged();this.status(missing?`${missing} source file${missing===1?' is':'s are'} missing. Select the affected clip and use Relink.`:this.clips.length?'Drag clips to arrange them. Edges snap together; each clip stays separate.':'Import audio, or create a track and drop your recordings onto it.',missing>0);
  }
  waveform(clip,repeats=1){
    const peaks=this.peaks.get(clip.assetId)||[],first=Math.floor(clip.trimStart/clip.duration*peaks.length),last=Math.max(first+1,Math.ceil(clip.trimEnd/clip.duration*peaks.length)),part=peaks.slice(first,last);if(clip.reverse)part.reverse();
    const width=Math.max(1,part.length)*2,pattern=`wave-${clip.id.replace(/[^a-zA-Z0-9_-]/g,'')}`;
    return `<svg viewBox="0 0 ${width*Math.max(1,repeats)} 48" preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="${pattern}" patternUnits="userSpaceOnUse" width="${width}" height="48">${part.map((p,i)=>`<rect x="${i*2+.3}" y="${24-Math.max(1,p*21)}" width="1.25" height="${Math.max(2,p*42)}" rx=".6"/>`).join('')}</pattern></defs><rect width="100%" height="48" fill="url(#${pattern})"/></svg>`;
  }
  clipMarkup(clip,track){
    const length=this.length,end=clipEnd(clip,length,track,this.getSong().bpm),missing=!this.mixer.buffers.has(clip.assetId)&&!this.busy,next=track.clips.some(c=>c.id!==clip.id&&Math.abs(c.start-end)<.002),cycle=clipTiming(clip,clip.duration,this.getSong().bpm).length;
    return `<button type="button" class="audio-clip ${this.selection===clip.id?'selected':''} ${missing?'clip-missing':''} ${clip.muted?'clip-muted':''}" data-clip="${esc(clip.id)}" data-audio-action="select" style="--clip-start:${clip.start/length*100}%;--clip-width:${(end-clip.start)/length*100}%;--cycle:${cycle/Math.max(.01,end-clip.start)*100}%" aria-pressed="${this.selection===clip.id}" aria-label="${esc(clip.name)}. Start ${precise(clip.start)}, length ${precise(end-clip.start)}. Select to edit, drag to move."><span class="clip-trim left" data-trim="left" title="Drag to trim start"></span><span class="clip-name">${missing?'⚠ ':''}${esc(clip.name)}</span>${this.waveform(clip,clip.loop?(end-clip.start)/cycle:1)}<span class="clip-badge">${clip.loop?'↻ LOOP':clip.reverse?'↶ REVERSE':''}</span>${next?'<span class="clip-connection" title="Connected to the next separate clip">›‹</span>':''}<span class="clip-trim right" data-trim="right" title="Drag to trim end"></span></button>`;
  }
  render(){
    const song=this.getSong(),tracks=song.audioLayers||[],length=this.length;
    $('#master-volume').value=Math.round((song.masterVolume??.85)*100);$('#master-value').textContent=`${$('#master-volume').value}%`;$('#audio-smooth').checked=song.audioSmooth!==false;
    $('#audio-layer-count').textContent=`${tracks.length} / ${MAX_LAYERS} tracks · ${this.clips.length} clips`;$('#audio-session-duration').textContent=`Session · ${precise(length)}`;
    $('#audio-timeline').style.width=`${this.zoom*100}%`;
    $('#audio-ruler').innerHTML=Array.from({length:9},(_,i)=>`<span>${precise(length*i/8)}</span>`).join('');
    const beatPercent=60/song.bpm/length*100;$('#audio-timeline').style.setProperty('--beat-width',`${beatPercent}%`);
    $('#import-audio-button').disabled=this.busy||this.clips.length>=MAX_CLIPS||tracks.length>=MAX_LAYERS;$('#new-audio-track').disabled=this.busy||tracks.length>=MAX_LAYERS;
    $('#audio-drop').disabled=this.busy||this.clips.length>=MAX_CLIPS;$('#audio-drop').hidden=false;$('#export-mix-button').disabled=this.busy||!this.mixer.ready;$('#layer-play-button').disabled=this.busy||!this.mixer.ready;
    $('#audio-undo').disabled=this.busy||!this.undo.length;$('#audio-redo').disabled=this.busy||!this.redo.length;
    $('#audio-layer-list').innerHTML=tracks.map((track,index)=>`<article class="audio-track ${layerGain(track,tracks)===0?'is-muted':''}" data-track="${esc(track.id)}"><div class="track-heading"><span class="track-number">${String(index+1).padStart(2,'0')}</span><div class="track-title-group"><input class="track-title" data-layer-field="name" value="${esc(track.name)}" maxlength="200" aria-label="Name for track ${index+1}"><span class="track-source">${track.clips.length} separate clip${track.clips.length===1?'':'s'} · drop audio onto this track</span></div><div class="track-actions"><button class="icon-button track-play" data-audio-action="play-track" aria-label="Play only ${esc(track.name)}" title="Play only this track" ${this.busy||!track.clips.some(c=>this.mixer.buffers.has(c.assetId))?'disabled':''}>${this.icon('play')}</button><button class="track-toggle" data-audio-action="mute" aria-pressed="${track.muted}" aria-label="Mute ${esc(track.name)}">M</button><button class="track-toggle" data-audio-action="solo" aria-pressed="${track.solo}" aria-label="Solo ${esc(track.name)}">S</button><button class="icon-button" data-audio-action="import-track" aria-label="Add audio to ${esc(track.name)}" title="Import onto this track">${this.icon('plus')}</button><button class="icon-button" data-audio-action="remove-track" aria-label="Remove track ${esc(track.name)}">${this.icon('trash')}</button></div></div><div class="track-lane" tabindex="0" role="group" aria-label="${esc(track.name)} timeline. Click empty space to seek." data-audio-action="seek">${track.clips.map(clip=>this.clipMarkup(clip,track)).join('')}${!track.clips.length?'<span class="empty-lane">Drop audio here · clips share this track</span>':''}</div><div class="track-controls"><label class="track-control">Volume<input type="range" min="0" max="150" value="${Math.round(track.volume*100)}" data-layer-field="volume" aria-label="Volume for ${esc(track.name)}"><output data-output="volume">${Math.round(track.volume*100)}%</output></label><label class="track-control pan">Pan<input type="range" min="-100" max="100" value="${Math.round(track.pan*100)}" data-layer-field="pan" aria-label="Pan for ${esc(track.name)}"><output data-output="pan">${this.panText(track.pan)}</output></label></div></article>`).join('');
    this.renderInspector();this.setPlaying(this.player.playing);this.updatePlayhead(this.player.position,length);
  }
  renderInspector(){
    const {clip,track}=this.selected(),box=$('#clip-inspector');
    if(!clip){box.innerHTML='<div class="inspector-empty"><strong>Your clips, your arrangement.</strong><p>Select a clip to trim, split, loop, change tempo, or preview it.</p></div>';return;}
    const end=clipEnd(clip,this.length,track,this.getSong().bpm),missing=!this.mixer.buffers.has(clip.assetId),timing=clipTiming(clip,clip.duration,this.getSong().bpm),canSplit=this.player.position>clip.start+.02&&this.player.position<end-.02;
    box.innerHTML=`<div class="clip-inspector-heading"><div><span class="eyebrow">SELECTED CLIP · ${esc(track.name)}</span><input class="clip-title-input" data-clip-field="name" aria-label="Selected clip name" maxlength="200" value="${esc(clip.name)}"><p>${esc(clip.filename)} · ${precise(end-clip.start)} on timeline${this.unsaved.has(clip.assetId)?' · session only':''}</p></div><button class="button" data-audio-action="play-clip" ${missing||this.busy?'disabled':''}>${this.icon('play')}Preview clip</button></div>${missing?`<div class="track-missing"><span>${esc(this.errors.get(clip.assetId)||'Source file missing on this device.')}</span><button class="button" data-audio-action="relink">Relink audio</button></div>`:''}<div class="clip-edit-actions"><button class="button" data-audio-action="split" id="clip-split" ${!canSplit||this.busy?'disabled':''}>Split at playhead</button><button class="button" data-audio-action="duplicate" ${this.busy?'disabled':''}>${this.icon('copy')}Duplicate</button><button class="button" data-audio-action="connect" ${this.busy?'disabled':''}>Connect to previous</button><button class="button" data-audio-action="tidy" ${missing||this.busy?'disabled':''}>Trim silence</button><button class="button" data-audio-action="download-source">${this.icon('download')}Original</button><button class="icon-button" data-audio-action="remove-clip" aria-label="Delete selected clip" ${this.busy?'disabled':''}>${this.icon('trash')}</button></div><div class="clip-settings"><label>Track<select data-clip-field="track" aria-label="Track for selected clip">${this.getSong().audioLayers.map(t=>`<option value="${esc(t.id)}" ${t.id===track.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>Start · seconds<input type="number" min="0" max="1800" step=".01" data-clip-field="start" value="${number(clip.start)}"></label><label>Source in · seconds<input type="number" min="0" max="${clip.duration-.01}" step=".01" data-clip-field="trimStart" value="${number(clip.trimStart)}"></label><label>Source out · seconds<input type="number" min=".01" max="${clip.duration}" step=".01" data-clip-field="trimEnd" value="${number(clip.trimEnd)}"></label><label>Fade in · ms<input type="number" min="0" max="10000" step="5" data-clip-field="fadeIn" value="${Math.round(clip.fadeIn*1000)}"></label><label>Fade out · ms<input type="number" min="0" max="10000" step="5" data-clip-field="fadeOut" value="${Math.round(clip.fadeOut*1000)}"></label><label>Clip gain · %<input type="number" min="0" max="150" step="1" data-clip-field="volume" value="${Math.round(clip.volume*100)}"></label><label>Original BPM<input type="number" min="40" max="240" step="1" data-clip-field="sourceBpm" value="${number(clip.sourceBpm)}"></label><label>Speed · pitch kept<select data-clip-field="speed">${[.5,.75,1,1.25,1.5,2].map(v=>`<option value="${v}" ${v===clip.speed?'selected':''}>${v}×</option>`).join('')}</select></label><label>Loop length · seconds<input type="number" min=".01" max="1800" step=".01" data-clip-field="loopLength" value="${number(clip.loopLength||end-clip.start)}" ${clip.loop?'':'disabled'}></label></div><div class="clip-switches"><label><input type="checkbox" data-clip-field="followTempo" ${clip.followTempo?'checked':''}>Follow song tempo</label><label><input type="checkbox" data-clip-field="autoLevel" ${clip.autoLevel?'checked':''}>Auto level</label><label><input type="checkbox" data-clip-field="reverse" ${clip.reverse?'checked':''}>Reverse</label><label><input type="checkbox" data-clip-field="loop" ${clip.loop?'checked':''}>Loop</label><label><input type="checkbox" data-clip-field="muted" ${clip.muted?'checked':''}>Mute clip</label></div><div class="loop-tools"><label>Fit one pass to <select id="clip-fit-bars" aria-label="Bars for tempo fit"><option value="1">1 bar</option><option value="2">2 bars</option><option value="4" selected>4 bars</option><option value="8">8 bars</option><option value="16">16 bars</option></select></label><button class="text-button" data-audio-action="fit-bars">Fit tempo to bars</button><button class="text-button" data-audio-action="loop-double">Double loop</button><span>One pass · ${precise(timing.length)} · ${number(clipRate(clip,this.getSong().bpm))}× source tempo</span></div><p class="clip-help">Trim handles change the edges. Drag the clip body to move it. Auto smooth blends joins and loop seams internally; clips remain separate. Original BPM starts at the song tempo when imported.</p>`;
  }
  panText(pan){return Math.abs(pan)<.01?'C':`${Math.round(Math.abs(pan)*100)}${pan<0?'L':'R'}`;}
  setPlaying(playing){$('#layer-play-button').innerHTML=`${this.icon(playing?'pause':'play')}${playing?'Pause layers':'Play layers'}`;$('#audio-clock').textContent=precise(this.player.position);}
  updatePlayhead(position,length=this.length){$('#audio-layer-list').style.setProperty('--playhead',`${clamp(position/Math.max(.01,length)*100,0,100)}%`);$('#audio-clock').textContent=precise(position);const split=document.getElementById('clip-split'),{clip,track}=this.selected();if(split&&clip)split.disabled=this.busy||position<=clip.start+.02||position>=clipEnd(clip,length,track,this.getSong().bpm)-.02;}
  timeAt(lane,x){const box=lane.getBoundingClientRect();return clamp((x-box.left)/box.width,0,1)*this.length;}
  async importFiles(files){
    if(this.busy||!files.length)return;
    const song=this.getSong(),version=this.version,target=this.pendingImport;this.pendingImport=null;this.pause();this.checkpoint();this.busy=true;this.render();let added=0,lastError='',cursor=target?.start||0;
    for(const file of target?.replaceId?files.slice(0,1):files){
      if(song!==this.getSong()||version!==this.version)break;
      if(this.clips.length>=MAX_CLIPS&&!target?.replaceId){lastError=`A song can hold ${MAX_CLIPS} separate clips.`;break;}
      if(!target?.trackId&&song.audioLayers.length>=MAX_LAYERS){lastError='Create clips on an existing track using its + button, or drop audio onto that track.';break;}
      this.status(`Decoding ${file.name||'your recording'}…`);
      try{
        const buffer=await this.mixer.decode(file);if(song!==this.getSong()||version!==this.version)break;
        const assetId=uid(),asset={id:assetId,name:file.name||'Vocal take.wav',blob:file};try{await this.store.put(asset);}catch(e){this.unsaved.add(assetId);lastError='Audio is playable for this session, but device storage could not save it. Keep your original file.';}
        if(song!==this.getSong()||version!==this.version)break;
        let track=this.track(target?.trackId),existing=track?.clips.find(c=>c.id===target?.replaceId);
        const clip=normalizeClip({...existing,id:existing?.id||uid(),assetId,name:existing?.name||file.name?.replace(/\.[^.]+$/,'')||'Vocal take',filename:file.name||'Vocal take.wav',duration:buffer.duration,trimStart:0,trimEnd:buffer.duration,sourceBpm:existing?.sourceBpm||song.bpm,start:existing?.start??cursor},song.bpm);
        if(!track){track=normalizeLayer({id:uid(),name:clip.name,clips:[]},song.bpm);song.audioLayers.push(track);}
        if(existing){const oldAsset=existing.assetId;for(const shared of this.clips.filter(c=>c.assetId===oldAsset)){Object.assign(shared,normalizeClip({...shared,assetId,filename:clip.filename,duration:buffer.duration,trimStart:Math.min(shared.trimStart,buffer.duration-.01),trimEnd:Math.min(shared.trimEnd,buffer.duration)},song.bpm));}this.errors.delete(oldAsset);}
        else {Object.assign(clip,placeClip(clip,track,cursor,song.bpm,this.snap));track.clips.push(clip);cursor=clip.start+clipTiming(clip,clip.duration,song.bpm).length;}
        this.mixer.buffers.set(assetId,buffer);this.peaks.set(assetId,waveformPeaks(buffer));this.selection=clip.id;added++;
      }catch(e){lastError=`${file.name||'Audio'}: ${e.message}`;this.notify(lastError);}
    }
    if(song!==this.getSong()||version!==this.version)return;this.busy=false;this.commit();this.status(lastError||`${added} clip${added===1?'':'s'} imported. Select a clip to edit or preview it.`,!!lastError);
  }
  async audition(track,clip){
    if(this.busy)return;this.pause();this.mixer.auditionTrack=clip?null:track.id;this.mixer.auditionClip=clip?.id||null;
    const start=clip?.start??Math.min(...track.clips.map(c=>c.start)),end=clip?clipEnd(clip,this.length,track,this.getSong().bpm):Math.max(...track.clips.map(c=>clipEnd(c,this.length,track,this.getSong().bpm)));
    this.player.seek(start);this.status('Preparing tempo and smooth transitions…');this.setPlaying(true);await this.player.play({countIn:false,metronome:false,loop:false,end});this.onLengthChanged();this.setPlaying(this.player.playing);if(this.player.playing)this.status(`Playing ${clip?'clip':'track'}: ${clip?.name||track.name}.`);
  }
  async click(event){
    const button=event.target.closest('[data-audio-action]');if(!button||button.disabled)return;
    const action=button.dataset.audioAction;if(this.suppressClick&&['select','seek'].includes(action)){this.suppressClick=false;event.preventDefault();return;}
    const song=this.getSong(),track=this.track(button.closest('[data-track]')?.dataset.track),selected=this.selected();let clip=selected.clip,selectedTrack=selected.track;
    try{
      if(action==='import'||action==='import-track'||action==='relink'){
        if(this.busy)return;this.pendingImport=action==='relink'?{trackId:selectedTrack.id,replaceId:clip.id}:action==='import-track'?{trackId:track.id,start:Math.max(0,...track.clips.map(c=>clipEnd(c,this.length,track,song.bpm)))}:null;
        $('#audio-import').multiple=action!=='relink';$('#audio-import').click();return;
      }
      if(action==='play'){this.mixer.auditionClip=null;this.mixer.auditionTrack=null;this.status('Preparing tempo and smooth transitions…');await this.onPlay();if(this.player.playing)this.status(`Playing all audible tracks at ${song.bpm} BPM.`);else if(!$('#audio-status').classList.contains('error'))this.status('Playback paused.');return;}
      if(action==='stop'){this.pause();this.player.seek(0);this.mixer.auditionClip=null;this.mixer.auditionTrack=null;this.onLengthChanged();return;}
      if(action==='play-track'&&track){await this.audition(track);return;}
      if(action==='play-clip'&&clip){await this.audition(selectedTrack,clip);return;}
      if(action==='seek'){if(event.detail===0)return;this.player.seek(this.timeAt(button,event.clientX));return;}
      if(action==='select'){this.selection=button.dataset.clip;this.render();return;}
      if(action==='undo'||action==='redo'){this.history(action==='redo');return;}
      if(this.busy&&action!=='download-source')return;
      if(action==='new-track'){if(song.audioLayers.length>=MAX_LAYERS)return;this.pause();this.checkpoint();song.audioLayers.push(normalizeLayer({id:uid(),name:`Track ${song.audioLayers.length+1}`,clips:[]},song.bpm));this.commit('Drop audio onto your new track.');return;}
      if((action==='mute'||action==='solo')&&track){this.checkpoint();track[action==='mute'?'muted':'solo']=!track[action==='mute'?'muted':'solo'];this.mixer.syncGains();this.save();this.render();return;}
      if(action==='remove-track'&&track){this.pause();this.checkpoint();song.audioLayers.splice(song.audioLayers.indexOf(track),1);this.commit('Track removed. Use Undo to restore it.');return;}
      if(action==='export'){
        this.pause();this.busy=true;this.render();this.status('Rendering your tempo-matched mix…');
        try{const audible=song.audioLayers.map(t=>({...t,clips:layerGain(t,song.audioLayers)>0?t.clips.filter(c=>!c.muted&&c.volume>0):[]})),autoLoop=allClips(audible).some(c=>c.loop&&!c.loopLength),length=autoLoop?this.length:sessionLength(0,audible,song.bpm);const blob=await this.mixer.exportWav(length);this.download(blob,`${this.slug(song.title)}-mix.wav`,'audio/wav');this.status('WAV downloaded with your tempo, trims, loops, fades, levels, and smooth joins.');}
        finally{this.busy=false;this.render();}return;
      }
      if(action==='add-memo'){if(!this.memo)return;this.openView();this.pendingImport=null;await this.importFiles([new File([this.memo.blob],this.memo.name,{type:this.memo.blob.type})]);return;}
      if(!clip)return;
      if(action==='download-source'){const asset=await this.store.get(clip.assetId);if(!asset)throw new Error('Relink the source file before downloading.');this.download(asset.blob,clip.filename);return;}
      if(action==='remove-clip'){this.pause();this.checkpoint();selectedTrack.clips.splice(selectedTrack.clips.indexOf(clip),1);this.selection=selectedTrack.clips[0]?.id||null;this.commit('Clip removed. The source file is unchanged. Use Undo to restore the clip.');return;}
      if(action==='split'){
        if(this.clips.length>=MAX_CLIPS)throw new Error('This song has reached its clip limit.');const parts=splitClip(clip,this.player.position,clipEnd(clip,this.length,selectedTrack,song.bpm),song.bpm);if(!parts)throw new Error('Move the playhead inside the selected clip to split it.');this.pause();this.checkpoint();selectedTrack.clips.splice(selectedTrack.clips.indexOf(clip),1,...parts);this.selection=parts[1].id;this.commit('Split into two separate clips. Their audio stays connected.');return;
      }
      if(action==='duplicate'){
        if(this.clips.length>=MAX_CLIPS)throw new Error('This song has reached its clip limit.');this.pause();this.checkpoint();const copy={...clip,id:uid()},end=clipEnd(clip,this.length,selectedTrack,song.bpm);if(copy.loop&&!copy.loopLength)copy.loopLength=end-clip.start;Object.assign(copy,placeClip(copy,selectedTrack,end,song.bpm,'edges'));selectedTrack.clips.push(copy);this.selection=copy.id;this.commit('Independent copy placed beside the original.');return;
      }
      if(action==='connect'){const previous=selectedTrack.clips.filter(c=>c.id!==clip.id&&c.start<clip.start).sort((a,b)=>b.start-a.start)[0];if(!previous)throw new Error('Place another clip earlier on this track first.');this.pause();this.checkpoint();clip.start=clipEnd(previous,this.length,selectedTrack,song.bpm);this.commit('Clip edges connected. Both clips remain separate.');return;}
      if(action==='tidy'){
        const buffer=this.mixer.buffers.get(clip.assetId);if(!buffer)return;const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),rate=buffer.sampleRate;let from=Math.round(clip.trimStart*rate),to=Math.round(clip.trimEnd*rate),peak=0;
        for(const channel of channels)for(let i=from;i<to;i++)peak=Math.max(peak,Math.abs(channel[i]));const threshold=Math.max(.0005,peak*.008),silent=i=>channels.every(c=>Math.abs(c[i])<threshold);
        while(from<to-1&&silent(from))from++;while(to>from+1&&silent(to-1))to--;if(to-from<rate*.02)throw new Error('No clear audible region found to trim.');this.pause();this.checkpoint();clip.trimStart=Math.max(clip.trimStart,from/rate-.008);clip.trimEnd=Math.min(clip.trimEnd,to/rate+.025);this.commit('Quiet outer edges trimmed, with room left for the attack and tail.');return;
      }
      if(action==='fit-bars'){
        const bars=Number($('#clip-fit-bars').value),target=bars*song.meter*60/song.bpm,sourceBpm=bars*song.meter*60/(clip.trimEnd-clip.trimStart);if(sourceBpm<40||sourceBpm>240)throw new Error('Choose a bar count that gives an original tempo between 40 and 240 BPM.');this.pause();this.checkpoint();clip.sourceBpm=sourceBpm;clip.speed=1;clip.followTempo=true;if(clip.loop)clip.loopLength=target*4;this.reflow(selectedTrack,clip);this.commit(`One pass fits exactly ${bars} bar${bars===1?'':'s'} at ${song.bpm} BPM, with pitch preserved.`);return;
      }
      if(action==='loop-double'){this.pause();this.checkpoint();const span=clipEnd(clip,this.length,selectedTrack,song.bpm)-clip.start;clip.loop=true;clip.loopLength=Math.min(1800,span*2);this.reflow(selectedTrack,clip);this.commit('Loop length doubled. Its internal seam is smoothed automatically.');}
    }catch(error){this.status(error.message,true);this.notify(error.message);}
  }
  // Ripple only clips that would otherwise collide after a duration edit.
  reflow(track,edited){const sorted=[...track.clips].sort((a,b)=>a.start-b.start);let end=0;for(const clip of sorted){clip.start=Math.max(end,clip.start);end=clip.start+(clip.loop&&clip.loopLength>0?clip.loopLength:clipTiming(clip,clip.duration,this.getSong().bpm).length);}}
  input(event){
    const input=event.target;
    if(input.id==='master-volume'){this.getSong().masterVolume=Number(input.value)/100;this.mixer.volume=this.getSong().masterVolume;this.mixer.syncGains();$('#master-value').textContent=`${input.value}%`;this.save();return;}
    const field=input.dataset.layerField,track=this.track(input.closest('[data-track]')?.dataset.track);
    if(track&&['volume','pan','name'].includes(field)){track[field]=field==='name'?input.value:Number(input.value)/100;if(field!=='name'){this.mixer.syncGains();input.closest('[data-track]').querySelector(`[data-output="${field}"]`).textContent=field==='volume'?`${input.value}%`:this.panText(track.pan);}this.save();}
    if(input.dataset.clipField==='name'){const {clip}=this.selected();if(clip){clip.name=input.value;this.save();}}
  }
  async change(event){
    const input=event.target;
    if(input.id==='audio-import'){const files=[...input.files];input.value='';await this.importFiles(files);return;}
    if(input.id==='audio-zoom'){this.zoom=Number(input.value);this.render();return;}
    if(input.id==='audio-snap'){this.snap=input.value;return;}
    if(input.id==='audio-smooth'){this.pause();this.checkpoint();this.getSong().audioSmooth=input.checked;this.commit(input.checked?'Automatic loop and join smoothing enabled.':'Automatic smoothing disabled. Manual fades still apply.');return;}
    if(input.id==='master-volume'||input.dataset.layerField||input.dataset.clipField==='name'){if(this.fieldSnapshot&&this.fieldSnapshot!==this.snapshot())this.checkpoint(this.fieldSnapshot);this.fieldSnapshot=null;if(input.dataset.layerField==='name'||input.dataset.clipField==='name')this.render();else {$('#audio-undo').disabled=!this.undo.length;$('#audio-redo').disabled=!this.redo.length;}return;}
    const field=input.dataset.clipField,{clip,track}=this.selected();if(!clip||!field||this.busy)return;
    this.pause();this.checkpoint();
    if(field==='track'){const next=this.track(input.value);if(next&&next!==track){track.clips.splice(track.clips.indexOf(clip),1);Object.assign(clip,placeClip(clip,next,clip.start,this.getSong().bpm,this.snap));next.clips.push(clip);}}
    else {
      let value=input.type==='checkbox'?input.checked:Number(input.value);if(['fadeIn','fadeOut'].includes(field))value/=1000;if(field==='volume')value/=100;
      clip[field]=value;if(field==='loop'&&value&&!clip.loopLength)clip.loopLength=clipTiming(clip,clip.duration,this.getSong().bpm).length*4;
      Object.assign(clip,normalizeClip(clip,this.getSong().bpm));
      if(field==='start')Object.assign(clip,placeClip(clip,track,clip.start,this.getSong().bpm,this.snap));
      else if(['trimStart','trimEnd','loop','loopLength','speed','sourceBpm','followTempo'].includes(field))this.reflow(track,clip);
    }
    this.commit('Clip updated. Press Preview clip or Play layers to listen.');
  }
  pointerDown(event){
    const element=event.target.closest('.audio-clip');if(!element||event.button!==0||this.busy)return;
    const track=this.track(element.closest('[data-track]').dataset.track),clip=track.clips.find(c=>c.id===element.dataset.clip);if(!clip)return;
    event.preventDefault();this.selection=clip.id;this.renderInspector();document.querySelectorAll('.audio-clip.selected').forEach(el=>el.classList.remove('selected'));element.classList.add('selected');
    const lane=element.closest('.track-lane');this.drag={id:event.pointerId,clip,original:{...clip},track,element,lane,edge:event.target.closest('[data-trim]')?.dataset.trim||null,x:event.clientX,y:event.clientY,width:lane.getBoundingClientRect().width,length:this.length,span:clipEnd(clip,this.length,track,this.getSong().bpm)-clip.start,moved:false,target:track};element.setPointerCapture?.(event.pointerId);
  }
  pointerMove(event){
    const drag=this.drag;if(!drag||event.pointerId!==drag.id)return;
    if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;
    if(!drag.moved){this.pause();drag.moved=true;drag.element.classList.add('dragging');}
    event.preventDefault();const bpm=this.getSong().bpm;let delta=(event.clientX-drag.x)/drag.width*drag.length;
    document.querySelectorAll('.track-lane.drop-target').forEach(el=>el.classList.remove('drop-target'));
    if(drag.edge){
      const origin=drag.original.start+(drag.edge==='right'?drag.span:0),snapped=snapPosition(origin+delta,0,drag.track.clips,bpm,event.altKey?'off':this.snap,Math.min(.3,9/drag.width*drag.length),drag.clip.id);delta=snapped.start-origin;
      let proposed=trimClip(drag.original,drag.edge,delta,bpm,drag.span),prev=drag.track.clips.filter(c=>c.id!==drag.clip.id&&c.start<drag.original.start).sort((a,b)=>b.start-a.start)[0],next=drag.track.clips.filter(c=>c.id!==drag.clip.id&&c.start>drag.original.start).sort((a,b)=>a.start-b.start)[0];
      if(drag.edge==='left'&&prev){const min=clipEnd(prev,drag.length,drag.track,bpm);if(proposed.start<min)proposed=trimClip(drag.original,'left',min-drag.original.start,bpm,drag.span);}
      if(drag.edge==='right'&&next){const proposedEnd=clipEnd(proposed,drag.length,drag.track,bpm);if(proposedEnd>next.start)proposed=trimClip(drag.original,'right',next.start-drag.original.start-drag.span,bpm,drag.span);}
      drag.proposed=proposed;const span=proposed.loop?proposed.loopLength:clipTiming(proposed,proposed.duration,bpm).length;drag.element.style.setProperty('--clip-start',`${proposed.start/drag.length*100}%`);drag.element.style.setProperty('--clip-width',`${span/drag.length*100}%`);this.status(`Trim ${drag.edge==='left'?'start':'end'} · ${precise(proposed.start)} → ${precise(proposed.start+span)}`);
    }else {
      const hit=document.elementFromPoint(event.clientX,event.clientY),lane=hit?.closest('.track-lane')||hit?.closest('[data-track]')?.querySelector('.track-lane')||drag.lane,target=this.track(lane.closest('[data-track]').dataset.track);
      const box=lane.getBoundingClientRect(),grab=(drag.x-drag.lane.getBoundingClientRect().left)/drag.width*drag.length-drag.original.start,desired=clamp((event.clientX-box.left)/box.width*drag.length-grab,0,1800),copy={...drag.original};if(copy.loop&&!copy.loopLength)copy.loopLength=drag.span;
      const placement=placeClip(copy,target,desired,bpm,event.altKey?'off':this.snap,Math.min(.3,9/box.width*drag.length));drag.target=target;drag.proposed={...copy,start:placement.start};lane.classList.add('drop-target');
      if(!drag.ghost){drag.ghost=drag.element.cloneNode(true);drag.ghost.removeAttribute('data-clip');drag.ghost.removeAttribute('data-audio-action');drag.ghost.classList.add('clip-ghost');drag.ghost.setAttribute('aria-hidden','true');}
      lane.append(drag.ghost);drag.ghost.style.setProperty('--clip-start',`${placement.start/drag.length*100}%`);drag.ghost.style.setProperty('--clip-width',`${drag.span/drag.length*100}%`);this.status(`${placement.snapped?'Snapped':'Move'} · ${target.name} · ${precise(placement.start)}. Release to place; hold Alt to bypass snapping.`);
    }
  }
  pointerUp(event){const drag=this.drag;if(!drag||event.pointerId!==drag.id)return;this.drag=null;drag.ghost?.remove();document.querySelectorAll('.track-lane.drop-target').forEach(el=>el.classList.remove('drop-target'));if(drag.moved&&drag.proposed){this.checkpoint();if(drag.target!==drag.track){drag.track.clips.splice(drag.track.clips.indexOf(drag.clip),1);drag.target.clips.push(drag.clip);}Object.assign(drag.clip,drag.proposed);this.suppressClick=true;setTimeout(()=>this.suppressClick=false,0);this.commit('Clip placed. Connected edges stay separate and editable.');}else {this.suppressClick=true;setTimeout(()=>this.suppressClick=false,0);this.render();}}
  cancelDrag(){if(!this.drag)return;this.drag.ghost?.remove();this.drag=null;document.querySelectorAll('.track-lane.drop-target').forEach(el=>el.classList.remove('drop-target'));}
  keydown(event){
    if($('#layers-view').hidden||event.target.closest('input,textarea,select,[contenteditable]')||event.target.closest('dialog,[role=tablist]'))return;
    const key=event.key.toLowerCase(),command=event.ctrlKey||event.metaKey;
    if(command&&key==='z'){event.preventDefault();this.history(event.shiftKey);return;}if(command&&key==='y'){event.preventDefault();this.history(true);return;}
    const {clip,track}=this.selected();if(!clip||this.busy)return;
    const action=key==='delete'||key==='backspace'?'remove-clip':command&&key==='d'?'duplicate':key==='s'&&!command?'split':null;
    if(action){event.preventDefault();document.querySelector(`#clip-inspector [data-audio-action="${action}"]`)?.click();return;}
    if(['arrowleft','arrowright'].includes(key)){event.preventDefault();this.pause();this.checkpoint();const step=event.shiftKey?60/this.getSong().bpm:.01,direction=key==='arrowleft'?-1:1;Object.assign(clip,placeClip(clip,track,Math.max(0,clip.start+direction*step),this.getSong().bpm,'off'));this.commit('Clip nudged. Shift + arrow moves one beat.');}
  }
}
