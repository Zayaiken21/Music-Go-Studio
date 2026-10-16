import {TYPES,KEYS,uid,clamp,esc,lines,words,syllables,section,createSong,demoSong,normalizeSong,sectionLabel,sectionSeconds,timeLabel,stats,timeline,exportLyrics,importLyrics,transposeSong,localRhymes,cleanInline} from './core.js';
import {Rehearsal,VoiceMemo,playPitch} from './audio.js';
import {LayerStudio} from './layer-ui.js';

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const STORAGE='music-go-studio:v1';
const icons={
  layers:'m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  plus:'M12 5v14M5 12h14',search:'m21 21-4.8-4.8M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',upload:'M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4',download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',help:'M9.5 8a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 4M12 16h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',note:'M9 18V5l11-2v13M9 8l11-2M9 18c0 1.7-1.6 3-3.5 3S2 20.1 2 18.8s1.6-2.8 3.5-2.8S9 16.7 9 18Zm11-2c0 1.7-1.6 3-3.5 3s-3.5-.9-3.5-2.2 1.6-2.8 3.5-2.8 3.5.7 3.5 2',pen:'m16 3 5 5L8 21H3v-5L16 3Zm-2 2 5 5M3 21l5-1',more:'M5 12h.01M12 12h.01M19 12h.01',sheet:'M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8m-8 4h6',mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1M12 18v4m-4 0h8',meter:'m12 3-8 17h16L12 3Zm0 4v9m-3-4 7-6M9 17h6',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4',arrow:'M5 12h14m-5-5 5 5-5 5',volume:'M11 4 6 8H2v8h4l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',play:'m8 4 13 8-13 8V4Z',pause:'M8 4v16M16 4v16',restart:'M3 11a9 9 0 1 1 2 7M3 4v7h7',printer:'M7 8V2h10v6M7 16H3V8h18v8h-4M7 12h10v10H7V12Zm11-1h.01',menu:'M4 6h16M4 12h16M4 18h16',close:'m6 6 12 12M6 18 18 6',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',up:'m6 15 6-6 6 6',down:'m6 9 6 6 6-6',copy:'M8 8h13v13H8V8ZM16 8V3H3v13h5',trash:'M3 6h18m-16 0 1 15h12l1-15M9 6V3h6v3M10 10v7m4-7v7',check:'m5 12 4 4L19 6'
};
const icon=name=>`<span class="icon">${icons[name]?`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"></path></svg>`:''}</span>`;
function hydrateIcons(root=document) {root.querySelectorAll('[data-icon]').forEach(node=>node.innerHTML=icon(node.dataset.icon).replace(/^<span class="icon">|<\/span>$/g,''));}
hydrateIcons();

let songs=[],activeId,view='write',showMeter=false,saveTimer,toastTimer,dragId=null,undoAction=null,rhymeController=null,memoUrl=null,recoveryData=null,storageBlocked=false;
let stageTimeline=[],stageIndex=-99,stageCounting=false,memoTitle='';
const taps=[];
const current=()=>songs.find(s=>s.id===activeId)||songs[0];
const player=new Rehearsal(updatePlayhead,()=>{setPlayButton(false);toast('Take a breath. That’s your song.');},message=>toast(message));
const layerStudio=new LayerStudio({getSong:current,player,icon,notify:toast,save:saveAudioSettings,onLengthChanged:refreshAudioTransport,onPlay:()=>togglePlay(true),openView:()=>setView('layers'),download,slug});
const memo=new VoiceMemo(status=>{$('#memo-status').textContent=status;},(blob,extension)=>{
  if(memoUrl) URL.revokeObjectURL(memoUrl);
  memoUrl=URL.createObjectURL(blob);
  const filename=`${slug(memoTitle||current().title)}-vocal-idea.${extension}`;
  layerStudio.memo={blob,name:filename};
  $('#memo-result').innerHTML=`<div class="memo-result-row"><audio controls src="${memoUrl}" aria-label="Your recorded vocal idea"></audio><a class="button" href="${memoUrl}" download="${esc(filename)}">Download take</a></div><div class="memo-result-actions"><button class="button" data-audio-action="add-memo">${icon('layers')}Add take as audio layer</button></div>`;
  $('#memo-status').textContent='Your take is ready. Download it to keep it; recordings are not included in song backups.';
  $('#record-button').classList.remove('recording');$('#record-button').innerHTML='<span class="record-dot"></span>Record again';
});

