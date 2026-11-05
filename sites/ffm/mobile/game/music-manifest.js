// music-manifest.js — Bundled background-music tracks and their credits.
//
// The app's licence/attribution pages read this list, so every track that
// ships in www/ has a visible credit. Playback order comes from ./tracks.json
// (the app overlay replaces the web single-track manifest); keep this list in
// step with it. Until the owner commits the selected tracks (M4) both list the
// one existing file.
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
