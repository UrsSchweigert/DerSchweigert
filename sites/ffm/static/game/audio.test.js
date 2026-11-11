import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { AudioEngine } from './audio.js';
import { MUSIC_TRACKS } from '../../mobile/game/music-manifest.js';

const SINGLE = [{ file: 'background-music.mp3', title: 'Arithmo Slayer theme', stage: null }];

function fakeAudio(state) {
  return {
    src: '', currentTime: 0, volume: 1, muted: false, loop: false, preload: '',
    plays: 0, pauses: 0, onended: null, onerror: null,
    play() {
      this.plays++;
      state.plays++;
      return Promise.resolve();
    },
    pause() { this.pauses++; },
    addEventListener(type, handler) {
      if (type === 'ended') this.onended = handler;
      if (type === 'error') this.onerror = handler;
    },
    removeEventListener(type, handler) {
      if (type === 'ended' && this.onended === handler) this.onended = null;
      if (type === 'error' && this.onerror === handler) this.onerror = null;
    },
    fireEnded() {
      if (this.onended) this.onended();
    },
    fireError() {
      if (this.onerror) this.onerror({ target: this });
    },
  };
}

function engine(tracks = SINGLE) {
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    tracks,
    baseUrl: null,
    makeAudio(file) {
      const element = fakeAudio(state);
      element.file = file;
      state.audios.push(element);
      return element;
    },
  });
  audio._ensureCtx = () => {};
  return { audio, state };
}

it('toggling sound on the title never starts music', () => {
  const { audio, state } = engine();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(audio.muted, false);
  assert.equal(state.plays, 0);
});

it('unmuting resumes only active gameplay music, preserving its position', () => {
  const { audio, state } = engine();
  audio.startBGM(1);
  const current = audio._rotation.currentAudio;
  current.currentTime = 12;
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(state.plays, 2);
  assert.equal(current.currentTime, 12);
  audio.pauseBGM();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(state.plays, 2);
  audio.resumeBGM();
  assert.equal(state.plays, 3);
  audio.stopBGM();
  audio.toggleMute();
  audio.toggleMute();
  assert.equal(state.plays, 3);
});

it('a game started muted can play music when unmuted', () => {
  const { audio, state } = engine();
  audio.toggleMute();
  audio.startBGM(1);
  assert.equal(state.plays, 0);
  audio.toggleMute();
  assert.equal(state.plays, 1);
});

it('keeps the bundled volume and mute state on every rotated track', () => {
  const { audio, state } = engine([
    { file: 'a.mp3', stage: 1 },
    { file: 'b.mp3', stage: 2 },
  ]);
  audio.startBGM(1);
  audio.toggleMute();
  for (const element of state.audios) {
    assert.equal(element.volume, 0.35);
    assert.equal(element.loop, false);
    assert.equal(element.muted, true);
  }
});

it('advances to a different track when the current one ends', () => {
  const { audio, state } = engine([
    { file: 'a.mp3', stage: null },
    { file: 'b.mp3', stage: null },
  ]);
  audio.startBGM(null);
  const first = audio._rotation.currentAudio;
  first.fireEnded();
  const second = audio._rotation.currentAudio;
  assert.notEqual(second, first);
  assert.notEqual(second.src, first.src);
  assert.equal(second.plays, 1);
  assert.equal(state.plays, 2);
});

it('replays the single web track when it ends', () => {
  const { audio, state } = engine();
  audio.startBGM(1);
  const first = audio._rotation.currentAudio;
  first.fireEnded();
  assert.equal(audio._rotation.currentTrack.file, 'background-music.mp3');
  assert.equal(audio._rotation.currentAudio.src, 'background-music.mp3');
  assert.equal(state.plays, 2);
});

it('loads tracks.json into the rotation', async () => {
  const state = { plays: 0, audios: [] };
  let requested = null;
  const audio = new AudioEngine({
    manifestUrl: 'tracks.json',
    baseUrl: null,
    fetchManifest: async (url) => {
      requested = url;
      return { tracks: [{ file: 'a.mp3' }, { file: 'b.mp3' }] };
    },
    makeAudio(file) {
      const element = fakeAudio(state);
      element.file = file;
      state.audios.push(element);
      return element;
    },
  });
  audio._ensureCtx = () => {};
  await audio._manifestReady;
  assert.equal(requested, 'tracks.json');
  assert.deepEqual(audio._rotation.tracks.map((track) => track.file), ['a.mp3', 'b.mp3']);
  audio.startBGM(1);
  assert.equal(state.plays, 1);
});

it('keeps the bundled fallback track when the manifest cannot load', async () => {
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    baseUrl: null,
    fetchManifest: async () => { throw new Error('offline'); },
    makeAudio(file) {
      const element = fakeAudio(state);
      element.file = file;
      state.audios.push(element);
      return element;
    },
  });
  audio._ensureCtx = () => {};
  await audio._manifestReady;
  audio.startBGM(1);
  assert.equal(state.audios[0].file, 'background-music.mp3');
  assert.equal(state.plays, 1);
});

it('uses a level playlist instead of chapter tags and falls back for other levels', () => {
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3', stage: 1 }, { file: 'b.mp3', stage: 2 }],
    levelMusic: { levels: { 11: ['b.mp3'] } },
    baseUrl: null,
    makeAudio: file => Object.assign(fakeAudio(state), { file }),
  });
  audio._ensureCtx = () => {};
  audio.startLevelBGM(11, 1);
  assert.equal(audio._rotation.currentTrack.file, 'b.mp3');
  assert.equal(audio._rotation.nextTrack.file, 'b.mp3');
  audio.startLevelBGM(12, 1);
  assert.equal(audio._rotation.currentTrack.file, 'a.mp3');
});

