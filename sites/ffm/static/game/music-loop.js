// music-loop.js — gapless looping for the bundled background music.
//
// A media element loses about 25 ms every time the track wraps: whether the
// rotation advances to the preloaded element or the element is looped with
// `loop = true`, the media pipeline re-runs the MP3 decoder at the seam and
// that gap is audible on rhythmic tracks (measured 24.5 ms in Chrome).
//
// A decoded AudioBuffer carries no encoder padding — Chrome's decoder trims it
// — so an AudioBufferSourceNode with `loop = true` wraps sample-accurately and
// loses nothing. This player owns that source for a single-track playlist and
// is driven by AudioEngine for volume, mute, pause and stop.

export class MusicLoop {
  /**
   * @param {object} options
   * @param {AudioContext} options.ctx live audio context
   * @param {AudioNode} options.destination node the music is played into
   * @param {(file: string) => Promise<ArrayBuffer>} options.load fetches a bundled track
   */
  constructor({ ctx, destination, load } = {}) {
    if (!ctx || typeof ctx.createBufferSource !== 'function' || typeof ctx.decodeAudioData !== 'function') {
      throw new TypeError('MusicLoop needs an AudioContext with decodeAudioData');
    }
    if (!destination || typeof destination.connect !== 'function') {
      throw new TypeError('MusicLoop needs a destination node');
    }
    if (typeof load !== 'function') throw new TypeError('MusicLoop needs a load(file) function');
    this._ctx = ctx;
    this._destination = destination;
    this._load = load;
    this._buffer = null;
    this._file = null;
    this._source = null;
    this._offset = 0;
    this._startedAt = 0;
  }

  /** File currently loaded, or null. */
  get file() {
    return this._file;
  }

  /** True while a looping source is running. */
  get playing() {
    return Boolean(this._source);
  }

  /** Decoded duration in seconds, or 0 before the first load. */
  get duration() {
    return this._buffer?.duration ?? 0;
  }

  /** Play `file` as a gapless loop from its start (decoding it once per file). */
  async play(file) {
    if (this._file !== file || !this._buffer) {
      const bytes = await this._load(file);
      const buffer = await this._ctx.decodeAudioData(bytes);
      if (!buffer || !(buffer.duration > 0)) throw new Error(`decoded ${file} has no audio`);
      this._file = file;
      this._buffer = buffer;
    }
    this._start(0);
    return this;
  }

  /** Stop output but remember the position, so resume() picks it up again. */
  pause() {
    if (!this._source) return;
    this._offset = this._position();
    this._stopSource();
  }

  resume() {
    if (!this._buffer || this._source) return;
    this._start(this._offset);
  }

  /** Stop output and rewind; the decoded track stays cached for a replay. */
  stop() {
    this._stopSource();
    this._offset = 0;
  }

  _position() {
    if (!this._source || !this._buffer) return this._offset;
    const duration = this._buffer.duration;
    if (!(duration > 0)) return 0;
    return (this._offset + (this._ctx.currentTime - this._startedAt)) % duration;
  }

  _start(offset) {
    this._stopSource();
    if (!this._buffer) return null;
    const duration = this._buffer.duration;
    const start = duration > 0 ? offset % duration : 0;
    const source = this._ctx.createBufferSource();
    source.buffer = this._buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = duration;
    source.connect(this._destination);
    source.start(0, start);
    this._offset = start;
    this._startedAt = this._ctx.currentTime;
    this._source = source;
    return source;
  }

  _stopSource() {
    const source = this._source;
    if (!source) return;
    this._source = null;
    try {
      source.stop();
    } catch {
      // Already stopped: nothing to release.
    }
    try {
      source.disconnect();
    } catch {
      // Disconnecting a torn-down node is not an error worth reporting.
    }
  }
}