function load() {
  let raw;
  try {
    raw=localStorage.getItem(STORAGE);
    if(raw) {
      const data=JSON.parse(raw);
      if(!data || data.version!==1 || !Array.isArray(data.songs) || !data.songs.length || data.songs.length>200) throw new Error('Invalid songbook');
      const seen=new Set();
      songs=data.songs.map(s=>{
        const song=normalizeSong(s);
        if(typeof s.id==='string' && s.id.length<100 && !seen.has(s.id)) song.id=s.id;
        seen.add(song.id);song.updatedAt=typeof s.updatedAt==='string'?s.updatedAt:song.updatedAt;
        return song;
      });
      activeId=songs.some(s=>s.id===data.activeId)?data.activeId:songs[0].id;
    }
  } catch(error) {
    if(raw) {recoveryData=raw;storageBlocked=true;setTimeout(()=>toast('Saved data needs recovery. Open Quick guide to download the original before starting fresh.'),600);}
    else setTimeout(()=>toast('Device storage is unavailable. Use Export song to keep your work.'),600);
  }
  if(!songs.length) {songs=[demoSong()];activeId=songs[0].id;}
}
function saveStatus(message='Saved on this device',error=false) {const el=$('#save-status');el.classList.toggle('error',error);el.innerHTML=`<span></span>${esc(message)}`;}
function persist() {
  clearTimeout(saveTimer);
  if(storageBlocked) {saveStatus('Recovery needed',true);return false;}
  try {localStorage.setItem(STORAGE,JSON.stringify({version:1,activeId,songs}));saveStatus();return true;}
  catch(e) {saveStatus('Export to save your work',true);toast('Device storage is full or unavailable. Export a backup to keep your songs.');return false;}
}
function changed({editor=false,metadata=false}={}) {
  current().updatedAt=new Date().toISOString();
  if(player.playing) {player.pause();setPlayButton(false);}
  stageTimeline=timeline(current());stageIndex=-99;player.load(current(),playbackLength());
  if(editor) renderEditor();if(metadata) renderMetadata();
  renderSidebar();renderSummary();if(view==='sheet')renderSheet();if(view==='layers')layerStudio.render();
  saveStatus('Saving…');clearTimeout(saveTimer);saveTimer=setTimeout(persist,350);
}
function slug(text) {return text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,80)||'untitled-song';}
function playbackLength() {return layerStudio.length;}
function saveAudioSettings() {current().updatedAt=new Date().toISOString();saveStatus('Saving…');clearTimeout(saveTimer);saveTimer=setTimeout(persist,350);}
function refreshAudioTransport() {player.song=current();player.length=playbackLength();player.position=clamp(player.position,0,player.length);if(!player.playing)player.seek(player.position);renderSummary();setPlayButton(player.playing);}
function toast(message, undo=null) {
  clearTimeout(toastTimer);const box=$('#toast');
  box.innerHTML=esc(message)+(undo?' <button class="text-button" data-action="undo" style="color:#a7ccff;margin-left:9px">Undo</button>':'');
  box.hidden=false;if(undo)undoAction=undo;
  toastTimer=setTimeout(()=>{box.hidden=true;},undo?7000:4500);
}
function renderSidebar() {
  const query=$('#song-search').value.trim().toLowerCase();
  $('#song-count').textContent=songs.length;
  $('#song-list').innerHTML=songs.filter(s=>`${s.title} ${s.artist}`.toLowerCase().includes(query)).map(s=>`<button class="song-link ${s.id===activeId?'active':''}" data-action="open-song" data-id="${esc(s.id)}" ${s.id===activeId?'aria-current="true"':''}>${icon('note')}<span><strong>${esc(s.title||'Untitled song')}</strong><small>${s.sections.length} sections · ${esc(s.genre)}</small></span>${s.id===activeId?'<i class="active-mark"></i>':''}</button>`).join('')||'<p class="library-empty">No songs found. A new idea might be waiting.</p>';
}
function renderMetadata() {
  const song=current();
  $('#song-title').value=song.title;$('#song-artist').value=song.artist;
  if(![...$('#song-genre').options].some(o=>o.value===song.genre)) $('#song-genre').add(new Option(song.genre,song.genre));
  $('#song-genre').value=song.genre;$('#song-key').innerHTML=KEYS.map(k=>`<option value="${k}">${k}</option>`).join('');$('#song-key').value=song.key;
  $('#song-mode').value=song.mode;$('#song-bpm').value=song.bpm;$('#song-meter').value=song.meter;$('#song-notes').value=song.notes;
  $('#beat-dots').innerHTML=Array.from({length:song.meter},()=>'<i></i>').join('');
}
function renderSummary() {
  const song=current(),info=stats(song);
  $('#crumb-title').textContent=song.title||'Untitled song';$('#transport-title').textContent=song.title||'Untitled song';
  $('#transport-subtitle').textContent=`${song.key} ${song.mode} · ${song.bpm} BPM`;
  $('#word-count').textContent=`${info.words} words`;$('#section-count').textContent=`${song.sections.length} sections`;
  $('#total-duration').textContent=timeLabel(info.seconds);$('#transport-duration').textContent=timeLabel(playbackLength());$('#transport-bpm').textContent=song.bpm;
  $('#transpose-key').innerHTML=`${esc(song.key)} <small>${esc(song.mode)}</small>`;
  $('#arrangement').innerHTML=song.sections.map((s,i)=>`<button class="arrange-item type-${s.type.toLowerCase()}" data-action="jump-section" data-id="${esc(s.id)}"><i class="arrange-dot"></i><span>${esc(sectionLabel(song,i))}${s.repeats>1?` ×${s.repeats}`:''}</span><small>${s.bars*s.repeats} bars · ${timeLabel(sectionSeconds(song,s))}</small></button>`).join('');
  $('#stage-time').textContent=`${timeLabel(player.position)} / ${timeLabel(playbackLength())}`;
}
function renderEditor() {
  const song=current();
  $('#sections').innerHTML=song.sections.map((s,i)=>{
    const label=sectionLabel(song,i),n=label.match(/\d+$/)?.[0];
    return `<article class="section-card type-${s.type.toLowerCase()}" data-section="${esc(s.id)}" id="section-${esc(s.id)}" aria-label="${esc(label)} section"><div class="section-header"><div class="section-heading"><span class="drag-icon" draggable="true" title="Drag to rearrange" aria-hidden="true">⠿</span><label class="section-type"><select data-field="type" aria-label="Section type for ${esc(label)}">${TYPES.map(t=>`<option ${s.type===t?'selected':''}>${t}</option>`).join('')}</select>${n?`<span class="section-number">${n}</span>`:''}</label><span class="section-meta">${lines(s.lyrics).length} lines</span></div><div class="section-controls"><button class="icon-button" data-action="section-up" aria-label="Move ${esc(label)} up" ${i===0?'disabled':''}>${icon('up')}</button><button class="icon-button" data-action="section-down" aria-label="Move ${esc(label)} down" ${i===song.sections.length-1?'disabled':''}>${icon('down')}</button><button class="icon-button" data-action="section-copy" aria-label="Duplicate ${esc(label)}">${icon('copy')}</button><button class="icon-button" data-action="section-delete" aria-label="Remove ${esc(label)}">${icon('trash')}</button></div></div><div class="lyrics-row"><textarea class="lyrics-input" data-field="lyrics" rows="4" aria-label="Lyrics for ${esc(label)}" placeholder="${s.type==='Chorus'?'The line they will remember. Start here…':s.type==='Bridge'?'A new perspective. A turn in the story…':s.type==='Instrumental'?'Leave empty for an instrumental passage…':'One honest line is all it takes…'}" spellcheck="true">${esc(s.lyrics)}</textarea><div class="syllable-column" aria-label="Approximate English syllables per line" ${showMeter?'':'hidden'}>${meterMarkup(s.lyrics)}</div></div><div class="section-footer"><label class="chord-field">${icon('note')}<input data-field="chords" aria-label="Chord progression for ${esc(label)}" placeholder="Add chords, e.g. C  G  Am  F" value="${esc(s.chords)}" maxlength="1000"></label><div class="bar-settings"><label><input type="number" min="1" max="64" value="${s.bars}" data-field="bars" aria-label="Bars in ${esc(label)}">bars</label><label>×<input type="number" min="1" max="8" value="${s.repeats}" data-field="repeats" aria-label="Repeats for ${esc(label)}"></label></div></div><details class="section-details"><summary>Vocal direction ${s.notes?'· added':''}</summary><textarea rows="2" data-field="notes" aria-label="Private vocal direction for ${esc(label)}" placeholder="Soft delivery, a long note, a breath before the hook…">${esc(s.notes)}</textarea></details></article>`;
  }).join('');
  $$('.lyrics-input').forEach(resizeTextarea);
}
function meterMarkup(text) {return String(text).split('\n').map(line=>`<span>${line.trim()?syllables(line):'&nbsp;'}</span>`).join('');}
function resizeTextarea(el) {el.style.height='auto';el.style.height=`${Math.max(80,el.scrollHeight||lines(el.value).length*28+12)}px`;}
function renderSheet() {
  const song=current(),chords=$('#sheet-chords').checked;
  $('#song-sheet').innerHTML=`<h1 class="sheet-title">${esc(song.title||'Untitled song')}</h1>${song.artist?`<p class="sheet-artist">${esc(song.artist)}</p>`:''}<div class="sheet-meta">${esc(song.key)} ${esc(song.mode)} &nbsp; · &nbsp; ${song.bpm} BPM &nbsp; · &nbsp; ${song.meter} / ${song.meter===6?'8':'4'} &nbsp; · &nbsp; ${timeLabel(stats(song).seconds)} estimated</div>${song.sections.map((s,i)=>`<section class="sheet-section"><h3>${esc(sectionLabel(song,i))}${s.repeats>1?` (repeat ×${s.repeats})`:''}</h3>${chords&&s.chords?`<div class="sheet-chords">${esc(s.chords)}</div>`:''}<p>${esc((chords?s.lyrics:cleanInline(s.lyrics))||'♪')}</p></section>`).join('')}`;
}
function setView(next) {
  view=next;
  ['write','sheet','layers','rehearse'].forEach(v=>{$(`#${v}-view`).hidden=v!==view;$(`#tab-${v}`).setAttribute('aria-selected',String(v===view));$(`#tab-${v}`).tabIndex=v===view?0:-1;});
  if(view==='sheet')renderSheet();
  if(view==='write')$$('.lyrics-input').forEach(resizeTextarea);
  if(view==='layers')layerStudio.render();
  if(view==='rehearse')updatePlayhead(player.position,player.playing,0);
}
function openSong(id) {
  persist();player.pause();setPlayButton(false);
  if(memo.active) {memo.stop();toast('Recording stopped. Download your take before leaving the page.');}
  activeId=id;stageTimeline=timeline(current());stageIndex=-99;stageCounting=false;
  renderMetadata();renderEditor();renderSidebar();renderSummary();player.load(current(),playbackLength());layerStudio.loadSong();setView(view);persist();closeSidebar();
}
function setPlayButton(playing) {$('#play-button').innerHTML=icon(playing?'pause':'play');$('#play-button').setAttribute('aria-label',playing?'Pause rehearsal':'Start rehearsal');layerStudio.setPlaying(playing);}
function updatePlayhead(position,playing,beat) {
  const song=current();if(!song)return;
  const length=playbackLength();
  $('#elapsed').textContent=timeLabel(Math.max(0,position));$('#seek').value=length?clamp(position/length*1000,0,1000):0;
  $('#stage-time').textContent=`${timeLabel(Math.max(0,position))} / ${timeLabel(length)}`;
  layerStudio.updatePlayhead(position,length);
  $('#beat-dots').querySelectorAll('i').forEach((dot,i)=>dot.classList.toggle('on',playing&&i===beat));
  if(position<0) {stageCounting=true;stageIndex=-99;$('#stage-section').textContent='COUNT IN';$('#previous-line').textContent='Take a breath';$('#current-line').textContent=String(Math.ceil(-position/(60/song.bpm)));$('#next-line').textContent='Your song begins in a moment';$('#stage-chords').textContent=song.sections[0]?.chords||'';return;}
  if(position>=(stageTimeline.at(-1)?.end||0)&&length>stats(song).seconds+.01){stageIndex=-99;$('#stage-section').textContent='AUDIO TAIL';$('#previous-line').textContent=stageTimeline.at(-1)?.text||'';$('#current-line').textContent='Let the music breathe.';$('#next-line').textContent='Your layers keep playing.';$('#stage-chords').textContent='';return;}
  let index=stageTimeline.findIndex(row=>position>=row.start&&position<row.end);
  if(index===-1 && stageTimeline.length) index=stageTimeline.length-1;
  if(index===stageIndex && !stageCounting)return;
  stageIndex=index;stageCounting=false;
  const row=stageTimeline[index];
  if(!row) {$('#stage-section').textContent='READY WHEN YOU ARE';$('#previous-line').textContent='';$('#current-line').textContent='Write your first line.';$('#next-line').textContent='Your voice starts here.';$('#stage-chords').textContent='';return;}
  $('#stage-section').textContent=row.label.toUpperCase();$('#previous-line').textContent=stageTimeline[index-1]?.text||'';
  $('#current-line').textContent=row.text;$('#next-line').textContent=stageTimeline[index+1]?.text||'Let the last note breathe.';$('#stage-chords').textContent=row.chords;
}
async function togglePlay(stayView=false) {
  if(player.playing){player.pause();setPlayButton(false);return;}
  if(layerStudio.busy){toast('Your audio is still loading. Give it a moment.');return;}
  if(!layerStudio.mixer.ready&&!current().sections.some(s=>s.lyrics.trim()||s.type==='Instrumental')){toast('Add lyrics, an audio layer, or an instrumental section before rehearsing.');return;}
  if(!stayView)setView('rehearse');setPlayButton(true);
  await player.play({countIn:!stayView&&$('#count-in').checked,metronome:$('#metronome').checked,loop:$('#loop-song').checked});
  setPlayButton(player.playing);
}
function download(content,name,type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function copy(text,message='Copied.') {
  try {if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(text);toast(message);}
  catch(e) {const field=document.createElement('textarea');field.value=text;field.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.append(field);field.select();const success=document.execCommand?.('copy');field.remove();toast(success?message:'Copy is unavailable here. Download the text instead.');}
}
function dialog(content) {$('#dialog-content').innerHTML=content;if(!$('#app-dialog').open)$('#app-dialog').showModal();}
function closeDialog() {$('#app-dialog').close();}
function newSongDialog() {
  dialog(`<h2 class="dialog-title" id="dialog-title">What’s your next song?</h2><p class="dialog-description">Start with a little structure. Make every line your own.</p><label class="dialog-label" for="new-title">SONG TITLE</label><input class="dialog-input" id="new-title" maxlength="200" placeholder="A name for your next idea"><div class="template-grid" style="margin-top:17px">${[['blank','A fresh page','Verse + chorus. Room to explore.'],['pop','Pop song','A hook, a bridge, a big return.'],['worship','Worship / Gospel','Build from reflection into praise.'],['ballad','A heartfelt ballad','A little slower. A little closer.'],['short','A short song','A verse, a hook, a gentle finish.']].map(([type,title,detail])=>`<button class="template-button" data-action="create-song" data-template="${type}">${icon(type==='blank'?'pen':type==='short'?'play':'note')}<strong>${title}</strong><small>${detail}</small></button>`).join('')}</div>`);
  $('#new-title').focus();
}
function exportDialog() {
  dialog(`<h2 class="dialog-title" id="dialog-title">Take your song with you.</h2><p class="dialog-description">Clean words for singing, a chord sheet for playing, or a complete backup for later.</p>${[['tagged','Singing format · TXT','Lyrics with [Verse] and [Chorus] tags. No private directions.'],['plain','Just the lyrics · TXT','Only the words to sing. No headings, chords, or notes.'],['chordpro','ChordPro · CHOPRO','Song details, section chord progressions, and inline chords.'],['json','Song & layer settings · JSON','Editable lyrics, chords, notes, and layer settings. Audio files are not embedded.']].map(([value,label,description],i)=>`<label class="export-choice"><input type="radio" name="export-format" value="${value}" ${i===0?'checked':''}><span><strong>${label}</strong><small>${description}</small></span></label>`).join('')}<pre class="export-preview" id="export-preview"></pre><p class="export-note">Repeated sections expand in lyric and ChordPro exports. JSON saves layer settings; keep audio originals or download a WAV mix. Use Song sheet → Print / PDF for a printable copy.</p><div class="dialog-actions"><button class="button" data-action="copy-export">${icon('copy')}Copy</button><button class="button primary" data-action="download-export">${icon('download')}Download</button></div>`);
  updateExportPreview();
}
function exportFormat() {return $('input[name="export-format"]:checked')?.value||'tagged';}
function updateExportPreview() {$('#export-preview').textContent=exportLyrics(current(),exportFormat());}
function addSectionDialog() {
  dialog(`<h2 class="dialog-title" id="dialog-title">Give the song a new turn.</h2><p class="dialog-description">Add a section, then move it wherever it belongs.</p><div class="template-grid">${TYPES.map(type=>`<button class="template-button" data-action="insert-section" data-type="${type}"><strong>${type}</strong><small>${{Verse:'Move your story forward.',Chorus:'Bring the hook home.',Bridge:'A new point of view.',Intro:'Set the feeling.','Pre-Chorus':'Build toward the hook.','Post-Chorus':'Let the feeling linger.',Instrumental:'Let the music speak.',Outro:'Leave a lasting note.'}[type]}</small></button>`).join('')}</div>`);
}
function helpDialog() {
  dialog(`<h2 class="dialog-title" id="dialog-title">A little room to create.</h2><p class="dialog-description">Write a line. Find its rhythm. Sing it your way.</p><ol class="help-list"><li><strong>Write:</strong> give each section its own lyrics, chords, and optional vocal direction. Move sections with the arrows or drag their handle.</li><li><strong>Find the flow:</strong> syllable counts are approximate for English. Sing the line out loud to check its natural stress and breath.</li><li><strong>Rehearse:</strong> bars × pulses per bar set a section’s length. Each nonempty line receives equal time. Set bars to fit your melody. In 6/8, BPM counts eighth-note pulses.</li><li><strong>Transpose:</strong> + and − move the key, section chords, and inline chords like [Am] together. Choosing a key directly only changes its label.</li><li><strong>Save:</strong> songs autosave on this device. Download a JSON song or songbook backup before clearing browser data or switching devices. Import restores a backup as new songs.</li><li><strong>Layers:</strong> import recordings in Audio layers, adjust their volume, pan, start, trim, and loop, and play them alongside your lyrics. WAV mix downloads audible layers. Layer files save on this device; JSON only keeps settings. Relink source files when moving devices.</li><li><strong>Capture:</strong> Record uses your real microphone. Download the take or Add take as audio layer to keep it. Use headphones when recording over a backing track.</li><li><strong>Offline:</strong> after the first full visit, the app works without a connection. Rhyme lookup falls back to a small built-in word bank.</li></ol>${recoveryData?'<div class="export-note">Your original saved data is preserved in this session. Download it before choosing to start fresh.</div><div class="dialog-actions"><button class="button" data-action="download-recovery">Download saved data</button><button class="button danger-button" data-action="reset-storage">Start fresh</button></div>':''}<div class="dialog-actions"><button class="button primary" data-action="close-dialog">Back to the song</button></div>`);
}
function songOptionsDialog() {
  dialog(`<h2 class="dialog-title" id="dialog-title">${esc(current().title||'Untitled song')}</h2><p class="dialog-description">Keep exploring an idea, or make space for a new one.</p><div class="options-list"><button class="button" data-action="duplicate-song">${icon('copy')}Duplicate this song</button><button class="button" data-action="export">${icon('download')}Export this song</button><button class="button danger-button" data-action="confirm-delete-song">${icon('trash')}Delete this song</button></div>`);
}
function confirmDeleteSong() {dialog(`<h2 class="dialog-title" id="dialog-title">Delete this song?</h2><p class="dialog-description">“${esc(current().title||'Untitled song')}” will be removed from this device. You can export a backup first.</p><div class="dialog-actions"><button class="button" data-action="close-dialog">Keep song</button><button class="button danger-button" data-action="delete-song">Delete song</button></div>`);}
function backup() {persist();download(JSON.stringify({format:'music-go-songbook',version:1,songs},null,2),`music-go-songbook-${new Date().toISOString().slice(0,10)}.json`,'application/json');toast('Songbook backup downloaded.');}
async function importFile(file) {
  if(!file)return;
  if(file.size>10*1024*1024) {toast('Choose a text or JSON file smaller than 10 MB.');return;}
  try {
    const text=await file.text();let imported=[];
    if(file.name.toLowerCase().endsWith('.json')) {
      const parsed=JSON.parse(text);
      const rawSongs=Array.isArray(parsed.songs)?parsed.songs:[parsed.song||parsed];
      if(rawSongs.length>200 || songs.length+rawSongs.length>200) throw new Error('A songbook can hold up to 200 songs.');
      imported=rawSongs.map(normalizeSong);
    } else {
      if(!text.trim())throw new Error('This lyrics file is empty.');
      const song=importLyrics(text.replace(/^\[\d{1,2}:\d{2}(?:\.\d+)?\]/gm,''));
      if(song.sections.length>150)throw new Error('Please keep a song to 150 sections or fewer.');
      song.title=file.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' ');imported=[song];
    }
    if(!imported.length)throw new Error('This backup has no songs.');
    if(songs.length+imported.length>200)throw new Error('A songbook can hold up to 200 songs.');
    songs.push(...imported);openSong(imported[0].id);toast(`${imported.length===1?'Song':`${imported.length} songs`} imported. Your existing songs are kept.`);
  }catch(e){toast(e instanceof SyntaxError?'The JSON file could not be read. Choose a Music Go backup.':e.message);}
}
async function findRhymes(word) {
  const w=word.trim().toLowerCase();if(!/^[a-z'-]{1,40}$/.test(w))return;
  rhymeController?.abort();const controller=new AbortController();rhymeController=controller;
  let results=localRhymes(w),source='Built-in rhyme bank · tap to copy';
  const draw=()=>{$('#rhyme-results').innerHTML=results.length?results.slice(0,18).map(item=>`<button class="rhyme-chip" data-action="copy-rhyme" data-word="${esc(item)}">${esc(item)}</button>`).join(''):'<span class="rhyme-empty">Try light, day, heart, time, rain, or dream in the offline bank.</span>';$('#rhyme-source').textContent=source;};
  draw();const timeout=setTimeout(()=>controller.abort(),5000);
  try {
    const response=await fetch(`https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(w)}&max=18`,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw new Error();const data=await response.json();
    if(controller!==rhymeController)return;
    const found=Array.isArray(data)?data.map(item=>item.word).filter(word=>typeof word==='string'&&word.length<70):[];
    if(found.length) {results=found;source='Rhymes via Datamuse · tap to copy';draw();}
    else if(!results.length) {$('#rhyme-results').innerHTML='<span class="rhyme-empty">No perfect rhymes found. Try a shorter word or a different line ending.</span>';$('#rhyme-source').textContent='Datamuse · perfect rhyme search';}
  }catch(e){if(controller===rhymeController){source='Offline rhyme bank · tap to copy';draw();}}
  finally {clearTimeout(timeout);}
}
function closeSidebar() {$('#sidebar').classList.remove('open');$('#sidebar-shade').hidden=true;}
function moveSection(id,delta) {const list=current().sections,index=list.findIndex(s=>s.id===id),target=index+delta;if(index<0||target<0||target>=list.length)return;[list[index],list[target]]=[list[target],list[index]];changed({editor:true});$(`[data-section="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});}

document.addEventListener('click',async e=>{
  const tab=e.target.closest('[data-view]');if(tab){setView(tab.dataset.view);return;}
  const button=e.target.closest('[data-action]');if(!button || button.disabled)return;
  const action=button.dataset.action,song=current(),card=button.closest('[data-section]'),id=card?.dataset.section;
  switch(action) {
    case 'new':newSongDialog();break;
    case 'create-song':{
      if(songs.length>=200){toast('Your songbook holds 200 songs. Export a backup before removing old ideas.');break;}
      const next=createSong(button.dataset.template);next.title=$('#new-title').value.trim()||'Untitled song';songs.push(next);closeDialog();openSong(next.id);setView('write');$('#song-title').focus();break;
    }
    case 'open-song':openSong(button.dataset.id);break;
    case 'add-section':addSectionDialog();break;
    case 'insert-section':{
      if(song.sections.length>=150){toast('This song has reached 150 sections.');break;}
      const s=section(button.dataset.type);song.sections.push(s);closeDialog();setView('write');changed({editor:true});$(`[data-section="${s.id}"] textarea`).focus();break;
    }
    case 'section-up':moveSection(id,-1);break;
    case 'section-down':moveSection(id,1);break;
    case 'section-copy':{
      if(song.sections.length>=150){toast('This song has reached 150 sections.');break;}
      const index=song.sections.findIndex(s=>s.id===id),next={...song.sections[index],id:uid()};song.sections.splice(index+1,0,next);changed({editor:true});toast('Section duplicated.');break;
    }
    case 'section-delete':{
      const index=song.sections.findIndex(s=>s.id===id),removed=song.sections.splice(index,1)[0];
      if(!song.sections.length)song.sections.push(section());
      const original=song.id;changed({editor:true});toast('Section removed.',()=>{const target=songs.find(s=>s.id===original);if(target){target.sections.splice(index,0,removed);openSong(original);changed({editor:true});}});break;
    }
    case 'jump-section':{
      const sectionId=button.dataset.id;
      if(view==='rehearse'){const row=stageTimeline.find(r=>r.sectionId===sectionId);if(row)player.seek(row.start);}
      else {setView('write');const target=$(`[data-section="${sectionId}"]`);target?.scrollIntoView({behavior:'smooth',block:'center'});target?.querySelector('textarea')?.focus({preventScroll:true});}break;
    }
    case 'toggle-meter':showMeter=!showMeter;$('#meter-toggle-label').textContent=showMeter?'Hide syllables':'Show syllables';$$('.syllable-column').forEach(el=>el.hidden=!showMeter);if(showMeter)toast('Syllable counts are approximate for English. Your sung phrasing may vary.');break;
    case 'transpose-up':case 'transpose-down':transposeSong(song,action==='transpose-up'?1:-1);changed({editor:true,metadata:true});toast(`Song transposed to ${song.key} ${song.mode}.`);break;
    case 'pitch':try{await playPitch(song.key);toast(`${song.key} reference pitch · octave 4`);}catch(e){toast(e.message);}break;
    case 'play':await togglePlay();break;
    case 'open-layers':setView('layers');break;
    case 'restart':player.seek(0);stageIndex=-99;updatePlayhead(0,player.playing,0);break;
    case 'tap':{
      const now=performance.now();if(taps.length&&now-taps.at(-1)>2000)taps.length=0;taps.push(now);if(taps.length>7)taps.shift();
      if(taps.length<2){toast('Keep tapping to set your tempo.');break;}
      const intervals=taps.slice(1).map((v,i)=>v-taps[i]).sort((a,b)=>a-b);song.bpm=clamp(Math.round(60000/intervals[Math.floor(intervals.length/2)]),40,240);changed({metadata:true});break;
    }
    case 'record':{
      if(memo.starting)break;
      if(memo.active){memo.stop();break;}
      if(memoUrl) {dialog(`<h2 class="dialog-title" id="dialog-title">Keep your previous take?</h2><p class="dialog-description">Download your current recording before replacing it with a new take.</p><div class="dialog-actions"><a class="button" href="${memoUrl}" download="${slug(song.title)}-vocal-idea.${$('#memo-result a')?.download.split('.').at(-1)||'webm'}">Download current take</a><button class="button primary" data-action="record-replace">Record new take</button></div>`);break;}
      await startRecording();break;
    }
    case 'record-replace':closeDialog();$('#memo-result').innerHTML='';if(memoUrl)URL.revokeObjectURL(memoUrl);memoUrl=null;await startRecording();break;
    case 'fullscreen':try{if(document.fullscreenElement)await document.exitFullscreen();else if($('#performance-stage').requestFullscreen)await $('#performance-stage').requestFullscreen();else toast('Fullscreen is not supported in this browser.');}catch(e){toast('Fullscreen is unavailable here.');}break;
    case 'export':exportDialog();break;
    case 'copy-export':await copy(exportLyrics(song,exportFormat()),'Song copied.');break;
    case 'download-export':{
      const format=exportFormat(),extension=format==='json'?'json':format==='chordpro'?'chopro':'txt';download(exportLyrics(song,format),`${slug(song.title)}${format==='plain'?'-lyrics':format==='tagged'?'-singing':''}.${extension}`,format==='json'?'application/json':'text/plain;charset=utf-8');toast('Your song is ready to take with you.');break;
    }
    case 'copy-rhyme':await copy(button.dataset.word,`“${button.dataset.word}” copied.`);break;
    case 'print':setView('sheet');window.print();break;
    case 'import':$('#file-import').click();break;
    case 'backup':backup();break;
    case 'help':helpDialog();break;
    case 'song-options':songOptionsDialog();break;
    case 'duplicate-song':{
      if(songs.length>=200){toast('Your songbook holds 200 songs.');break;}
      const next=normalizeSong(song);next.title=`${song.title} (copy)`.slice(0,200);songs.push(next);closeDialog();openSong(next.id);toast('A fresh copy, ready to explore.');break;
    }
    case 'confirm-delete-song':confirmDeleteSong();break;
    case 'delete-song':{
      const removed=song,index=songs.indexOf(song);songs.splice(index,1);if(!songs.length)songs.push(createSong());closeDialog();openSong(songs[Math.min(index,songs.length-1)].id);toast('Song deleted.',()=>{songs.splice(index,0,removed);openSong(removed.id);});break;
    }
    case 'close-dialog':closeDialog();break;
    case 'menu':{const open=$('#sidebar').classList.toggle('open');$('#sidebar-shade').hidden=!open;break;}
    case 'undo':if(undoAction){const undo=undoAction;undoAction=null;undo();$('#toast').hidden=true;}break;
    case 'download-recovery':download(recoveryData,'music-go-saved-data-recovery.json','application/json');break;
    case 'reset-storage':dialog('<h2 class="dialog-title" id="dialog-title">Start a new saved songbook?</h2><p class="dialog-description">Download the original recovery data first. Starting fresh replaces the unreadable data with the songs currently shown.</p><div class="dialog-actions"><button class="button" data-action="help">Go back</button><button class="button danger-button" data-action="confirm-reset-storage">Replace saved data</button></div>');break;
    case 'confirm-reset-storage':storageBlocked=false;persist();recoveryData=null;closeDialog();break;
  }
});
async function startRecording() {
  const button=$('#record-button');button.disabled=true;$('#memo-status').textContent='Waiting for microphone permission…';
  try{memoTitle=current().title;await memo.start();button.classList.add('recording');button.innerHTML='<span class="record-dot"></span>Stop recording';}
  catch(e){$('#memo-status').textContent=e.name==='NotAllowedError'?'Microphone access was not allowed. Enable it in your browser site settings to record.':e.message;button.classList.remove('recording');button.innerHTML='<span class="record-dot"></span>Record';}
  finally{button.disabled=false;}
}
document.addEventListener('input',e=>{
  const el=e.target,field=el.dataset.field,card=el.closest('[data-section]');
  if(field&&card) {
    const item=current().sections.find(s=>s.id===card.dataset.section);if(!item)return;
    if(['bars','repeats','type'].includes(field))return;
    item[field]=el.value;
    if(field==='lyrics'){resizeTextarea(el);card.querySelector('.syllable-column').innerHTML=meterMarkup(el.value);card.querySelector('.section-meta').textContent=`${lines(el.value).length} lines`;}
    changed();return;
  }
  const fields={'song-title':'title','song-artist':'artist','song-notes':'notes'};
  if(fields[el.id]){current()[fields[el.id]]=el.value;changed();}
  if(el.id==='song-search')renderSidebar();
  if(el.id==='seek')player.seek(Number(el.value)/1000*playbackLength());
});
document.addEventListener('change',async e=>{
  const el=e.target,field=el.dataset.field,card=el.closest('[data-section]');
  if(field&&card) {
    const item=current().sections.find(s=>s.id===card.dataset.section);if(!item)return;
    if(field==='type'){item.type=TYPES.includes(el.value)?el.value:'Verse';changed({editor:true});}
    if(field==='bars'||field==='repeats'){item[field]=clamp(Math.round(Number(el.value)||1),1,field==='bars'?64:8);el.value=item[field];changed();}
    return;
  }
  const metadata={'song-genre':'genre','song-key':'key','song-mode':'mode','song-bpm':'bpm','song-meter':'meter'};
  if(metadata[el.id]){current()[metadata[el.id]]=['song-bpm','song-meter'].includes(el.id)?Number(el.value):el.value;current().bpm=clamp(Math.round(current().bpm)||90,40,240);changed({metadata:true});}
  if(el.id==='sheet-chords')renderSheet();
  if(el.name==='export-format')updateExportPreview();
  if(el.id==='file-import'){await importFile(el.files[0]);el.value='';}
  if(el.id==='metronome'){const success=await player.setMetronome(el.checked);if(!success)el.checked=false;}
  if(el.id==='loop-song'&&player.options)player.options.loop=el.checked;
});
$('#rhyme-form').addEventListener('submit',e=>{e.preventDefault();findRhymes($('#rhyme-word').value);});
$('#app-dialog').addEventListener('click',e=>{if(e.target===$('#app-dialog')){const box=e.target.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)closeDialog();}});
document.addEventListener('keydown',e=>{
  const editing=e.target.closest('input,textarea,select,[contenteditable]');
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();persist();toast('Songs saved on this device. Export a backup for another device.');return;}
  if(e.key==='Escape')closeSidebar();
  if(e.target.closest('[role="tablist"]')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const views=['write','sheet','layers','rehearse'];setView(views[(views.indexOf(view)+(e.key==='ArrowRight'?1:3))%4]);$(`#tab-${view}`).focus();return;}
  if(editing||$('#app-dialog').open)return;
  if(e.key.toLowerCase()==='n'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();newSongDialog();}
  if(e.code==='Space'&&['rehearse','layers'].includes(view)&&!e.target.closest('button,a')){e.preventDefault();togglePlay(view==='layers');}
});
$('#sections').addEventListener('dragstart',e=>{const handle=e.target.closest('.drag-icon');if(!handle)return;dragId=handle.closest('[data-section]').dataset.section;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';handle.closest('.section-card').classList.add('dragging');});
$('#sections').addEventListener('dragover',e=>{if(!dragId)return;const card=e.target.closest('[data-section]');if(card&&card.dataset.section!==dragId){e.preventDefault();$$('.drop-target').forEach(c=>c.classList.remove('drop-target'));card.classList.add('drop-target');}});
$('#sections').addEventListener('drop',e=>{const card=e.target.closest('[data-section]');if(!card||!dragId)return;e.preventDefault();const list=current().sections,from=list.findIndex(s=>s.id===dragId),target=list.findIndex(s=>s.id===card.dataset.section);if(from>=0&&target>=0&&from!==target){const item=list.splice(from,1)[0];list.splice(target,0,item);changed({editor:true});}dragId=null;});
$('#sections').addEventListener('dragend',()=>{dragId=null;$$('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target'));});
window.addEventListener('pagehide',()=>{persist();memo.stop();player.pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){persist();if(player.playing){player.pause();setPlayButton(false);}}});
window.addEventListener('resize',()=>{if(view==='write')$$('.lyrics-input').forEach(resizeTextarea);});
load();renderMetadata();renderEditor();renderSidebar();renderSummary();stageTimeline=timeline(current());player.load(current(),playbackLength());setView('write');layerStudio.loadSong();
$('#rhyme-results').innerHTML=localRhymes('light').slice(0,9).map(w=>`<button class="rhyme-chip" data-action="copy-rhyme" data-word="${w}">${w}</button>`).join('');
if(storageBlocked)saveStatus('Recovery needed',true);else persist();
if('serviceWorker' in navigator && ['http:','https:'].includes(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>{});