it('selects a real credited bundled level track then restores the normal catalogue', async () => {
  const actualWeb = JSON.parse(await readFile(new URL('./tracks.json', import.meta.url))).tracks;
  const web = [...actualWeb, { file: 'other.mp3', stage: 1 }];
  const mobile = JSON.parse(await readFile(new URL('../../mobile/game/tracks.json', import.meta.url))).tracks;
  const file = 'background-music.mp3';
  await access(new URL(`./${file}`, import.meta.url));
  assert.ok(actualWeb.some(track => track.file === file));
  assert.ok(mobile.some(track => track.file === file));
  assert.ok(MUSIC_TRACKS.some(track => track.file === file));
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: web,
    levelMusic: { levels: { 1: [file] } },
    baseUrl: null,
    makeAudio: () => fakeAudio(state),
  });
  audio._ensureCtx = () => {};
  audio.startLevelBGM(1, 1);
  assert.equal(audio._rotation.currentTrack.file, file);
  assert.notEqual(audio._rotation.tracks, web);
  audio.startLevelBGM(2, 1);
  assert.equal(audio._rotation.tracks, web);
  assert.equal(audio._rotation.currentTrack.file, 'other.mp3');
});

it('reports a load error, falls back without blocking, and stops if the fallback fails', () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const state = { plays: 0 };
    const audio = new AudioEngine({
      tracks: [{ file: 'missing.mp3' }, ...SINGLE],
      levelMusic: { levels: { 1: ['missing.mp3'] } },
      baseUrl: null,
      makeAudio: () => fakeAudio(state),
    });
    audio._ensureCtx = () => {};
    audio.startLevelBGM(1, 1);
    const failed = audio._rotation.currentAudio;
    failed.fireError();
    assert.match(warnings[0][0], /Unable to load bundled music track/);
    assert.equal(warnings[0][1], 'missing.mp3');
    assert.equal(audio._rotation.currentTrack.file, 'background-music.mp3');
    assert.equal(state.plays, 2);
    assert.equal(failed.onerror, null);
    audio._rotation.currentAudio.fireError();
    assert.equal(warnings.length, 2);
    assert.equal(audio._rotation.currentAudio, null);
    assert.doesNotThrow(() => { audio.pauseBGM(); audio.resumeBGM(); audio.stopBGM(); });
    assert.equal(state.plays, 2);
  } finally {
    console.warn = warn;
  }
});

it('defers fallback for a preload error while paused and preserves mute on resume', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const state = { plays: 0 };
    const audio = new AudioEngine({
      tracks: [{ file: 'missing.mp3' }, ...SINGLE],
      levelMusic: { levels: { 1: ['missing.mp3'] } },
      baseUrl: null,
      makeAudio: () => fakeAudio(state),
    });
    audio._ensureCtx = () => {};
    audio.startLevelBGM(1, 1);
    audio.pauseBGM();
    audio.toggleMute();
    audio._rotation.nextAudio.fireError();
    assert.equal(state.plays, 1);
    assert.equal(audio._rotation.currentTrack.file, 'missing.mp3');
    audio.resumeBGM();
    assert.equal(audio._rotation.currentTrack.file, 'background-music.mp3');
    assert.equal(audio._rotation.currentAudio.muted, true);
    assert.equal(state.plays, 1);
    audio.toggleMute();
    assert.equal(state.plays, 2);
  } finally {
    console.warn = warn;
  }
});

it('applies late config only to the current session, preserving pause and mute', async () => {
  let resolveManifest, resolveLevels;
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    fetchManifest: () => new Promise(resolve => { resolveManifest = resolve; }),
    fetchLevelMusic: () => new Promise(resolve => { resolveLevels = resolve; }),
    baseUrl: null,
    makeAudio: file => Object.assign(fakeAudio(state), { file }),
  });
  audio._ensureCtx = () => {};
  audio.startLevelBGM(1, 1);
  audio.pauseBGM();
  audio.toggleMute();
  resolveLevels({ levels: { 1: ['a.mp3'], 2: ['b.mp3'] } });
  resolveManifest({ tracks: [{ file: 'a.mp3' }, { file: 'b.mp3' }] });
  await Promise.all([audio._manifestReady, audio._levelMusicReady]);
  assert.equal(state.plays, 1);
  assert.equal(audio._rotation.currentTrack.file, 'background-music.mp3');
  audio.resumeBGM();
  assert.equal(audio._rotation.currentTrack.file, 'a.mp3');
  assert.equal(audio._rotation.currentAudio.volume, 0.35);
  assert.equal(state.plays, 1);
  audio.toggleMute();
  assert.equal(state.plays, 2);
  audio.startLevelBGM(2, 1);
  assert.equal(audio._rotation.currentTrack.file, 'b.mp3');
  audio.stopBGM();
  audio.resumeBGM();
  assert.equal(audio._rotation.currentAudio, null);
});

