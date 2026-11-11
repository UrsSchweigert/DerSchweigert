// screen-fx.js — screen-space particle and bloom layer.
//
// The playfield canvas stays at its crisp 800×450 pixel-art resolution; this
// layer floats above it at the viewport's own resolution so glows, sparks and
// flashes stay smooth. Particles live in world coordinates (the 800×450 space)
// so effects can spill past the playfield onto the whole screen.

export const FX_Z_INDEX = 90;
export const MIN_INTENSITY = 0.2;
export const MAX_INTENSITY = 1.3;
export const DEFAULT_INTENSITY = 1;
export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 450;
export const MAX_DPR = 2;
export const DPR_TIERS = [2, 1.5, 1.25];

const MAX_STEP = 0.05;          // seconds; a single frame may not advance further
const SLOW_FRAME_SECONDS = 1 / 50;
const LADDER_SAMPLES = 90;
const WASH_BUDGET_SECONDS = 1;

// One knob for how large every effect reads on screen. Sizes, ring radii, arc
// radii and streak lengths are all multiplied by this at spawn time, so the
// recipes stay authored at a natural scale and the whole layer can be tuned up
// or down in one place.
export const PARTICLE_SIZE_SCALE = 1.9;
const WASH_BUDGET_ALPHA = 0.22;

const PARTICLE_DEFAULTS = {
  type: 'mote',
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 1,
  maxLife: 1,
  size: 1,
  color: '#ffffff',
  alpha: 1,
  grav: 0,
  drag: 0,
  rot: 0,
  vr: 0,
  blend: 'lighter',
};

const BLUR_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
  [0, 0],
];

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

/** Convert a #rgb/#rrggbb colour into an rgba() string with the given alpha. */
function withAlpha(color, alpha) {
  if (typeof color !== 'string') return color;
  const value = color.trim();
  if (value[0] === '#') {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return `rgba(${r},${g},${b},${alpha})`;
      }
    }
    return value;
  }
  const match = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i);
  if (match) return `rgba(${match[1]},${match[2]},${match[3]},${alpha})`;
  return value;
}

function resolveTierIndex(dpr) {
  for (let i = 0; i < DPR_TIERS.length; i++) {
    if (DPR_TIERS[i] <= dpr) return i;
  }
  return DPR_TIERS.length - 1;
}

/** Two-pass-friendly 3×3 box blur drawn without ctx.filter. */
function boxBlur(source, destCtx, dest, radius) {
  destCtx.setTransform(1, 0, 0, 1, 0, 0);
  destCtx.globalCompositeOperation = 'source-over';
  destCtx.clearRect(0, 0, dest.width, dest.height);
  destCtx.globalAlpha = 1 / 9;
  for (const [dx, dy] of BLUR_OFFSETS) {
    destCtx.drawImage(source, dx * radius, dy * radius);
  }
  destCtx.globalAlpha = 1;
}

/**
 * Create the screen-space particle/bloom layer and its public api.
 *
 * @param {object} [options]
 * @returns {object} the screen-fx api
 */
