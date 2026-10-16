import {uid,esc,stats,timeLabel,clamp} from './core.js';
import {MAX_LAYERS,normalizeLayer,clipTiming,sessionLength,waveformPeaks,layerGain} from './layer-core.js';
import {LayerMixer} from './layers.js';
import {AudioStore} from './audio-store.js';
const $=selector=>document.querySelector(selector);
const precise=seconds=>`${Math.floor(seconds/60)}:${(seconds%60).toFixed(2).padStart(5,'0')}`;

export class LayerStudio {
  constructor({getSong,player,icon,notify,save,onLengthChanged,onPlay,openView,download,slug}) {
    Object.assign(this,{getSong,player,icon,notify,save,onLengthChanged,onPlay,openView,download,slug});
    this.mixer=new LayerMixer();this.store=new AudioStore();this.player.mixer=this.mixer;this.busy=false;this.version=0;this.replaceId=null;this.peaks=new Map();this.errors=new Map();this.unsaved=new Set();this.memo=null;
    document.addEventListener('click',e=>this.click(e));document.addEventListener('input',e=>this.input(e));document.addEventListener('change',e=>this.change(e));
    $('#audio-drop').addEventListener('dragover',e=>{e.preventDefault();$('#audio-drop').classList.add('drag-over');});
    $('#audio-drop').addEventListener('dragleave',()=>$('#audio-drop').classList.remove('drag-over'));
    $('#audio-drop').addEventListener('drop',e=>{e.preventDefault();$('#audio-drop').classList.remove('drag-over');if(!this.busy){this.replaceId=null;this.importFiles([...e.dataTransfer.files]);}});
  }
  get length() {return sessionLength(stats(this.getSong()).seconds,this.getSong().audioLayers||[]);}
  status(text,error=false) {$('#audio-status').textContent=text;$('#audio-status').classList.toggle('error',error);}
  async loadSong() {
    const version=++this.version,song=this.getSong();song.audioLayers||=[];
    this.mixer.reset(song.audioLayers);this.mixer.volume=song.masterVolume??.85;this.peaks.clear();this.errors.clear();this.busy=true;this.render();
    let missing=0;
    for(const layer of song.audioLayers) {
      if(version!==this.version)return;
      try {
        const asset=await this.store.get(layer.assetId);if(version!==this.version)return;
        if(!asset)throw new Error('This audio file is not on this device.');
        if(!this.mixer.buffers.has(layer.assetId)) {
          const buffer=await this.mixer.decode(asset.blob);if(version!==this.version)return;
          this.mixer.buffers.set(layer.assetId,buffer);this.peaks.set(layer.assetId,waveformPeaks(buffer));
        }
      }catch(e){if(version!==this.version)return;missing++;this.errors.set(layer.id,e.message);}
    }
    if(version!==this.version)return;
    this.busy=false;this.render();this.onLengthChanged();
    this.status(missing?`${missing} audio file${missing===1?' is':'s are'} missing. Relink the original${missing===1?' file':' files'} below.`:song.audioLayers.length?'Your layers are ready. Press Play layers to listen together.':'Import your first recording to start layering.',missing>0);
  }
  render() {
    const song=this.getSong(),layers=song.audioLayers||[],length=this.length;
    $('#master-volume').value=Math.round((song.masterVolume??.85)*100);$('#master-value').textContent=`${$('#master-volume').value}%`;
    $('#audio-layer-count').textContent=`${layers.length} / ${MAX_LAYERS} layers`;
    $('#audio-session-duration').textContent=`Session · ${timeLabel(length)}`;
    $('#audio-ruler').innerHTML=Array.from({length:5},(_,i)=>`<span>${timeLabel(length*i/4)}</span>`).join('');
    $('#import-audio-button').disabled=this.busy||layers.length>=MAX_LAYERS;$('#audio-drop').disabled=this.busy||layers.length>=MAX_LAYERS;
    $('#audio-drop').hidden=layers.length>=MAX_LAYERS;$('#export-mix-button').disabled=this.busy||!this.mixer.ready;
    $('#layer-play-button').disabled=this.busy||!this.mixer.ready;
    $('#audio-layer-list').innerHTML=layers.map((layer,index)=>{
      const buffer=this.mixer.buffers.get(layer.assetId),clip=clipTiming(layer),start=clip.start/length*100,width=(layer.loop?length-clip.start:clip.length)/length*100;
      const peaks=this.peaks.get(layer.assetId)||[],bars=peaks.map((p,i)=>`<rect x="${i*2+.4}" y="${24-Math.max(1,p*21)}" width="1.2" height="${Math.max(2,p*42)}" rx=".6"/>`).join('');
      const missing=!buffer&&!this.busy;
      return `<article class="audio-track ${layerGain(layer,layers)===0?'is-muted':''}" data-layer="${esc(layer.id)}"><div class="track-heading"><span class="track-number">${String(index+1).padStart(2,'0')}</span><div class="track-title-group"><input class="track-title" data-layer-field="name" value="${esc(layer.name)}" maxlength="200" aria-label="Name for audio layer ${index+1}"><span class="track-source">${esc(layer.filename)} · ${precise(layer.duration)}${this.unsaved.has(layer.assetId)?' · session only':this.busy&&!buffer?' · loading…':''}</span></div><div class="track-actions"><button class="track-toggle" data-audio-action="mute" aria-pressed="${layer.muted}" aria-label="Mute ${esc(layer.name)}" title="Mute">M</button><button class="track-toggle" data-audio-action="solo" aria-pressed="${layer.solo}" aria-label="Solo ${esc(layer.name)}" title="Solo">S</button><button class="icon-button" data-audio-action="download-source" aria-label="Download original ${esc(layer.name)}">${this.icon('download')}</button><button class="icon-button" data-audio-action="remove" aria-label="Remove audio layer ${esc(layer.name)}">${this.icon('trash')}</button></div></div>${missing?`<div class="track-missing"><span>${esc(this.errors.get(layer.id)||'Audio file missing from this device.')}</span><button class="button" data-audio-action="relink">Relink audio</button></div>`:`<button class="track-lane" data-audio-action="seek" aria-label="Seek in ${esc(layer.name)} timeline"><span class="audio-clip" style="--clip-start:${clamp(start,0,100)}%;--clip-width:${clamp(width,0,100)}%"><svg viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true" fill="currentColor">${bars}</svg>${layer.loop?'<span class="clip-loop">LOOP</span>':''}</span></button>`}<div class="track-controls"><label class="track-control">Volume<input type="range" min="0" max="150" value="${Math.round(layer.volume*100)}" data-layer-field="volume" aria-label="Volume for ${esc(layer.name)}"><output data-output="volume">${Math.round(layer.volume*100)}%</output></label><label class="track-control pan">Pan<input type="range" min="-100" max="100" value="${Math.round(layer.pan*100)}" data-layer-field="pan" aria-label="Pan for ${esc(layer.name)}"><output data-output="pan">${this.panText(layer.pan)}</output></label></div><div class="track-timing"><label>Start<input type="number" min="0" max="1800" step=".01" value="${Number(layer.start.toFixed(2))}" data-layer-field="start" aria-label="Start seconds for ${esc(layer.name)}"></label><label>Trim in<input type="number" min="0" max="${Math.max(0,layer.duration-.01)}" step=".01" value="${Number(layer.trimStart.toFixed(2))}" data-layer-field="trimStart" aria-label="Trim in seconds for ${esc(layer.name)}"></label><label>Trim out<input type="number" min=".01" max="${layer.duration}" step=".01" value="${Number(layer.trimEnd.toFixed(2))}" data-layer-field="trimEnd" aria-label="Trim out seconds for ${esc(layer.name)}"></label><label class="switch-label"><input type="checkbox" data-layer-field="loop" ${layer.loop?'checked':''}>Loop to end</label></div></article>`;
    }).join('');
    this.setPlaying(this.player.playing);this.updatePlayhead(this.player.position,length);
  }
  panText(pan) {return Math.abs(pan)<.01?'C':`${Math.round(Math.abs(pan)*100)}${pan<0?'L':'R'}`;}
  setPlaying(playing) {$('#layer-play-button').innerHTML=`${this.icon(playing?'pause':'play')}${playing?'Pause layers':'Play layers'}`;}
  updatePlayhead(position,length=this.length) {$('#audio-layer-list').style.setProperty('--playhead',`${clamp(position/Math.max(.01,length)*100,0,100)}%`);}
  async importFiles(files) {
    if(this.busy||!files.length)return;
    const song=this.getSong(),songId=song.id,version=this.version,replace=this.replaceId;this.replaceId=null;
    this.player.pause();this.setPlaying(false);this.onLengthChanged();this.busy=true;this.render();
    let added=0,lastError='';
    for(const file of replace?files.slice(0,1):files) {
      if(this.getSong().id!==songId||version!==this.version)break;
      if(!replace&&song.audioLayers.length>=MAX_LAYERS){lastError='A song can hold up to 12 audio layers.';break;}
      this.status(`Decoding ${file.name||'your recording'}…`);
      try {
        const buffer=await this.mixer.decode(file);if(this.getSong().id!==songId||version!==this.version)break;
        const assetId=uid(),asset={id:assetId,name:file.name||'Vocal take.wav',blob:file};let saved=true;
        try{await this.store.put(asset);}catch(e){saved=false;this.unsaved.add(assetId);}
        if(this.getSong().id!==songId||version!==this.version)break;
        const existing=replace?song.audioLayers.find(layer=>layer.id===replace):null;
        const layer=normalizeLayer({...existing,id:existing?.id||uid(),assetId,name:existing?.name||file.name?.replace(/\.[^.]+$/,'')||'Vocal take',filename:file.name||'Vocal take.wav',duration:buffer.duration,trimStart:0,trimEnd:buffer.duration});
        if(existing)Object.assign(existing,layer);else song.audioLayers.push(layer);
        this.mixer.buffers.set(assetId,buffer);this.peaks.set(assetId,waveformPeaks(buffer));this.errors.delete(layer.id);added++;
        if(!saved)lastError='Audio is ready for this session, but device storage could not save it. Keep your original file.';
      }catch(e){lastError=`${file.name||'Audio'}: ${e.message}`;this.notify(lastError);}
    }
    if(this.getSong().id!==songId||version!==this.version)return;
    this.busy=false;this.mixer.layers=song.audioLayers;this.save();this.onLengthChanged();this.render();
    this.status(lastError||`${added} audio layer${added===1?'':'s'} imported. Press Play layers, or switch to Rehearse.`,!!lastError);
    if(added)this.notify(`${added===1?'Audio layer':`${added} audio layers`} imported.`);
  }
  async click(event) {
    const button=event.target.closest('[data-audio-action]');if(!button||button.disabled)return;
    const action=button.dataset.audioAction,card=button.closest('[data-layer]'),song=this.getSong(),layer=song.audioLayers.find(layer=>layer.id===card?.dataset.layer);
    try {
      if(action==='import'){if(this.busy)return;this.replaceId=null;$('#audio-import').multiple=true;$('#audio-import').click();}
      if(action==='relink'&&layer){this.replaceId=layer.id;$('#audio-import').multiple=false;$('#audio-import').click();}
      if(action==='play')await this.onPlay();
      if(action==='mute'||action==='solo') {
        if(!layer)return;const field=action==='mute'?'muted':'solo';layer[field]=!layer[field];this.mixer.syncGains();this.save();this.render();
      }
      if(action==='seek') {const box=button.getBoundingClientRect();this.player.seek(clamp((event.clientX-box.left)/box.width,0,1)*this.length);}
      if(action==='remove'&&layer) {
        if(this.busy)return;this.player.pause();const index=song.audioLayers.indexOf(layer),buffer=this.mixer.buffers.get(layer.assetId),peaks=this.peaks.get(layer.assetId);
        song.audioLayers.splice(index,1);if(!song.audioLayers.some(other=>other.assetId===layer.assetId)){this.mixer.buffers.delete(layer.assetId);this.peaks.delete(layer.assetId);}
        this.save();this.onLengthChanged();this.render();this.status('Layer removed. Original files and downloads stay yours.');
        this.notify('Audio layer removed.',()=>{if(this.getSong().id!==song.id)return;song.audioLayers.splice(index,0,layer);if(buffer){this.mixer.buffers.set(layer.assetId,buffer);this.peaks.set(layer.assetId,peaks);}this.save();this.onLengthChanged();this.render();});
      }
      if(action==='download-source'&&layer) {const asset=await this.store.get(layer.assetId);if(!asset)throw new Error('Relink the original file before downloading.');this.download(asset.blob,layer.filename);}
      if(action==='export') {
        if(this.busy)return;this.player.pause();this.onLengthChanged();this.status('Rendering your audio layers into a stereo WAV…');button.disabled=true;
        try{const audible=song.audioLayers.filter(layer=>layerGain(layer,song.audioLayers)>0),length=audible.some(layer=>layer.loop)?this.length:sessionLength(0,audible);const blob=await this.mixer.exportWav(length);this.download(blob,`${this.slug(song.title)}-mix.wav`,'audio/wav');this.status('WAV mix downloaded. It includes audible layers, volume, pan, trim, offsets, and loops.');}
        finally{button.disabled=false;}
      }
      if(action==='add-memo') {
        if(!this.memo)return;this.openView();const file=new File([this.memo.blob],this.memo.name,{type:this.memo.blob.type});await this.importFiles([file]);
      }
    }catch(error){this.status(error.message,true);this.notify(error.message);}
  }
  input(event) {
    const input=event.target;
    if(input.id==='master-volume'){this.getSong().masterVolume=Number(input.value)/100;this.mixer.volume=this.getSong().masterVolume;this.mixer.syncGains();$('#master-value').textContent=`${input.value}%`;this.save();return;}
    const field=input.dataset.layerField,card=input.closest('[data-layer]'),layer=this.getSong().audioLayers.find(item=>item.id===card?.dataset.layer);if(!layer)return;
    if(field==='volume'||field==='pan'){layer[field]=Number(input.value)/100;this.mixer.syncGains();card.querySelector(`[data-output="${field}"]`).textContent=field==='volume'?`${input.value}%`:this.panText(layer.pan);card.classList.toggle('is-muted',layerGain(layer,this.getSong().audioLayers)===0);this.save();}
    if(field==='name'){layer.name=input.value;this.save();}
  }
  async change(event) {
    const input=event.target;
    if(input.id==='audio-import'){const files=[...input.files];input.value='';await this.importFiles(files);return;}
    const field=input.dataset.layerField,card=input.closest('[data-layer]'),layer=this.getSong().audioLayers.find(item=>item.id===card?.dataset.layer);if(!layer)return;
    if(['start','trimStart','trimEnd','loop'].includes(field)) {
      this.player.pause();layer[field]=field==='loop'?input.checked:Number(input.value);Object.assign(layer,normalizeLayer(layer));this.save();this.onLengthChanged();this.render();this.status('Timing updated. Press play to hear the new arrangement.');
    }
  }
}