it('reports invalid level lists and falls back without blocking playback', () => {
  const state = { plays: 0, audios: [] };
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const audio = new AudioEngine({
      tracks: SINGLE,
      levelMusic: { levels: { 1: ['https://example.com/song.mp3'], 2: ['missing.mp3'] } },
      baseUrl: null,
      makeAudio: file => Object.assign(fakeAudio(state), { file }),
    });
    audio._ensureCtx = () => {};
    audio.startLevelBGM(1, 1);
    audio.startLevelBGM(2, 1);
    assert.equal(audio._rotation.currentTrack.file, 'background-music.mp3');
    assert.equal(state.plays, 2);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = warn;
  }
});

it('does not start music if level configuration arrives after stop', async () => {
  let resolveLevels;
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    tracks: SINGLE,
    fetchLevelMusic: () => new Promise(resolve => { resolveLevels = resolve; }),
    baseUrl: null,
    makeAudio: file => Object.assign(fakeAudio(state), { file }),
  });
  audio._ensureCtx = () => {};
  audio.startLevelBGM(1, 1);
  audio.stopBGM();
  resolveLevels({ levels: { 1: ['background-music.mp3'] } });
  await audio._levelMusicReady;
  assert.equal(state.plays, 1);
  assert.equal(audio._rotation.currentAudio, null);
});

it('uses the latest level when a delayed configuration arrives', async () => {
  let resolveLevels;
  const state = { plays: 0, audios: [] };
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3' }, { file: 'b.mp3' }],
    fetchLevelMusic: () => new Promise(resolve => { resolveLevels = resolve; }),
    baseUrl: null,
    makeAudio: file => Object.assign(fakeAudio(state), { file }),
  });
  audio._ensureCtx = () => {};
  audio.startLevelBGM(1, 1);
  audio.startLevelBGM(2, 1);
  resolveLevels({ levels: { 1: ['a.mp3'], 2: ['b.mp3'] } });
  await audio._levelMusicReady;
  assert.equal(audio._rotation.currentTrack.file, 'b.mp3');
});

it('reports a level configuration loading failure and continues fallback playback', async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const state = { plays: 0, audios: [] };
    const audio = new AudioEngine({
      tracks: SINGLE,
      fetchLevelMusic: async () => { throw new Error('offline'); },
      baseUrl: null,
      makeAudio: file => Object.assign(fakeAudio(state), { file }),
    });
    audio._ensureCtx = () => {};
    audio.startLevelBGM(1, 1);
    await audio._levelMusicReady;
    assert.equal(audio._rotation.currentTrack.file, 'background-music.mp3');
    assert.equal(state.plays, 1);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = warn;
  }
});

