import {normalizeLayer,MAX_LAYERS} from './layer-core.js';
export const TYPES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Bridge', 'Instrumental', 'Outro'];
export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const cleanInline = text => String(text || '').replace(/\[([A-G](?:#|b)?(?:(?:maj|min|m|dim|aug|sus|add)?\d+|maj|min|m|dim|aug|sus|add)?(?:(?:add|sus|[#b])\d+)*(?:\/[A-G](?:#|b)?)?)\]/g, '').trim();
export const words = text => cleanInline(text).match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) || [];
export const lines = text => String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
export function syllables(text) {
  const exceptions = { fire:1, hour:1, our:1, every:2, family:3, beautiful:3, heaven:2, people:2, love:1, loved:1, smile:1, tired:1, quiet:2, poetry:3, rhythm:2, world:1, little:2, memories:3, together:3, real:1, higher:2 };
  return words(text).reduce((total, raw) => {
    let word = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return total;
    if (exceptions[word]) return total + exceptions[word];
    if (word.length <= 3) return total + 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    return total + Math.max(1, (word.match(/[aeiouy]{1,2}/g) || []).length);
  }, 0);
}
export function section(type = 'Verse', lyrics = '', bars = 8) {
  return { id: uid(), type, lyrics, chords: '', notes: '', bars, repeats: 1 };
}
export function createSong(template = 'blank') {
  const song = { id: uid(), title: 'Untitled song', artist:'', genre:'Pop', key:'C', mode:'major', bpm:90, meter:4, notes:'', updatedAt:new Date().toISOString(), sections:[], audioLayers:[],masterVolume:.85 };
  const structures = {
    blank:['Verse', 'Chorus'], pop:['Verse', 'Pre-Chorus', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus'],
    worship:['Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus', 'Outro'],
    short:['Verse', 'Chorus', 'Outro'], ballad:['Verse', 'Verse', 'Chorus', 'Verse', 'Bridge', 'Chorus']
  };
  song.sections = (structures[template] || structures.blank).map(type => section(type, '', type === 'Outro' ? 4 : 8));
  if (template === 'worship') song.genre='Worship';
  if (template === 'ballad') {song.genre='Ballad'; song.bpm=72;}
  return song;
}
export function demoSong() {
  const song = createSong();
  song.title='Room for the Light'; song.artist='Your next great song'; song.bpm=92; song.key='G';
  song.notes='An intimate start that opens into a hopeful chorus. Leave a breath after the second line.';
  song.sections=[
    {...section('Verse', 'I left my worries by the door\nLike shoes I do not need to wear\nThe morning found me on the floor\nAnd taught me how to meet it there'), chords:'G D Em C', notes:'Soft, close, almost a conversation.'},
    {...section('Pre-Chorus', 'And every little step I take\nIs room for something new to break',4), chords:'Am C D', notes:'Build gently. Let the last word lift.'},
    {...section('Chorus', 'Let the light come pouring in\nLet it find me where I stand\nI can find my way again\nWith tomorrow in my hands'), chords:'G D Em C', notes:'Open, warm, and confident.'},
    {...section('Verse', 'The road is not a straight white line\nSome days I need to start again\nBut every mile is still a sign\nThat I can learn to be my friend'), chords:'G D Em C'},
    {...section('Chorus', 'Let the light come pouring in\nLet it find me where I stand\nI can find my way again\nWith tomorrow in my hands'), chords:'G D Em C'},
    {...section('Bridge', 'I do not need to know it all\nTo answer when the morning calls',4), chords:'Em C G D', notes:'Pull back, then grow.'},
    {...section('Chorus', 'Let the light come pouring in\nLet it find me where I stand\nI can find my way again\nWith tomorrow in my hands'), chords:'G D Em C'}
  ];
  return song;
}
export function normalizeSong(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.sections) || raw.sections.length > 150) throw new Error('Choose a Music Go song JSON file with up to 150 sections.');
  const text = (v, max=100000) => typeof v === 'string' ? v.slice(0,max) : '';
  const num = (v, fallback, min, max) => Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)),min,max) : fallback;
  return {
    id: uid(), title: text(raw.title, 200) || 'Imported song', artist:text(raw.artist,200), genre:text(raw.genre,80) || 'Pop',
    key: KEYS.includes(raw.key) ? raw.key : 'C', mode:raw.mode==='minor'?'minor':'major', bpm:num(raw.bpm,90,40,240), meter:[3,4,6].includes(Number(raw.meter))?Number(raw.meter):4,
    notes:text(raw.notes,10000), updatedAt:new Date().toISOString(),
    masterVolume:Number.isFinite(Number(raw.masterVolume))?clamp(Number(raw.masterVolume),0,1):.85,
    audioLayers:Array.isArray(raw.audioLayers)?raw.audioLayers.slice(0,MAX_LAYERS).filter(item=>item&&typeof item==='object').map(item=>({...normalizeLayer(item),id:uid()})):[],
    sections:(raw.sections.length ? raw.sections : [section()]).map(s => {
      if (!s || typeof s !== 'object') throw new Error('One of the imported sections is invalid.');
      return {id:uid(), type:TYPES.includes(s.type)?s.type:'Verse', lyrics:text(s.lyrics), chords:text(s.chords,1000), notes:text(s.notes,10000), bars:num(s.bars,8,1,64), repeats:num(s.repeats,1,1,8)};
    })
  };
}
export function sectionLabel(song, index) {
  const type=song.sections[index].type;
  const count=song.sections.filter(s=>s.type===type).length;
  return count>1 ? `${type} ${song.sections.slice(0,index+1).filter(s=>s.type===type).length}` : type;
}
export function sectionSeconds(song, s) { return s.bars * song.meter * 60 / song.bpm * s.repeats; }
export const duration = song => song.sections.reduce((sum,s)=>sum+sectionSeconds(song,s),0);
export function timeLabel(seconds) {const s=Math.max(0,Math.round(seconds)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
export function stats(song) {return {words:song.sections.reduce((n,s)=>n+words(s.lyrics).length*s.repeats,0), lines:song.sections.reduce((n,s)=>n+lines(s.lyrics).length*s.repeats,0), bars:song.sections.reduce((n,s)=>n+s.bars*s.repeats,0), seconds:duration(song)};}
export function timeline(song) {
  let start=0;
  return song.sections.flatMap((s,index)=>{
    const content=lines(s.lyrics);
    const rows=content.length ? content : [s.type==='Instrumental' ? 'Instrumental' : '♪'];
    const length=s.bars*song.meter*60/song.bpm/rows.length;
    const items=[];
    for(let repeat=0;repeat<s.repeats;repeat++) for(let line=0;line<rows.length;line++) {
      items.push({start,end:start+length,sectionId:s.id,sectionIndex:index,label:sectionLabel(song,index),repeat,line,text:cleanInline(rows[line]),chords:s.chords});
      start+=length;
    }
    return items;
  });
}
export function exportLyrics(song, format='tagged') {
  if (format==='json') return JSON.stringify({format:'music-go-song',version:1,song},null,2);
  if (format==='chordpro') return [`{title: ${song.title.replace(/[{}\n]/g,'')}}`, `{artist: ${song.artist.replace(/[{}\n]/g,'')}}`, `{key: ${song.key}${song.mode==='minor'?'m':''}}`, `{tempo: ${song.bpm}}`, '', ...song.sections.flatMap((s,i)=>Array.from({length:s.repeats},()=>[`{comment: ${sectionLabel(song,i)}}`,s.chords?`{comment: Chords: ${s.chords.replace(/[{}\n]/g,'')}}`:'',s.lyrics.trim(),''].filter(Boolean).join('\n')))].join('\n').trim()+'\n';
  return song.sections.flatMap((s,i)=>Array.from({length:s.repeats},()=>[format==='tagged'?`[${sectionLabel(song,i)}]`:null,cleanInline(s.lyrics)].filter(v=>v!==null).join('\n'))).join('\n\n').trim()+'\n';
}
export function importLyrics(text) {
  const song=createSong(); song.title='Imported lyrics'; song.sections=[];
  let current=null;
  for(const line of String(text).replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const match=line.trim().match(/^(?:\[\s*)?(intro|verse|pre[- ]?chorus|chorus|post[- ]?chorus|bridge|instrumental|outro)(?:\s+\d+)?(?:\s*\]|\s*:)?\s*$/i);
    if(match) {
      const name=match[1].toLowerCase().replace(/[- ]/g,'');
      const type=TYPES.find(t=>t.toLowerCase().replace(/-/g,'')===name);
      current=section(type); song.sections.push(current);
    } else {
      if(!current && !line.trim()) continue;
      if(!current) {current=section();song.sections.push(current);}
      current.lyrics+=(current.lyrics?'\n':'')+line;
    }
  }
  song.sections.forEach(s=>s.lyrics=s.lyrics.trim());
  if(!song.sections.length) song.sections=[section()];
  return song;
}
const PITCHES={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
const SHARPS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLATS=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export function transposeChord(chord, steps, preferFlats=false) {
  const scale=preferFlats?FLATS:SHARPS;
  return chord.replace(/(^|[\s/|,·])([A-G](?:#|b)?)(?=(?:maj|min|m|dim|aug|sus|add|\d|[()/\s|,·]|$))/g,(all,pre,note)=>pre+scale[(PITCHES[note]+steps%12+12)%12]);
}
export function transposeSong(song, steps) {
  const key=KEYS[(PITCHES[song.key]+steps%12+12)%12];
  const flats=key.includes('b') || key==='F';
  song.key=key;
  song.sections.forEach(s=>{
    s.chords=transposeChord(s.chords,steps,flats);
    s.lyrics=s.lyrics.replace(/\[([^\]\n]+)\]/g,(all,chord)=>/^([A-G](?:#|b)?)(?:maj|min|m|dim|aug|sus|add|\d|\/|$)/.test(chord)?`[${transposeChord(chord,steps,flats)}]`:all);
  });
  return song;
}
const RHYMES=[['light','night','bright','right','sight','flight','white','ignite','tonight','alright'],['day','way','stay','say','away','play','pray','gray','today'],['heart','start','apart','art','part','restart'],['go','know','show','slow','grow','flow','glow','below'],['time','rhyme','climb','prime','chime'],['true','blue','new','you','through','view','renew'],['free','me','be','see','sea','tree','key'],['love','above','dove','glove'],['home','roam','foam','chrome'],['rain','pain','again','train','remain','explain'],['hand','stand','land','sand','understand','planned'],['door','floor','more','before','shore','explore'],['air','care','there','wear','share','prayer'],['call','all','fall','small','wall','tall'],['dream','seem','stream','team','gleam'],['song','long','strong','belong','along'],['fire','desire','higher','wire','inspire']];
export function localRhymes(word) {const w=word.toLowerCase().trim();return (RHYMES.find(group=>group.includes(w)) || []).filter(s=>s!==w);}
