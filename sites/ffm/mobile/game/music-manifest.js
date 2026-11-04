// music-manifest.js — Bundled background-music tracks and their credits.
//
// The app's licence/attribution pages read this list, so every track that
// ships in www/ has a visible credit. The web build keeps today's single
// hard-coded track in ../static/game/audio.js; rotating over these entries is
// phase 4.4. Until the owner commits the selected tracks (M4) the list holds
// the one existing file.
export const MUSIC_TRACKS = Object.freeze([
  Object.freeze({
    file: 'background-music.mp3',
    title: 'Arithmo Slayer theme',
    author: 'Urs Schweigert (project owner)',
    licence: 'Owner-provided, bundled with the app; public licence and source are recorded with the track at M4',
    source: null,
    stage: null,
  }),
]);