export function createScreenFx(options = {}) {
  const root = typeof globalThis !== 'undefined' ? globalThis : {};
  const doc = options.document !== undefined ? options.document : root.document;

  const instance = {
    _document: doc,
    _host: options.host !== undefined ? options.host : (doc ? doc.body : undefined),
    _playfield: options.playfield !== undefined
      ? options.playfield
      : (doc && typeof doc.getElementById === 'function' ? doc.getElementById('playfield') : undefined),
    _effects: options.effects || {},

    _intensity: clamp(options.intensity !== undefined ? options.intensity : DEFAULT_INTENSITY, MIN_INTENSITY, MAX_INTENSITY),
    _reducedMotion: options.reducedMotion !== undefined
      ? !!options.reducedMotion
      : (typeof root.matchMedia === 'function' ? !!root.matchMedia('(prefers-reduced-motion: reduce)').matches : false),
    _bloom: options.bloom !== false,
    _paused: false,
    _destroyed: false,

    _time: 0,
    _particles: [],
    _washes: [],
    _vignettes: [],
    _shake: null,
    _washTimes: [],
    _dtBuffer: [],
    _timers: [],
    _emitters: [],

    _rect: { left: 0, top: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT },
    _cssW: WORLD_WIDTH,
    _cssH: WORLD_HEIGHT,

    canvas: null,
    _layer: null,
    _small: null,
    _blurA: null,
    _blurB: null,
    _ctx: null,
    _layerCtx: null,
    _smallCtx: null,
    _blurACtx: null,
    _blurBCtx: null,
  };

  const requestedDpr = options.dpr !== undefined
    ? options.dpr
    : Math.min((typeof root.devicePixelRatio === 'number' && root.devicePixelRatio) || 1, MAX_DPR);
  instance._tierIndex = resolveTierIndex(requestedDpr);
  instance._dpr = DPR_TIERS[instance._tierIndex];

  instance._makeCanvas = function makeCanvas() {
    if (instance._document && typeof instance._document.createElement === 'function') {
      return instance._document.createElement('canvas');
    }
    return {
      style: {},
      width: 0,
      height: 0,
      parentNode: null,
      setAttribute() {},
      getContext() {
        return null;
      },
    };
  };

  instance._alphaScale = function alphaScale() {
    return instance._reducedMotion ? 0.5 : 1;
  };

  instance._countScale = function countScale() {
    return (instance._reducedMotion ? 0.4 : 1) * instance._intensity;
  };

  instance._blendOf = function blendOf(particle) {
    return particle.blend || 'lighter';
  };

  instance._viewportSize = function viewportSize() {
    if (typeof root.innerWidth === 'number' && root.innerWidth > 0) {
      return { width: root.innerWidth, height: root.innerHeight > 0 ? root.innerHeight : WORLD_HEIGHT };
    }
    const documentElement = doc && doc.documentElement;
    if (documentElement && typeof documentElement.clientWidth === 'number' && documentElement.clientWidth > 0) {
      return {
        width: documentElement.clientWidth,
        height: documentElement.clientHeight > 0 ? documentElement.clientHeight : documentElement.clientWidth * (WORLD_HEIGHT / WORLD_WIDTH),
      };
    }
    if (instance._host && typeof instance._host.clientWidth === 'number' && instance._host.clientWidth > 0) {
      return {
        width: instance._host.clientWidth,
        height: instance._host.clientHeight > 0 ? instance._host.clientHeight : instance._host.clientWidth * (WORLD_HEIGHT / WORLD_WIDTH),
      };
    }
    return { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  };

  instance._readRect = function readRect() {
    const pf = instance._playfield;
    if (pf && typeof pf.getBoundingClientRect === 'function') {
      const rect = pf.getBoundingClientRect();
      if (rect && typeof rect.left === 'number' && typeof rect.width === 'number') {
        // A hidden playfield (display:none, or measured before layout) reports
        // width 0; without this guard the world transform collapses to scale 0
        // and every particle piles up on one pixel instead of failing loudly.
        return {
          left: rect.left,
          top: rect.top || 0,
          width: rect.width || WORLD_WIDTH,
          height: rect.height || WORLD_HEIGHT,
        };
      }
    }
    if (pf && typeof pf.left === 'number' && typeof pf.width === 'number') {
      return { left: pf.left, top: pf.top || 0, width: pf.width || WORLD_WIDTH, height: pf.height || WORLD_HEIGHT };
    }
    return { left: 0, top: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT };
  };

  // The visible canvas is the only element this module creates and mounts.
  instance.canvas = instance._makeCanvas();
  instance.canvas.id = 'screen-fx';
  if (typeof instance.canvas.setAttribute === 'function') instance.canvas.setAttribute('aria-hidden', 'true');
  const style = instance.canvas.style || (instance.canvas.style = {});
  style.position = 'fixed';
  style.inset = '0';
  style.width = '100%';
  style.height = '100%';
  style.pointerEvents = 'none';
  style.zIndex = String(FX_Z_INDEX);

  if (instance._host && typeof instance._host.appendChild === 'function') {
    instance._host.appendChild(instance.canvas);
  }

  instance._layer = instance._makeCanvas();
  instance._small = instance._makeCanvas();
  instance._blurA = instance._makeCanvas();
  instance._blurB = instance._makeCanvas();

  instance._addParticle = function addParticle(seed) {
    if (instance._destroyed) return null;
    // Drop undefined keys: spawn helpers pass every argument through, so an
    // omitted colour would otherwise overwrite the default with undefined and
    // reach addColorStop() as the invalid string "undefined".
    const clean = {};
    for (const key in seed) {
      if (seed[key] !== undefined) clean[key] = seed[key];
    }
    const particle = Object.assign({}, PARTICLE_DEFAULTS, clean);
    if ('maxLife' in particle && !('life' in clean)) particle.life = particle.maxLife;
    particle.size *= PARTICLE_SIZE_SCALE;
    if (typeof particle.radius === 'number') particle.radius *= PARTICLE_SIZE_SCALE;
    if (typeof particle.r0 === 'number') particle.r0 *= PARTICLE_SIZE_SCALE;
    if (typeof particle.r1 === 'number') particle.r1 *= PARTICLE_SIZE_SCALE;
    if (typeof particle.width === 'number') particle.width *= PARTICLE_SIZE_SCALE;
    particle.px = particle.x;
    particle.py = particle.y;
    instance._particles.push(particle);
    return particle;
  };

  instance._trackPerformance = function trackPerformance(dt) {
    instance._dtBuffer.push(dt);
    if (instance._dtBuffer.length > LADDER_SAMPLES) instance._dtBuffer.shift();
    if (instance._dtBuffer.length < LADDER_SAMPLES) return;
    let total = 0;
    for (const sample of instance._dtBuffer) total += sample;
    if (total / instance._dtBuffer.length > SLOW_FRAME_SECONDS && instance._tierIndex < DPR_TIERS.length - 1) {
      instance._tierIndex += 1;
      instance._dpr = DPR_TIERS[instance._tierIndex];
      instance._dtBuffer = [];
      instance.resize();
    }
  };

  instance._drawParticle = function drawParticle(ctx, particle) {
    const lifeFactor = clamp01(particle.life / (particle.maxLife || 1));
    const alpha = clamp01(particle.alpha) * lifeFactor;
    if (alpha <= 0) return;
    ctx.globalCompositeOperation = instance._blendOf(particle);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    const color = particle.color;

    switch (particle.type) {
      case 'spark':
        ctx.lineWidth = Math.max(1, particle.size || 1);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(particle.px, particle.py);
        ctx.lineTo(particle.x, particle.y);
        ctx.stroke();
        break;
      case 'ember':
      case 'mote':
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.5, particle.size * (0.5 + 0.5 * lifeFactor)), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'shard':
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot || 0);
        ctx.fillStyle = color;
        ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        ctx.restore();
        break;
      case 'ring': {
        const radius = particle.r0 + (particle.r1 - particle.r0) * (1 - lifeFactor);
        ctx.lineWidth = Math.max(1, particle.width || 2);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.5, radius), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arc':
        ctx.lineWidth = Math.max(1, particle.width || 2);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.5, particle.radius || 1), particle.a0 || 0, particle.a1 !== undefined ? particle.a1 : Math.PI * 2);
        ctx.stroke();
        break;
      case 'flash': {
        const radius = Math.max(1, particle.radius * (0.5 + 0.5 * lifeFactor));
        const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, radius);
        gradient.addColorStop(0, withAlpha(color, 1));
        gradient.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'beam': {
        const halfWidth = particle.size / 2;
        const span = particle.height || 200;
        const gradient = ctx.createLinearGradient(particle.x, particle.y, particle.x, particle.y + span);
        gradient.addColorStop(0, withAlpha(color, 0.75));
        gradient.addColorStop(0.6, withAlpha(color, 0.4));
        gradient.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(particle.x - halfWidth, particle.y, particle.size, span);
        // Brighter inner shafts give the column a streaked, textured read
        // instead of a flat rectangle of light.
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = withAlpha(color, 0.55);
        ctx.fillRect(particle.x - halfWidth * 0.45, particle.y, particle.size * 0.18, span * 0.9);
        ctx.fillRect(particle.x + halfWidth * 0.2, particle.y, particle.size * 0.1, span * 0.78);
        break;
      }
      case 'smoke': {
        const radius = Math.max(1, particle.size * (1 + (1 - lifeFactor) * 0.8));
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha * 0.55;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'confetti':
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot || 0);
        ctx.fillStyle = color;
        ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
        ctx.restore();
        break;
      case 'ray': {
        const angle = particle.rot || 0;
        ctx.lineWidth = Math.max(1.5, particle.width || 2);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x + Math.cos(angle) * (particle.length || 10), particle.y + Math.sin(angle) * (particle.length || 10));
        ctx.stroke();
        break;
      }
      case 'streak': {
        ctx.lineWidth = Math.max(1, particle.width || 2);
        ctx.strokeStyle = color;
        const dx = particle.x - particle.px;
        const dy = particle.y - particle.py;
        const travelled = Math.hypot(dx, dy);
        let tailX = particle.x;
        let tailY = particle.y;
        if (travelled > 0.0001) {
          tailX = particle.x - (dx / travelled) * (particle.length || 0);
          tailY = particle.y - (dy / travelled) * (particle.length || 0);
        }
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(particle.x, particle.y);
        ctx.stroke();
        break;
      }
      default:
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.5, particle.size || 1), 0, Math.PI * 2);
        ctx.fill();
    }
  };

  instance._compositeBloom = function compositeBloom() {
    const smallCtx = instance._smallCtx;
    const blurACtx = instance._blurACtx;
    const blurBCtx = instance._blurBCtx;
    if (!smallCtx || !blurACtx || !blurBCtx) return;
    const smallW = instance._small.width;
    const smallH = instance._small.height;
    smallCtx.setTransform(1, 0, 0, 1, 0, 0);
    smallCtx.clearRect(0, 0, smallW, smallH);
    smallCtx.drawImage(instance._layer, 0, 0, smallW, smallH);
    boxBlur(instance._small, blurACtx, instance._blurA, 2);
    boxBlur(instance._blurA, blurBCtx, instance._blurB, 4);
    instance._ctx.globalCompositeOperation = 'lighter';
    instance._ctx.globalAlpha = 0.55;
    instance._ctx.drawImage(instance._blurA, 0, 0, instance._cssW, instance._cssH);
    instance._ctx.globalAlpha = 0.32;
    instance._ctx.drawImage(instance._blurB, 0, 0, instance._cssW, instance._cssH);
    instance._ctx.globalAlpha = 1;
    instance._ctx.globalCompositeOperation = 'source-over';
  };

  instance.resize = function resize() {
    if (instance._destroyed) return;
    instance._rect = instance._readRect();
    const viewport = instance._viewportSize();
    instance._cssW = viewport.width;
    instance._cssH = viewport.height;
    const dpr = instance._dpr;
    const width = Math.max(1, Math.round(instance._cssW * dpr));
    const height = Math.max(1, Math.round(instance._cssH * dpr));
    instance.canvas.width = width;
    instance.canvas.height = height;
    // Pin the CSS box to the backing store: 'width:100%' would let the browser
    // stretch the canvas whenever innerWidth/innerHeight differ from the
    // element's own box (scrollbars, visualViewport, page zoom).
    if (instance.canvas.style) {
      instance.canvas.style.width = instance._cssW + 'px';
      instance.canvas.style.height = instance._cssH + 'px';
    }
    instance._layer.width = width;
    instance._layer.height = height;
    const smallW = Math.max(1, Math.round(width / 5));
    const smallH = Math.max(1, Math.round(height / 5));
    instance._small.width = smallW;
    instance._small.height = smallH;
    instance._blurA.width = smallW;
    instance._blurA.height = smallH;
    instance._blurB.width = smallW;
    instance._blurB.height = smallH;
    instance._ctx = instance.canvas.getContext('2d');
    instance._layerCtx = instance._layer.getContext('2d');
    instance._smallCtx = instance._small.getContext('2d');
    instance._blurACtx = instance._blurA.getContext('2d');
    instance._blurBCtx = instance._blurB.getContext('2d');
  };

  // The playfield moves and resizes (window resize, orientation change, the HUD
  // hiding), so the layer re-measures before every frame. Without this the
  // canvas kept its construction-time size and every effect drifted away from
  // the sprites as soon as the viewport changed.
  instance._syncLayout = function syncLayout() {
    if (instance._destroyed) return;
    const viewport = instance._viewportSize();
    if (viewport.width !== instance._cssW || viewport.height !== instance._cssH) {
      instance.resize();
      return;
    }
    const rect = instance._readRect();
    const current = instance._rect;
    if (!current || rect.left !== current.left || rect.top !== current.top
      || rect.width !== current.width || rect.height !== current.height) {
      instance._rect = rect;
    }
  };

  // The cached mapping the renderer draws with; refreshed once per frame by
  // _syncLayout().
  instance._cachedMapping = function cachedMapping() {
    const rect = instance._rect;
    return {
      scale: rect.width / WORLD_WIDTH,
      offsetX: rect.left,
      offsetY: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  // Public mapping: re-measures first. Callers convert a press position into
  // world space, and the layout can change (HUD appearing, answer grid
  // re-flowing, a new level) without any window resize to trigger a refresh.
  // Reading the stale rect put the answer burst on the wrong button for the
  // first tap after such a change.
  instance.mapping = function mapping() {
    instance._syncLayout();
    return instance._cachedMapping();
  };

  instance.worldToScreen = function worldToScreen(x, y) {
    const map = instance._cachedMapping();
    return { x: map.offsetX + x * map.scale, y: map.offsetY + y * map.scale };
  };

  instance.play = function play(name, payload) {
    const effect = instance._effects[name];
    if (typeof effect !== 'function') return false;
    effect(instance, payload);
    return true;
  };

  instance.setIntensity = function setIntensity(value) {
    instance._intensity = clamp(value, MIN_INTENSITY, MAX_INTENSITY);
  };

  instance.getIntensity = function getIntensity() {
    return instance._intensity;
  };

  instance.setReducedMotion = function setReducedMotion(value) {
    instance._reducedMotion = !!value;
  };

  instance.isReducedMotion = function isReducedMotion() {
    return instance._reducedMotion;
  };

  instance.setBloom = function setBloom(value) {
    instance._bloom = !!value;
  };

  instance.isBloom = function isBloom() {
    return instance._bloom;
  };

  instance.pause = function pause() {
    instance._paused = true;
  };

  instance.resume = function resume() {
    instance._paused = false;
  };

  instance.isPaused = function isPaused() {
    return instance._paused;
  };

  // Shake is computed once per frame and shared: the layer offsets its own
  // particles with it, and the game reads the same value to move the canvas, so
  // the sprites and the effects shake together instead of independently.
  instance._computeShake = function computeShake() {
    if (!instance._shake) {
      instance._shakeOffset = { x: 0, y: 0 };
      return instance._shakeOffset;
    }
    const decay = clamp01(instance._shake.time / (instance._shake.duration || 1));
    const amplitude = instance._shake.amplitude * decay;
    instance._shakeOffset = {
      x: (Math.random() * 2 - 1) * amplitude,
      y: (Math.random() * 2 - 1) * amplitude,
    };
    return instance._shakeOffset;
  };

  instance.getShakeOffset = function getShakeOffset() {
    return instance._shakeOffset || { x: 0, y: 0 };
  };

  instance.getDprTier = function getDprTier() {
    return instance._dpr;
  };

  instance.getParticleCount = function getParticleCount() {
    return instance._particles.length;
  };

  instance.isActive = function isActive() {
    return instance._particles.length > 0
      || instance._washes.length > 0
      || instance._vignettes.length > 0
      || instance._timers.length > 0
      || instance._emitters.length > 0
      || instance._shake !== null;
  };

  instance.countScale = function countScale() {
    return instance._countScale();
  };

  instance.alphaScale = function alphaScale() {
    return instance._alphaScale();
  };

  instance.setEffects = function setEffects(map) {
    if (!map || typeof map !== 'object') return;
    instance._effects = map;
  };

  instance.schedule = function schedule(seconds, fn) {
    if (instance._destroyed) return null;
    const delay = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const timer = { at: instance._time + delay, fn };
    instance._timers.push(timer);
    return timer;
  };

  instance.emitter = function emitter(seconds, ratePerSecond, fn) {
    if (instance._destroyed) return null;
    const duration = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const rate = Math.max(0, Number.isFinite(ratePerSecond) ? ratePerSecond : 0);
    if (duration <= 0 || rate <= 0) return null;
    const emitter = { remaining: duration, duration, rate, fn, carry: 0, fired: 0 };
    instance._emitters.push(emitter);
    return emitter;
  };

  instance._advanceScheduler = function advanceScheduler(dt) {
    const dueTimers = [];
    instance._timers = instance._timers.filter((timer) => {
      if (timer.at <= instance._time) {
        dueTimers.push(timer);
        return false;
      }
      return true;
    });
    for (const timer of dueTimers) timer.fn();

    const expired = [];
    const emitters = instance._emitters.slice();
    for (const emitter of emitters) {
      emitter.remaining -= dt;
      emitter.carry += emitter.rate * dt;
      const ticks = Math.floor(emitter.carry);
      emitter.carry -= ticks;
      if (ticks > 0) {
        const duration = emitter.duration > 0 ? emitter.duration : 1;
        const progress = clamp01(1 - Math.max(0, emitter.remaining) / duration);
        for (let i = 0; i < ticks; i++) {
          emitter.fn(progress);
          emitter.fired++;
        }
        emitter.lastProgress = progress;
      }
      if (emitter.remaining <= 0) {
        // Guarantee the endpoint: a rate*dt < 1 emitter would otherwise expire
        // without ever firing, and a duration that is not a step multiple would
        // end at progress < 1.
        if (emitter.rate > 0 && (emitter.lastProgress || 0) < 0.999) {
          emitter.fn(1);
          emitter.fired++;
        }
        expired.push(emitter);
      }
    }
    if (expired.length) {
      instance._emitters = instance._emitters.filter((emitter) => expired.indexOf(emitter) === -1);
    }
  };

  instance.step = function step(dtSeconds) {
    if (instance._destroyed) return;
    const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, MAX_STEP);
    if (instance._paused) return;
    instance._trackPerformance(dt);
    instance._time += dt;
    instance._advanceScheduler(dt);
    for (const particle of instance._particles) {
      particle.px = particle.x;
      particle.py = particle.y;
      particle.life -= dt;
      particle.vy += (particle.grav || 0) * dt;
      const damp = Math.max(0, 1 - (particle.drag || 0) * dt);
      particle.vx *= damp;
      particle.vy *= damp;
      particle.x += (particle.vx || 0) * dt;
      particle.y += (particle.vy || 0) * dt;
      particle.rot += (particle.vr || 0) * dt;
    }
    instance._particles = instance._particles.filter((particle) => particle.life > 0);
    instance._washes = instance._washes.filter((wash) => {
      wash.time -= dt;
      return wash.time > 0;
    });
    instance._vignettes = instance._vignettes.filter((vignette) => {
      vignette.time -= dt;
      return vignette.time > 0;
    });
    if (instance._shake) {
      instance._shake.time -= dt;
      if (instance._shake.time <= 0) instance._shake = null;
    }
  };

  instance.render = function render() {
    if (instance._destroyed) return;
    const layerCtx = instance._layerCtx;
    const ctx = instance._ctx;
    if (!layerCtx || !ctx) return;
    const dpr = instance._dpr;
    const cssW = instance._cssW;
    const cssH = instance._cssH;
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layerCtx.clearRect(0, 0, cssW, cssH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const hasContent = instance._particles.length > 0 || instance._washes.length > 0
      || instance._vignettes.length > 0 || Boolean(instance._shake);
    if (!hasContent) return;

    const map = instance._cachedMapping();
    const shake = instance._computeShake();

    layerCtx.save();
    layerCtx.translate(map.offsetX + shake.x, map.offsetY + shake.y);
    layerCtx.scale(map.scale, map.scale);
    for (const particle of instance._particles) {
      if (instance._blendOf(particle) === 'source-over' && particle.type === 'smoke') instance._drawParticle(layerCtx, particle);
    }
    for (const particle of instance._particles) {
      if (instance._blendOf(particle) === 'source-over' && particle.type !== 'smoke') instance._drawParticle(layerCtx, particle);
    }
    for (const particle of instance._particles) {
      if (instance._blendOf(particle) !== 'source-over') instance._drawParticle(layerCtx, particle);
    }
    layerCtx.restore();

    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.globalCompositeOperation = 'source-over';
    const layerW = instance._layer.width;
    const layerH = instance._layer.height;
    for (const wash of instance._washes) {
      layerCtx.globalAlpha = clamp01(wash.alpha);
      layerCtx.fillStyle = wash.color;
      layerCtx.fillRect(0, 0, layerW, layerH);
    }
    for (const vignette of instance._vignettes) {
      const progress = 1 - clamp01(vignette.time / (vignette.duration || 1));
      const eased = progress * progress * (3 - 2 * progress);
      const alpha = vignette.a0 + (vignette.a1 - vignette.a0) * eased;
      const gradient = layerCtx.createRadialGradient(
        layerW / 2, layerH / 2, Math.min(layerW, layerH) * 0.3,
        layerW / 2, layerH / 2, Math.max(layerW, layerH) * 0.75
      );
      gradient.addColorStop(0, withAlpha(vignette.color, 0));
      gradient.addColorStop(1, withAlpha(vignette.color, 1));
      layerCtx.globalAlpha = clamp01(alpha);
      layerCtx.fillStyle = gradient;
      layerCtx.fillRect(0, 0, layerW, layerH);
    }
    layerCtx.globalAlpha = 1;

    ctx.drawImage(instance._layer, 0, 0, cssW, cssH);
    if (instance._bloom) instance._compositeBloom();
  };

  instance.frame = function frame(dtSeconds) {
    instance._syncLayout();
    instance.step(dtSeconds);
    instance.render();
  };

  instance.spark = function spark(x, y, angle, speed, color, life) {
    const count = Math.max(1, Math.round(5 * instance._countScale()));
    let first = null;
    for (let i = 0; i < count; i++) {
      const jitter = (Math.random() - 0.5) * 0.9;
      const heading = (angle || 0) + jitter;
      const velocity = (speed || 60) * (0.6 + Math.random() * 0.7);
      const duration = (life || 0.35) * (0.7 + Math.random() * 0.6);
      const particle = instance._addParticle({
        type: 'spark',
        x,
        y,
        vx: Math.cos(heading) * velocity,
        vy: Math.sin(heading) * velocity,
        life: duration,
        maxLife: duration,
        size: 1.5,
        color,
        alpha: instance._alphaScale(),
        drag: 3,
        blend: 'lighter',
      });
      if (!first) first = particle;
    }
    return first;
  };

  instance.ember = function ember(x, y, vx, vy, color, life) {
    const duration = life || 0.8;
    return instance._addParticle({
      type: 'ember',
      x,
      y,
      vx: vx || 0,
      vy: vy || 0,
      life: duration,
      maxLife: duration,
      size: 3,
      color,
      alpha: instance._alphaScale(),
      drag: 0.4,
      blend: 'lighter',
    });
  };

  instance.shard = function shard(x, y, vx, vy, color, size) {
    return instance._addParticle({
      type: 'shard',
      x,
      y,
      vx: vx || 0,
      vy: vy || 0,
      life: 0.6,
      maxLife: 0.6,
      size: size || 4,
      color,
      alpha: instance._alphaScale(),
      grav: 320,
      drag: 0.25,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 10,
      blend: 'lighter',
    });
  };

  instance.ring = function ring(x, y, color, r0, r1, durationSeconds, width) {
    const duration = durationSeconds || 0.5;
    return instance._addParticle({
      type: 'ring',
      x,
      y,
      life: duration,
      maxLife: duration,
      r0: r0 || 0,
      r1: r1 || 40,
      width: width || 3,
      color,
      alpha: instance._alphaScale(),
      blend: 'lighter',
    });
  };

  instance.arc = function arc(x, y, color, radius, startAngle, endAngle, durationSeconds, width, alpha) {
    const duration = durationSeconds || 0.4;
    return instance._addParticle({
      type: 'arc',
      x,
      y,
      life: duration,
      maxLife: duration,
      radius: radius || 20,
      a0: startAngle || 0,
      a1: endAngle !== undefined ? endAngle : Math.PI * 2,
      width: width || 3,
      color,
      alpha: (alpha !== undefined ? alpha : 1) * instance._alphaScale(),
      blend: 'lighter',
    });
  };

  instance.flash = function flash(x, y, color, radius, durationSeconds, alpha) {
    // Suppressed entirely under reduced motion: an emitter-driven flash (the
    // lightning head) otherwise strobes at its tick rate even when the user
    // asked for less motion.
    if (instance._destroyed || instance._reducedMotion) return null;
    const duration = durationSeconds || 0.3;
    return instance._addParticle({
      type: 'flash',
      x,
      y,
      life: duration,
      maxLife: duration,
      radius: radius || 30,
      color,
      alpha: (alpha !== undefined ? alpha : 1) * instance._alphaScale(),
      blend: 'lighter',
    });
  };

  instance.beam = function beam(x, y, width, height, color, durationSeconds, alpha) {
    const duration = durationSeconds || 0.9;
    return instance._addParticle({
      type: 'beam',
      x,
      y,
      size: width,
      // A beam spans a distance rather than being a sprite, so its height is
      // authored in world units and deliberately not scaled with particle size.
      height,
      life: duration,
      maxLife: duration,
      color,
      alpha: (alpha !== undefined ? alpha : 1) * instance._alphaScale(),
      blend: 'lighter',
    });
  };

  instance.smoke = function smoke(x, y, size, durationSeconds, color) {
    const duration = durationSeconds || 1.2;
    return instance._addParticle({
      type: 'smoke',
      x,
      y,
      vx: (Math.random() - 0.5) * 8,
      vy: -12 - Math.random() * 10,
      life: duration,
      maxLife: duration,
      size: size || 12,
      color: color || '#cccccc',
      alpha: instance._alphaScale() * 0.5,
      grav: -6,
      drag: 0.8,
      blend: 'source-over',
    });
  };

  instance.mote = function mote(x, y, vx, vy, color, size) {
    return instance._addParticle({
      type: 'mote',
      x,
      y,
      vx: vx || 0,
      vy: vy || 0,
      life: 1.2,
      maxLife: 1.2,
      size: size || 2,
      color,
      alpha: instance._alphaScale(),
      drag: 0.6,
      blend: 'lighter',
    });
  };

  instance.confetti = function confetti(x, y, vx, vy, color, size) {
    const count = Math.max(1, Math.round(6 * instance._countScale()));
    let first = null;
    for (let i = 0; i < count; i++) {
      const particle = instance._addParticle({
        type: 'confetti',
        x,
        y,
        vx: (vx || 0) + (Math.random() - 0.5) * 60,
        vy: (vy || 0) + (Math.random() - 0.5) * 40,
        life: 1.1,
        maxLife: 1.1,
        size: size || 5,
        color,
        alpha: instance._alphaScale(),
        grav: 140,
        drag: 0.4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
        blend: 'lighter',
      });
      if (!first) first = particle;
    }
    return first;
  };

  instance.ray = function ray(x, y, angle, length, color, alpha) {
    return instance._addParticle({
      type: 'ray',
      x,
      y,
      life: 0.22,
      maxLife: 0.22,
      rot: angle || 0,
      length: length || 80,
      width: 2.5,
      color,
      alpha: (alpha !== undefined ? alpha : 1) * instance._alphaScale(),
      blend: 'lighter',
    });
  };

  instance.streak = function streak(x, y, vx, vy, color, length, width) {
    return instance._addParticle({
      type: 'streak',
      x,
      y,
      vx: vx || 0,
      vy: vy || 0,
      life: 0.28,
      maxLife: 0.28,
      length: length || 30,
      width: width || 2,
      color,
      alpha: instance._alphaScale(),
      blend: 'lighter',
    });
  };

  instance.addWash = function addWash(color, alpha, durationSeconds) {
    if (instance._destroyed || instance._reducedMotion) return;
    const duration = durationSeconds || 0;
    if (duration <= 0) return;
    let finalAlpha = clamp01(alpha !== undefined ? alpha : 1);
    const now = instance._time;
    let recent = 0;
    for (const started of instance._washTimes) {
      if (now - started <= WASH_BUDGET_SECONDS) recent++;
    }
    if (recent >= 3) finalAlpha *= WASH_BUDGET_ALPHA;
    instance._washes.push({ color, alpha: finalAlpha, duration, time: duration });
    instance._washTimes.push(now);
    if (instance._washTimes.length > 8) instance._washTimes.splice(0, instance._washTimes.length - 8);
  };

  instance.addVignette = function addVignette(color, alphaStart, alphaEnd, durationSeconds) {
    if (instance._destroyed) return;
    const duration = durationSeconds || 0;
    if (duration <= 0) return;
    instance._vignettes.push({
      color,
      a0: clamp01(alphaStart !== undefined ? alphaStart : 0.4),
      a1: clamp01(alphaEnd !== undefined ? alphaEnd : 0),
      duration,
      time: duration,
    });
  };

  instance.shake = function shake(amplitudePixels, durationSeconds) {
    if (instance._destroyed || instance._reducedMotion) return;
    const duration = durationSeconds || 0;
    if (duration <= 0) return;
    if (!instance._shake) instance._shake = { amplitude: 0, duration: 0, time: 0 };
    instance._shake.amplitude = Math.max(instance._shake.amplitude, amplitudePixels || 0);
    instance._shake.duration = Math.max(instance._shake.duration, duration);
    instance._shake.time = Math.max(instance._shake.time, duration);
  };

  // Reset everything in flight without tearing down the layer or its canvas.
  // Used when the game state is replaced (new level, restart) so a torrent or
  // a scheduled impact from the previous encounter cannot bleed into the next.
  instance.clear = function clear() {
    if (instance._destroyed) return;
    instance._particles = [];
    instance._washes = [];
    instance._vignettes = [];
    instance._shake = null;
    instance._timers = [];
    instance._emitters = [];
  };

  instance.destroy = function destroy() {
    if (instance._destroyed) return;
    instance._destroyed = true;
    instance._detachViewport?.();
    const canvas = instance.canvas;
    if (canvas && canvas.parentNode && typeof canvas.parentNode.removeChild === 'function') {
      canvas.parentNode.removeChild(canvas);
    } else if (instance._host && canvas && typeof instance._host.removeChild === 'function') {
      instance._host.removeChild(canvas);
    }
    instance._particles = [];
    instance._washes = [];
    instance._vignettes = [];
    instance._shake = null;
    instance._washTimes = [];
    instance._dtBuffer = [];
    instance._timers = [];
    instance._emitters = [];
  };

  // Re-measure on viewport changes even while no effect is running, so the next
  // one starts from current geometry rather than the previous size.
  const view = (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const onViewportChange = () => instance._syncLayout();
  instance._detachViewport = function detachViewport() {
    view?.removeEventListener?.('resize', onViewportChange);
    view?.removeEventListener?.('orientationchange', onViewportChange);
    view?.visualViewport?.removeEventListener?.('resize', onViewportChange);
  };
  view?.addEventListener?.('resize', onViewportChange);
  view?.addEventListener?.('orientationchange', onViewportChange);
  view?.visualViewport?.addEventListener?.('resize', onViewportChange);

  instance.resize();

  return instance;
}