describe('shared sound buses and event cues', () => {
    function fakeContext({ media = true, failConnectAt = 0 } = {}) {
      const context = {
        currentTime: 10, sampleRate: 1000, state: 'suspended',
        nodes: [], sources: [], resumes: 0,
        resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); },
      };
      const param = () => ({
        value: 0, events: [],
        setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); },
        exponentialRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); },
        linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); },
        cancelScheduledValues(time) { this.events.push(['cancel', time]); },
      });
      const node = kind => {
        const n = {
          kind, connections: [], disconnected: false,
          connect(target) { this.connections.push(target); },
          disconnect() { this.disconnected = true; this.connections = []; },
        };
        context.nodes.push(n);
        return n;
      };
      const voice = kind => Object.assign(node(kind), {
        starts: [], stops: [], onended: null,
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
      });
      context.destination = node('destination');
      context.createGain = () => Object.assign(node('gain'), { gain: param() });
      context.createOscillator = () => Object.assign(voice('oscillator'), { frequency: param() });
      context.createBufferSource = () => voice('buffer');
      context.createBuffer = (_, length) => ({ getChannelData: () => new Float32Array(length) });
      context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: param(), Q: param() });
      context.createDynamicsCompressor = () => Object.assign(node('compressor'),
        Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, param()])));
      if (media) context.createMediaElementSource = element => {
        assert.ok(!context.sources.some(source => source.element === element), 'one source per element');
        const source = Object.assign(node('media'), { element });
        context.sources.push(source);
        if (context.sources.length === failConnectAt) source.connect = () => { throw new Error('unsupported route'); };
        return source;
      };
      return context;
    }

    function soundEngine(options = {}) {
      const state = { plays: 0, audios: [] };
      const context = options.context ?? fakeContext();
      const audio = new AudioEngine({
        tracks: [{ file: 'a.mp3' }, { file: 'b.mp3' }],
        makeContext: () => context,
        baseUrl: 'https://localhost/game/',
        makeAudio: file => {
          const element = Object.assign(fakeAudio(state), { file });
          state.audios.push(element);
          return element;
        },
        ...options,
      });
      return { audio, state, context };
    }

    it('all effect paths route through one adjustable headroom bus and protection', () => {
      const { audio, context } = soundEngine();
      audio.setEffectsVolume(0.5);
      for (const method of [
        'playCorrect', 'playWrong', 'playTimeout', 'playHeal', 'playCampaignVictory',
        'playSwordSwing', 'playFireballCast', 'playFireballHit', 'playLightningCast',
        'playLightningHit', 'playDragonRoar', 'playDragonBreath', 'playEnemyDeath',
        'playHeroHurt', 'playLevelClear', 'playGameOver',
      ]) audio[method]();
      assert.equal(context.resumes, 1, 'context resumes on the gesture path');
      assert.equal(audio._effectsBus.gain.value, 0.2);
      assert.equal(audio._effectsBus.connections[0].kind, 'compressor');
      assert.equal(audio._effectsBus.connections[0].connections[0], context.destination);
      for (const n of context.nodes.filter(n => n.kind === 'gain' && n !== audio._musicBus && n !== audio._effectsBus)) {
        assert.deepEqual(n.connections, [audio._effectsBus], 'including noise and sword envelopes');
      }
      audio.setEffectsVolume(0);
      assert.equal(audio._effectsBus.gain.value, 0, 'already-playing effects follow the bus');
      audio.setEffectsVolume(1);
      assert.equal(audio._effectsBus.gain.value, 0.4);
    });

    it('mute cuts playing and future scheduled effects without reviving them on unmute', () => {
      const { audio, context, state } = soundEngine();
      audio.playCampaignVictory();
      audio.playSwordSwing();
      const voices = [...audio._voices];
      audio.toggleMute();
      assert.equal(audio._effectsBus.gain.value, 0);
      assert.equal(audio._voices.size, 0);
      for (const voice of voices) {
        assert.equal(voice.source.stops.at(-1), undefined, 'stop immediately');
        assert.ok(voice.nodes.every(node => node.disconnected));
      }
      const count = context.nodes.length;
      audio.playHeal();
      audio.playTimeout();
      assert.equal(context.nodes.length, count);
      audio.setEffectsVolume(0.25);
      assert.equal(audio._effectsBus.gain.value, 0);
      audio.toggleMute();
      assert.equal(audio._effectsBus.gain.value, 0.1);
      assert.equal(state.plays, 0, 'title unmute does not play music');
    });

    it('finished voices release their source/envelope/filter graph', () => {
      const { audio } = soundEngine();
      audio.playSwordSwing();
      for (const voice of [...audio._voices]) {
        voice.source.onended();
        assert.ok(voice.nodes.every(node => node.disconnected));
      }
      assert.equal(audio._voices.size, 0);
    });

    it('shapes every synth cue with a short attack and release', () => {
      const { audio, context } = soundEngine();
      audio.playCorrect();
      const gains = context.nodes.filter(n => n.kind === 'gain' && n !== audio._effectsBus && n !== audio._musicBus);
      assert.equal(gains.length, 2, 'one envelope per cue tone');
      for (const gain of gains) {
        const events = gain.gain.events;
        assert.equal(events[0][0], 'set');
        assert.equal(events[0][1], 0.0001, 'starts from silence');
        assert.equal(events[1][0], 'ramp', 'ramps up over the attack');
        assert.ok(events[1][1] > 0.0001, 'reaches the cue level');
        assert.equal(events.at(-1)[1], 0.0001, 'releases to silence');
      }
    });

    it('does not shape the victory hymn: it keeps its own attack', async () => {
      const { audio, context } = soundEngine({
        fetchTrack: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }),
      });
      context.decodeAudioData = async () => ({ duration: 4 });
      assert.equal(await audio.playVictoryHymn(), true);
      const voice = audio._victoryVoice;
      assert.ok(voice, 'the hymn is tracked as a voice');
      const gain = voice.nodes[1];
      assert.deepEqual(gain.connections, [audio._effectsBus], 'plays on the effects bus');
      assert.deepEqual(gain.gain.events, [['set', 1, 10]], 'full level from the first sample, no ramp');
      assert.deepEqual(voice.source.starts, [10]);
    });

    it('ducks the music under the hymn and restores it when the fanfare ends', async () => {
      const { audio, context } = soundEngine({
        fetchTrack: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }),
      });
      context.decodeAudioData = async () => ({ duration: 4 });
      audio.startBGM();
      await audio.playVictoryHymn();
      assert.deepEqual(audio._musicBus.gain.events.slice(-2), [['set', 0.35, 10], ['linear', 0.35 * 0.3, 10.15]],
        'music dips to 30 % while the fanfare rings');

      const voice = audio._victoryVoice;
      voice.source.onended();
      assert.ok(voice.nodes.every(node => node.disconnected));
      assert.equal(audio._voices.has(voice), false);
      assert.equal(audio._musicDuck, 1);
      assert.deepEqual(audio._musicBus.gain.events.at(-1), ['linear', 0.35, 10.15], 'the music comes back up');
    });

    it('stacks music ducks by reason so releasing one never un-ducks another', () => {
      const { audio } = soundEngine();
      assert.equal(audio.setMusicDuck('story-narration', 0.3), 0.3, 'the story scene dips the music');
      assert.equal(audio.setMusicDuck('victory-hymn', 0.2), 0.2, 'the louder dip wins');
      assert.equal(audio.setMusicDuck('story-narration', null), 0.2,
        'a scene ending does not undo the hymn');
      assert.equal(audio._musicDuck, 0.2);
      assert.equal(audio.setMusicDuck('victory-hymn', null), 1, 'releasing the last dip restores the music');
      assert.equal(audio._musicDuck, 1);

      assert.equal(audio.setMusicDuck('story-narration', 5), 1, 'a dip above full level is clamped');
      assert.equal(audio.setMusicDuck('story-narration', -2), 0, 'a negative dip is clamped');
      assert.equal(audio.setMusicDuck('story-narration', null), 1);
    });

    it('fades the music under a story scene instead of cutting it', () => {
      const { audio } = soundEngine();
      audio.startBGM();
      audio.setMusicDuck('story-narration', 0.3);
      const events = audio._musicBus.gain.events.slice(-2);
      assert.deepEqual(events, [['set', 0.35, 10], ['linear', 0.35 * 0.3, 10 + 0.15]],
        'the dip ramps over the shared music fade');
      audio.setMusicDuck('story-narration', null);
      assert.deepEqual(audio._musicBus.gain.events.at(-1), ['linear', 0.35, 10.15],
        'and comes back up the same way');
    });

    it('plays the hymn once: one shot, never looped, never restarted', async () => {
      const { audio, context } = soundEngine({
        fetchTrack: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }),
      });
      context.decodeAudioData = async () => ({ duration: 4 });
      assert.equal(await audio.playVictoryHymn(), true);
      const first = audio._victoryVoice;
      assert.equal(first.source.loop, false, 'the fanfare is a one-shot, not a loop');
      assert.deepEqual(first.source.starts, [10]);

      assert.equal(await audio.playVictoryHymn(), true);
      assert.equal(audio._victoryVoice, first, 'a repeated call is a no-op while it rings');
      assert.deepEqual(first.source.starts, [10], 'it is never restarted');
      assert.equal(first.source.stops.length, 0);

      audio.startLevelBGM(2, 1);
      assert.equal(first.source.stops.length, 1, 'new background music ends the fanfare');
      assert.equal(audio._victoryVoice, null);
      assert.equal(audio._musicDuck, 1, 'and that releases the music duck');
    });

    it('reports an unavailable hymn so the caller can fall back', async () => {
      const warn = console.warn;
      console.warn = () => {};
      try {
        const { audio } = soundEngine({ fetchTrack: () => Promise.reject(new Error('offline')) });
        assert.equal(await audio.playVictoryHymn(), false);
        assert.equal(audio._victoryVoice, null);
      } finally {
        console.warn = warn;
      }
    });

    it('volume APIs reject invalid input, clamp finite values, and never pretend music support', () => {
      const { audio } = soundEngine();
      assert.equal(audio.effectsVolume, 1);
      assert.equal(audio.musicVolume, 0.35);
      for (const value of [NaN, Infinity, -Infinity, '0.5', null, undefined, {}]) {
        assert.throws(() => audio.setEffectsVolume(value), TypeError);
        assert.throws(() => audio.setMusicVolume(value), TypeError);
      }
      assert.equal(audio.setEffectsVolume(-1), 0);
      assert.equal(audio.getEffectsVolume(), 0);
      assert.equal(audio.setEffectsVolume(2), 1);
      assert.deepEqual(audio.musicVolumeCapability, { supported: false, status: 'unverified-media-routing' });
      assert.throws(() => audio.setMusicVolume(0.5), /unverified-media-routing/);
      assert.equal(audio.getMusicVolume(), 0.35);
      audio.startBGM();
      assert.equal(audio._mediaSources.size, 0);
      assert.equal(audio._rotation.currentAudio.volume, 0.35, 'default music playback unchanged');
    });

    it('opted-in music uses one shared realtime gain route for current/preload/successor', () => {
      const { audio, context, state } = soundEngine({ musicGainRouting: true });
      assert.equal(audio.setMusicVolume(0.1), 0.1, 'gain can be chosen before first playback');
      audio.startBGM();
      assert.equal(audio._musicBus.gain.value, 0.1);
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'available' });
      assert.equal(context.sources.length, 2);
      const first = audio._rotation.currentAudio;
      first.currentTime = 17;
      for (const source of context.sources) {
        assert.deepEqual(source.connections, [audio._musicBus]);
        assert.equal(source.element.volume, 1);
        assert.match(source.element.src, /^https:\/\/localhost\/game\//);
      }
      assert.equal(audio.setMusicVolume(2), 1);
      assert.equal(audio.setMusicVolume(-2), 0);
      audio.setMusicVolume(0.2);
      assert.equal(audio._musicBus.gain.value, 0.2);
      assert.equal(first.currentTime, 17);
      audio.pauseBGM();
      audio.toggleMute();
      audio.toggleMute();
      assert.equal(state.plays, 1);
      assert.equal(first.currentTime, 17);
      audio.resumeBGM();
      assert.equal(state.plays, 2);
      first.fireEnded();
      assert.equal(context.sources[0].disconnected, true);
      assert.equal(context.sources.length, 3);
      assert.equal(audio._mediaSources.size, 2, 'current and one silent preload only');
      assert.equal(audio._rotation.nextAudio.plays, 0);
      audio.toggleMute();
      assert.equal(audio._musicBus.gain.value, 0);
      audio.stopBGM();
      assert.equal(audio._mediaSources.size, 0);
      assert.ok(context.sources.every(source => source.disconnected));
      audio.toggleMute();
      assert.equal(audio._musicBus.gain.value, 0.2);
      assert.equal(state.plays, 3, 'stop/unmute does not restart');
    });

    it('prefetches custom-scheme bundled tracks to same-origin blobs on the music gain bus', async () => {
      const requested = [];
      const { audio, context, state } = soundEngine({
        musicGainRouting: true,
        baseUrl: 'capacitor://localhost/game/',
        fetchTrack: async (url) => {
          requested.push(url);
          return { ok: true, blob: async () => new Blob(['bundled-audio']) };
        },
      });
      await audio._bundledReady;
      assert.deepEqual(requested, [
        'capacitor://localhost/game/a.mp3',
        'capacitor://localhost/game/b.mp3',
      ], 'each bundled track is fetched exactly once from the bundle origin');
      audio.startBGM();
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'available' });
      const current = audio._rotation.currentAudio;
      assert.match(current.src, /^blob:/, 'the element plays a same-origin blob URL');
      assert.equal(current.volume, 1, 'gain now lives on the shared bus');
      assert.equal(state.plays, 1);
      assert.equal(context.sources.length, 2, 'current and preload are both captured');
      for (const source of context.sources) {
        assert.deepEqual(source.connections, [audio._musicBus]);
        assert.match(source.element.src, /^blob:/);
      }
      for (const value of [0, 0.2, 1]) {
        assert.equal(audio.setMusicVolume(value), value);
        assert.equal(audio._musicBus.gain.value, value);
      }
      assert.equal(current.currentTime, 0);
      audio.stopBGM();
      assert.equal(audio._mediaSources.size, 0);
    });

    it('swaps a late bundled blob into the playing element and resumes it once', async () => {
      let resolveFetch;
      let fetchStarted;
      const started = new Promise(resolve => { fetchStarted = resolve; });
      const { audio, context, state } = soundEngine({
        musicGainRouting: true,
        baseUrl: 'capacitor://localhost/game/',
        tracks: [{ file: 'a.mp3' }],
        fetchTrack: () => {
          fetchStarted();
          return new Promise((resolve) => { resolveFetch = resolve; });
        },
      });
      await started;
      audio.startBGM();
      const current = audio._rotation.currentAudio;
      assert.equal(current.src, 'capacitor://localhost/game/a.mp3');
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'awaiting-media-route' });
      audio.setMusicVolume(0.2);
      assert.equal(state.plays, 1, 'direct playback starts while the blob is pending');
      resolveFetch({ ok: true, blob: async () => new Blob(['bundled-audio']) });
      await audio._bundledReady;
      assert.match(current.src, /^blob:/);
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'available' });
      assert.equal(context.sources.length, 2, 'current and its single-track preload are captured');
      assert.equal(audio._musicBus.gain.value, 0.2, 'late routing keeps the chosen gain');
      assert.equal(context.sources[0].element, current);
      assert.match(audio._rotation.nextAudio.src, /^blob:/);
      assert.equal(state.plays, 2, 'the swapped element resumes exactly once');
      assert.equal(current.currentTime, 0);
    });

    it('keeps direct bundled playback when the blob fetch fails', async () => {
      const warn = console.warn;
      console.warn = () => {};
      try {
        const { audio, state } = soundEngine({
          musicGainRouting: true,
          baseUrl: 'capacitor://localhost/game/',
          tracks: [{ file: 'a.mp3' }],
          fetchTrack: async () => { throw new Error('offline'); },
        });
        await audio._bundledReady;
        audio.startBGM();
        assert.equal(state.plays, 1);
        assert.deepEqual(audio.musicVolumeCapability, { supported: false, status: 'unsupported-media-routing' });
        assert.throws(() => audio.setMusicVolume(0.5), /unsupported-media-routing/);
        assert.equal(audio._rotation.currentAudio.src, 'capacitor://localhost/game/a.mp3');
        assert.equal(audio._rotation.currentAudio.volume, 0.35);
        assert.equal(audio._musicBus.gain.value, 0.35);
      } finally {
        console.warn = warn;
      }
    });

    it('routes a Capacitor iOS media response (status 0) and keeps it across mute', async () => {
      const requests = [];
      let unavailable = 0;
      const { audio, context } = soundEngine({
        musicGainRouting: true,
        baseUrl: 'capacitor://localhost/game/',
        tracks: [{ file: 'a.mp3' }],
        onMusicVolumeUnavailable: () => { unavailable++; },
        fetchTrack: async (url, init) => {
          requests.push({ url, init });
          return { ok: false, status: 0, blob: async () => new Blob(['bundled-audio']) };
        },
      });
      await audio._bundledReady;
      assert.deepEqual(requests, [{
        url: 'capacitor://localhost/game/a.mp3',
        init: { headers: { Range: 'bytes=0-' } },
      }], 'a full byte range asks Capacitor for a real HTTP response');
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'awaiting-media-route' });
      audio.toggleMute();
      audio.toggleMute();
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'awaiting-media-route' },
        'mute and unmute on the title keep the music slider');
      audio.startBGM();
      assert.match(audio._rotation.currentAudio.src, /^blob:/);
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'available' });
      audio.toggleMute();
      audio.toggleMute();
      assert.deepEqual(audio.musicVolumeCapability, { supported: true, status: 'available' },
        'mute and unmute while music plays keep the music slider');
      assert.equal(audio.setMusicVolume(0.2), 0.2);
      assert.equal(context.sources.length, 2);
      assert.equal(unavailable, 0);
    });

    it('reports a lost music route once so the UI can drop the slider immediately', async () => {
      const warn = console.warn;
      console.warn = () => {};
      try {
        let unavailable = 0;
        const { audio } = soundEngine({
          musicGainRouting: true,
          baseUrl: 'capacitor://localhost/game/',
          tracks: [{ file: 'a.mp3' }, { file: 'b.mp3' }],
          onMusicVolumeUnavailable: () => {
            unavailable++;
            assert.equal(audio.musicVolumeCapability.supported, false);
          },
          fetchTrack: async () => ({ ok: false, status: 404, blob: async () => new Blob(['x']) }),
        });
        await audio._bundledReady;
        assert.equal(unavailable, 1);
      } finally {
        console.warn = warn;
      }
    });

    it('resumes a suspended context from startLevelBGM and effect gestures', () => {
      const { audio, context } = soundEngine({ levelMusic: { levels: {} } });
      assert.equal(context.state, 'suspended');
      audio.startLevelBGM(1, 1);
      assert.equal(context.resumes, 1, 'level music unlocks the context');
      assert.equal(context.state, 'running');
      context.state = 'suspended';
      audio.playCorrect();
      assert.equal(context.resumes, 2, 'an effect gesture resumes it again');
    });

    it('unsupported media source keeps default music playback with an explicit unavailable capability', () => {
      const warn = console.warn;
      console.warn = () => {};
      try {
        for (const options of [
          { context: fakeContext({ media: false }) },
          { tracks: [{ file: 'https://other.example/song.mp3' }] },
          { context: fakeContext({ failConnectAt: 1 }) },
          { context: fakeContext({ failConnectAt: 2 }) },
        ]) {
          const { audio, state } = soundEngine({ musicGainRouting: true, ...options });
          audio.startBGM();
          assert.equal(state.plays, 1);
          assert.deepEqual(audio.musicVolumeCapability, { supported: false, status: 'unsupported-media-routing' });
          assert.throws(() => audio.setMusicVolume(0.5), /unsupported-media-routing/);
          assert.equal(audio._musicBus.gain.value, 0.35);
          audio._rotation.currentAudio.fireEnded();
          assert.equal(state.plays, 2);
          assert.equal(audio._rotation.currentAudio.volume, 0.35);
        }
      } finally {
        console.warn = warn;
      }
    });

    it('new event cues are distinct and correct feedback avoids harsh waveforms', () => {
      const signatures = [];
      for (const method of ['playCorrect', 'playWrong', 'playTimeout', 'playHeal', 'playCampaignVictory', 'playHeroHurt', 'playLevelClear']) {
        const { audio, context } = soundEngine();
        audio[method]();
        const tones = context.nodes.filter(node => node.kind === 'oscillator');
        signatures.push(JSON.stringify(tones.map(n => [n.type, n.frequency.value, n.starts[0], n.stops[0]])));
        if (method === 'playCorrect') {
          assert.ok(tones.every(n => ['sine', 'triangle'].includes(n.type)));
          assert.ok(context.nodes.filter(n => n.kind === 'gain' && n !== audio._effectsBus && n !== audio._musicBus)
            .every(n => n.gain.value <= 0.12));
        }
      }
      assert.equal(new Set(signatures).size, signatures.length);
    });

    it('a later source failure restores default gain and disables adjustment during rotation', () => {
      const warn = console.warn;
      console.warn = () => {};
      try {
        const { audio, state } = soundEngine({
          musicGainRouting: true, context: fakeContext({ failConnectAt: 3 }),
        });
        audio.startBGM();
        audio.setMusicVolume(0);
        audio._rotation.currentAudio.fireEnded();
        assert.equal(audio.musicVolumeCapability.supported, false);
        assert.equal(audio.getMusicVolume(), 0.35);
        assert.equal(audio._musicBus.gain.value, 0.35);
        assert.equal(audio._rotation.nextAudio.volume, 0.35);
        assert.equal(state.plays, 2);
        audio.stopBGM();
      } finally {
        console.warn = warn;
      }
    });

    it('retains effects headroom if compressor API is unavailable and initializes muted buses', () => {
      const context = fakeContext();
      delete context.createDynamicsCompressor;
      const { audio } = soundEngine({ context });
      audio.toggleMute();
      audio.playCorrect();
      assert.equal(audio._effectsBus.gain.value, 0);
      assert.equal(audio._musicBus.gain.value, 0);
      assert.equal(audio._voices.size, 0);
      assert.deepEqual(audio._effectsBus.connections, [context.destination]);
      audio.toggleMute();
      audio.playCorrect();
      assert.equal(audio._effectsBus.gain.value, 0.4);
      assert.equal(audio._voices.size, 2);
    });
});

