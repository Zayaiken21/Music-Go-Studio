import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createSong,demoSong,normalizeSong,section,sectionLabel,syllables,cleanInline,words,exportLyrics,importLyrics,transposeChord,transposeSong,timeline,stats,duration,timeLabel} from '../core.js';

test('singing exports never include private notes, metadata, or chord symbols',()=>{
  const song=createSong();song.title='NOT A LYRIC';song.notes='DO NOT READ';
  song.sections=[{...section('Verse','[C]Let the [Am]light come in'),notes:'WHISPER THIS',chords:'C G Am F'},{...section('Chorus','I can begin again'),repeats:2}];
  assert.equal(exportLyrics(song,'plain'),'Let the light come in\n\nI can begin again\n\nI can begin again\n');
  assert.equal(exportLyrics(song),'[Verse]\nLet the light come in\n\n[Chorus]\nI can begin again\n\n[Chorus]\nI can begin again\n');
  for(const value of ['WHISPER','DO NOT READ','NOT A LYRIC','[C]','C G Am F'])assert.ok(!exportLyrics(song).includes(value));
});
test('JSON exports round-trip with notes, new identities, and safe values',()=>{
  const song=demoSong(),parsed=JSON.parse(exportLyrics(song,'json'));
  const imported=normalizeSong(parsed.song);assert.equal(imported.title,song.title);assert.equal(imported.notes,song.notes);assert.notEqual(imported.id,song.id);assert.equal(imported.sections[0].chords,song.sections[0].chords);assert.notEqual(imported.sections[0].id,song.sections[0].id);
});
test('text imports preserve lyrics and recognize common section headers',()=>{
  const song=importLyrics('[Verse 1]\nA line\nAnother line\n\nPre Chorus:\nThe lift\n\n[Chorus]\nThe hook\n[Verse 2]\nA new line');
  assert.deepEqual(song.sections.map(s=>s.type),['Verse','Pre-Chorus','Chorus','Verse']);assert.equal(song.sections[0].lyrics,'A line\nAnother line');assert.equal(sectionLabel(song,3),'Verse 2');
  assert.equal(importLyrics('No header\nJust words').sections[0].lyrics,'No header\nJust words');
});
test('import validation rejects broken sections and clamps expensive timing',()=>{
  assert.throws(()=>normalizeSong({sections:[null]}));assert.throws(()=>normalizeSong({sections:Array(151).fill({})}));assert.throws(()=>normalizeSong(null));
  const s=normalizeSong({bpm:10000,meter:7,sections:[{type:'<script>',lyrics:'Hello',bars:-9,repeats:100}]});assert.equal(s.bpm,240);assert.equal(s.meter,4);assert.equal(s.sections[0].type,'Verse');assert.equal(s.sections[0].bars,1);assert.equal(s.sections[0].repeats,8);
});
test('chord transposition preserves qualities, extensions, slash bass, and separators',()=>{
  assert.equal(transposeChord('C G Am F Cmaj7/E Dsus4 Bdim F#7',2),'D A Bm G Dmaj7/F# Esus4 C#dim G#7');
  assert.equal(transposeChord('C/G | Am7, F · Bbadd9',-2,true),'Bb/F | Gm7, Eb · Abadd9');
  const song=createSong();song.key='C';song.sections=[{...section('Verse','[C]Hello [Am7]world'),chords:'C G Am F'}];transposeSong(song,1);assert.equal(song.key,'C#');assert.equal(song.sections[0].chords,'C# G# A#m F#');assert.equal(song.sections[0].lyrics,'[C#]Hello [A#m7]world');transposeSong(song,-1);assert.equal(song.sections[0].chords,'C G Am F');
});
test('timelines agree with total duration and evenly distribute nonempty lines and repeats',()=>{
  const song=createSong();song.bpm=120;song.meter=4;song.sections=[{...section('Verse','one\n\ntwo',2),repeats:2},section('Instrumental','',1)];
  const rows=timeline(song);assert.equal(duration(song),10);assert.equal(rows.length,5);assert.deepEqual(rows.map(r=>r.start),[0,2,4,6,8]);assert.equal(rows.at(-1).end,10);assert.equal(rows.at(-1).text,'Instrumental');assert.equal(stats(song).words,4);
  song.meter=6;assert.equal(duration(song),15);
});
test('lyric cleanup preserves non-chord bracketed words and multilingual text',()=>{
  assert.equal(cleanInline('[C]Come [G/B]home [Come closer]'),'Come home [Come closer]');assert.equal(words('café don’t go').length,3);assert.equal(syllables('Let the light come pouring in'),7);assert.equal(syllables('beautiful people'),5);assert.equal(timeLabel(179.7),'3:00');
});
test('ChordPro preserves inline chords while keeping private directions out',()=>{
  const song=createSong();song.notes='secret';song.sections=[{...section('Chorus','[G]A new day'),chords:'G D Em C',notes:'private',repeats:2}];const output=exportLyrics(song,'chordpro');assert.equal(output.match(/\[G\]A new day/g).length,2);assert.ok(output.includes('{comment: Chords: G D Em C}'));assert.ok(!output.includes('private'));assert.ok(!output.includes('secret'));
});
test('offline cache contains existing deployable assets and stays within project scope',async()=>{
  const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');const list=JSON.parse(sw.match(/const APP=(\[[^;]+\])/)[1].replace(/'/g,'"'));
  for(const path of list)if(path!=='./'){assert.ok(path.startsWith('./'));await access(new URL('../'+path.slice(2),import.meta.url));}
  assert.ok(sw.includes("url.origin!==self.location.origin"));assert.ok(sw.includes("key.startsWith('music-go-studio-')"));
});
test('HTML provides all application anchors, accessible controls, and no external script dependency',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');const ids=[...html.matchAll(/\bid="([^\"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  const js=await readFile(new URL('../app.js',import.meta.url),'utf8');const required=[...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m=>m[1]);const dynamic=['new-title','export-preview'];for(const id of required)assert.ok(ids.includes(id)||dynamic.includes(id),`Missing DOM anchor ${id}`);
  assert.ok(html.includes('aria-label="Tempo in beats per minute"'));assert.ok(!/<script[^>]+src="https?:/i.test(html));
});
