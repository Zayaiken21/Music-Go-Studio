# Music Go Studio

A responsive songwriting and singing workspace. Write lyrics, arrange a song, find rhymes, transpose chords, print a song sheet, and follow the words while you rehearse.

Live app: [Music Go Studio](https://zayaiken21.github.io/Music-Go-Studio/)

## Audio tracks and clips

Open **Audio layers → Import audio**, or create an empty track and drop files onto its timeline. Up to 12 tracks and 128 independent clips are supported. Each source file can be up to 30 MB and ten minutes; the browser must support its format (PCM WAV, MP3, M4A/AAC, OGG/Opus, FLAC, etc.). Files dropped onto a track are placed sequentially as separate clips. Unsupported files show a clear error.

Drag a clip body within or between tracks. Drag its edge handles to trim or change a loop’s length. Edge snapping connects neighboring clips exactly without combining their sources or settings. Beat snapping uses the song BPM; hold Alt during a drag to bypass it. Placement finds an available gap, preserving existing clips. Zoom the timeline for detailed edits, and click an empty lane to place the playhead.

Select a clip to use **Split at playhead**, **Duplicate**, **Connect to previous**, **Trim silence**, source in/out points, timeline start, fades, gain, reverse, auto level, and bounded loops. **Fit tempo to bars** fits one pass to a chosen number of bars; **Double loop** extends its region. Source files remain unchanged. Duration edits move following clips only when they would otherwise overlap. Undo/redo supports 30 audio edits (Ctrl/Cmd Z; Shift Z to redo). S splits, Ctrl/Cmd D duplicates, Delete removes, arrows nudge by 10 ms, and Shift + arrows moves one beat.

**Song tempo changes the actual audio.** Each imported clip initially uses the current song BPM as its original tempo. Set **Original BPM** to the recording’s real tempo when it differs. Clips follow subsequent song BPM changes by default: waveform-similarity overlap-add stretches the audio while preserving pitch, and timeline positions scale with the beat grid. Tap tempo uses the same path. A tempo change pauses briefly for processing and resumes if the arrangement was playing. **Follow song tempo** can be disabled for individual clips; the independent 0.5–2× speed setting also preserves pitch. Very short sounds use resampling; large tempo changes and complex mixes may have audible stretching artifacts. Original BPM is a user-set reference, not automatic beat detection.

**Auto smooth joins & loops** is enabled by default. Loop seams use a short wrap crossfade that retains the exact cycle duration. Adjacent unrelated clips receive a short internal tail crossfade without moving their edges or merging their data. Contiguous unprocessed splits play continuously. Clip fades remain editable. Source-level RMS/peak gain matching and a master limiter manage level jumps; near-silence is not boosted. These tools smooth technical transitions; unrelated songs can still need manual musical phrasing and key matching.

**Play layers** uses the same audio clock, seek, pause, and rehearsal transport as the lyrics. Each track has a play button, and **Preview clip** auditions the selected clip with its current edits. Audition temporarily isolates the selection and bypasses saved mute/solo flags; those flags remain unchanged. Stop returns to the beginning. Switching songs or putting the page in the background pauses playback. Audio tails extend the transport beyond the lyric guide.

**WAV mix** renders the audible arrangement to stereo 44.1 kHz, 16-bit PCM WAV, using the same tempo processing, loop seams, fades, joins, trim, gain, pan, and master limiter as playback. It excludes the metronome and unrecorded singing. Exports end at the last audible clip (or the full session for legacy open-ended loops) and support up to ten minutes. Over-range samples are scaled to prevent hard clipping. Missing audible sources must be relinked or muted before export.

Record a vocal idea, then select **Add take as audio layer** to combine it with backing audio. Headphones reduce speaker bleed when recording.

Audio is saved locally in the `music-go-audio` IndexedDB database, separately from the small localStorage songbook. It is never sent to GitHub or a server. Failed storage is labeled “session only”; keep originals and download mixes as backups. JSON includes track/clip metadata and source references, not embedded audio. On another device, use **Relink audio** once per shared source. Existing one-file layers migrate automatically to tracks with one clip, retaining their settings. Duplicated clips and songs reuse their original local source. Audio processing runs in a bundled module worker and needs no account or paid service.

## Included

- A songbook with browser-local autosave, search, duplication, deletion, and JSON backup / restore.
- Pop, worship / gospel, ballad, short-song, and blank starting structures.
- Verse, chorus, pre-chorus, post-chorus, bridge, intro, instrumental, and outro sections. Move sections with accessible arrows or drag their handle; set bars and repeats.
- Separate lyrics, chords, and private vocal directions. Lyric text exports exclude private notes and chord annotations. JSON backups intentionally preserve everything except audio recordings.
- Approximate English syllable counts and rhyme suggestions. Online rhyme searches send only the typed word to [Datamuse](https://www.datamuse.com/api/); a small built-in bank works offline.
- Semitone transposition for the key, section chord progressions, and inline chord symbols such as `[Am]` or `[C/G]`.
- Clean song sheets and browser print-to-PDF, tagged singing text, plain lyrics, ChordPro, and complete JSON exports.
- Lyric-following rehearsal, one-bar visual count-in, optional audible metronome, looping, seek, tap tempo, a reference pitch, and fullscreen where supported.
- Real microphone voice memos with browser-supported WebM/Opus, M4A, or OGG download, and an option to add each take as a layer. Microphone access starts only after pressing Record; tracks stop after recording. A take is limited to ten minutes. Downloads keep the actual recorded format; WAV mixes use PCM encoding.
- Installable PWA with icons, relative URLs for GitHub project Pages, and offline caching after the first complete online visit.
- Responsive layouts, keyboard tab navigation, visible focus states, reduced-motion support, and a print layout.

## Publish on GitHub Pages

The app is static and has no build step, API keys, or backend.

1. Put these files in a new GitHub repository, keeping `index.html` in the root.
2. Open **Settings → Pages**.
3. Select **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. Wait for GitHub’s Pages deployment to finish; open the URL shown in Pages settings.

GitHub documents this workflow in [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). A public repository works with free GitHub Pages. Future commits to the publishing branch update the site automatically.

## Use it

Select New song, name the idea, and choose a structure. Write only sung words in the lyrics area. Put delivery instructions in Vocal direction. Add section chord progressions underneath, or place chords inline, such as `[G]Let the light come in`.

Set bars to the actual length of each section. The duration estimate uses `bars × pulses per bar × 60 / BPM × repeats`. In 6/8, BPM counts eighth-note pulses. Rehearsal divides a section’s time equally among its nonempty lyric lines. It is a practice guide, not melody recognition or generated singing. You provide the vocals.

The key selector changes the key label and reference pitch. The plus and minus controls transpose the actual chords and key together. Automatic syllable counts are English estimates; sung pronunciation and stress can differ.

Export tagged text for tools that accept `[Verse]` / `[Chorus]` labels, or plain text when only the words should be spoken or sung. Different music tools support different tags. The app does not claim to make a text-to-speech engine sing.

Lyrics imports support TXT, simple LRC timestamps, and section headers such as `[Verse 1]`, `Chorus:`, and `[Pre-Chorus]`. ChordPro exports keep section-wide progressions as comments; only chords written inline in lyrics have explicit word placement.

## Data and privacy

Your songbook is stored in this browser’s `localStorage`, under `music-go-studio:v1`. It is not committed to GitHub, sent to a server, or synchronized between devices. Anyone using the same browser profile and site can access that local songbook. Clearing site data removes saved songs. Use Back up songbook or JSON export to keep a copy. If storage is full or disabled, the app shows an error and keeps your current edits in memory so you can download them. Unreadable saved data is preserved until you download recovery data and choose Start fresh.

Voice memos exist only in the current tab until downloaded or explicitly added as an audio layer. Audio layers save to device storage where supported; JSON does not embed their bytes. Online rhyme search contacts Datamuse only when you submit the rhyme form; no lyrics are sent. All core writing and rehearsal functions work without an external account or paid API.

## Development and checks

Use a normal static HTTP server for local development; ES modules and microphone access require an HTTP(S) origin. Production microphone access requires HTTPS. Do not open `index.html` directly as a `file://` URL.

Node 22 or later runs the logic and markup checks without installing packages:

```sh
npm run check
npm test
```

There are no runtime dependencies, trackers, external fonts, or generated vocals. The tests cover clean exports, repeat expansion, chord transposition, import validation, timing, and the offline asset list. Full browser layout and device microphone behavior should also be checked on the hosted site.

## Search visibility

The page includes a unique title, description, Open Graph metadata, and WebApplication structured data. The public app shell is indexable; private song drafts stay local and are not published as SEO pages. Search engines choose whether and when to index the app. No indexing or ranking is guaranteed.

## Updating

Edit the source files, run the checks, and commit to `main`. When changing the offline file set, update the cache version and `APP` list in `sw.js`. Service-worker requests use the network first and cached assets when offline.