it('plays the configured menu track as a loop and never restarts it on repeat calls', () => {
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3' }, { file: 'menu.mp3' }],
    levelMusic: { menu: ['menu.mp3'], levels: {} },
    baseUrl: null,
    makeAudio: () => fakeAudio(state),
  });
  audio._ensureCtx = () => {};
  audio.startMenuBGM();
  const current = audio._rotation.currentAudio;
  assert.equal(audio._rotation.currentTrack.file, 'menu.mp3');
  assert.equal(state.plays, 1);

  // Switching between the intro and the menu pages calls this again; the
  // single-track playlist must keep playing instead of restarting.
  current.currentTime = 21;
  audio.startMenuBGM();
  audio.startMenuBGM();
  assert.equal(state.plays, 1);
  assert.equal(audio._rotation.currentAudio, current);
  assert.equal(current.currentTime, 21);

  // A one-track playlist loops itself when the track ends.
  current.fireEnded();
  assert.equal(audio._rotation.currentTrack.file, 'menu.mp3');
  assert.equal(state.plays, 2);
});

it('swaps between menu and level playlists', () => {
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: [{ file: 'a.mp3' }, { file: 'menu.mp3' }, { file: 'level.mp3' }],
    levelMusic: { menu: ['menu.mp3'], levels: { 1: ['level.mp3'] } },
    baseUrl: null,
    makeAudio: () => fakeAudio(state),
  });
  audio._ensureCtx = () => {};
  audio.startMenuBGM();
  assert.equal(audio._rotation.currentTrack.file, 'menu.mp3');
  audio.startLevelBGM(1, 1);
  assert.equal(audio._rotation.currentTrack.file, 'level.mp3');
  audio.startMenuBGM();
  assert.equal(audio._rotation.currentTrack.file, 'menu.mp3');
});

