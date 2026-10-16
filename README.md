# Music Go Studio

A responsive songwriting and singing workspace. Write lyrics, arrange a song, find rhymes, transpose chords, print a song sheet, and follow the words while you rehearse.

## Included

- A songbook with browser-local autosave, search, duplication, deletion, and JSON backup / restore.
- Pop, worship / gospel, ballad, short-song, and blank starting structures.
- Verse, chorus, pre-chorus, post-chorus, bridge, intro, instrumental, and outro sections. Move sections with accessible arrows or drag their handle; set bars and repeats.
- Separate lyrics, chords, and private vocal directions. Lyric text exports exclude private notes and chord annotations. JSON backups intentionally preserve everything except audio recordings.
- Approximate English syllable counts and rhyme suggestions. Online rhyme searches send only the typed word to [Datamuse](https://www.datamuse.com/api/); a small built-in bank works offline.
- Semitone transposition for the key, section chord progressions, and inline chord symbols such as `[Am]` or `[C/G]`.
- Clean song sheets and browser print-to-PDF, tagged singing text, plain lyrics, ChordPro, and complete JSON exports.
- Lyric-following rehearsal, one-bar visual count-in, optional audible metronome, looping, seek, tap tempo, a reference pitch, and fullscreen where supported.
- Real microphone voice memos with browser-supported WebM/Opus, M4A, or OGG download. Microphone access starts only after pressing Record; tracks stop after recording. A take is limited to ten minutes. Downloads keep the actual recorded format; files are never renamed to pretend they are WAV or MP3.
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

Recordings exist only in the current tab until downloaded. They are not stored in JSON or browser storage. Online rhyme search contacts Datamuse only when you submit the rhyme form; no lyrics are sent. All core writing and rehearsal functions work without an external account or paid API.

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