it('resumes a paused menu session instead of restarting it', () => {
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: [{ file: 'menu.mp3' }],
    levelMusic: { menu: ['menu.mp3'], levels: {} },
    baseUrl: null,
    makeAudio: () => fakeAudio(state),
  });
  audio._ensureCtx = () => {};
  audio.startMenuBGM();
  const current = audio._rotation.currentAudio;
  current.currentTime = 7;
  audio.pauseBGM();
  audio.startMenuBGM();
  assert.equal(audio._rotation.currentAudio, current);
  assert.equal(current.currentTime, 7);
  assert.equal(state.plays, 2);
});

it('ships the chosen menu track and repeats every level track for two levels', async () => {
  const config = JSON.parse(await readFile(new URL('./level-music.json', import.meta.url)));
  const { TOTAL_LEVELS } = await import('./levels.js');
  const CYCLE = [
    'retro-02-level-1.mp3',
    'retro-03-level-2.mp3',
    'retro-04-level-3.mp3',
    'loop-01-super-action-6.mp3',
    'loop-02-super-action-7.mp3',
    'loop-03-super-action-9.mp3',
    'loop-04-dangerous-encounter.mp3',
  ];
  assert.deepEqual(config.menu, ['retro-05-ending.mp3']);
  assert.deepEqual(
    Object.keys(config.levels).map(Number).sort((a, b) => a - b),
    Array.from({ length: TOTAL_LEVELS }, (_, index) => index + 1),
    'every level has a playlist entry',
  );
  for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
    const expected = CYCLE[Math.floor((level - 1) / 2) % CYCLE.length];
    assert.deepEqual(config.levels[String(level)], [expected], `level ${level} plays ${expected}`);
  }

  // Everything the playlists reference must ship with the game and be credited
  // in both the web and the app manifests.
  const web = JSON.parse(await readFile(new URL('./tracks.json', import.meta.url))).tracks;
  const mobile = JSON.parse(await readFile(new URL('../../mobile/game/tracks.json', import.meta.url))).tracks;
  const referenced = new Set([...Object.values(config.levels).flat(), ...config.menu]);
  for (const file of referenced) {
    await access(new URL(`./${file}`, import.meta.url));
    assert.ok(web.some(track => track.file === file), `${file} is credited in tracks.json`);
    assert.ok(mobile.some(track => track.file === file), `${file} is credited in the app manifest`);
    assert.ok(MUSIC_TRACKS.some(track => track.file === file), `${file} is credited on the licence pages`);
  }
});

it('starts the menu track on the first gesture after autoplay blocked it', async () => {
  const state = { plays: 0 };
  let blockAutoplay = true;
  const audio = new AudioEngine({
    tracks: [{ file: 'menu.mp3' }],
    levelMusic: { menu: ['menu.mp3'], levels: {} },
    baseUrl: null,
    makeAudio: () => {
      const element = fakeAudio(state);
      const realPlay = element.play;
      element.play = function () {
        // Exactly what a browser does before any user gesture.
        if (blockAutoplay) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        return realPlay.call(this);
      };
      return element;
    },
  });
  audio._ensureCtx = () => {};
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    // Page load: the attempt is made, the browser refuses, nothing is logged
    // as a failure because a gesture may still arrive.
    audio.startMenuBGM();
    await Promise.resolve();
    assert.equal(state.plays, 0);
    assert.equal(warnings.length, 0, 'a blocked autoplay attempt is not a warning');

    // The first click: the same session is retried and now plays.
    blockAutoplay = false;
    audio.startMenuBGM();
    assert.equal(state.plays, 1);
    assert.equal(audio._rotation.currentTrack.file, 'menu.mp3');

    // Later clicks while it plays must not restart it.
    const current = audio._rotation.currentAudio;
    audio.startMenuBGM();
    audio.startMenuBGM();
    assert.equal(state.plays, 1);
    assert.equal(audio._rotation.currentAudio, current);
  } finally {
    console.warn = warn;
  }
});

it('a level that starts while the playlist loads is not replaced by menu music', async () => {
  const state = { plays: 0 };
  const audio = new AudioEngine({
    tracks: [{ file: 'menu.mp3' }, { file: 'level.mp3' }],
    levelMusic: { menu: ['menu.mp3'], levels: { 1: ['level.mp3'] } },
    baseUrl: null,
    makeAudio: () => fakeAudio(state),
  });
  audio._ensureCtx = () => {};
  let releaseLevelMusic;
  audio._levelMusicReady = new Promise((resolve) => { releaseLevelMusic = resolve; });

  audio.startMenuBGM();          // waits for the playlist
  audio.startLevelBGM(1, 1);     // the player got into a level first
  assert.equal(audio._rotation.currentTrack.file, 'level.mp3');

  releaseLevelMusic();           // the playlist arrives late
  await audio._levelMusicReady;
  await Promise.resolve();
  assert.equal(audio._rotation.currentTrack.file, 'level.mp3', 'menu music must not hijack the level');
});
