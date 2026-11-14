// diorama-player.js — plays one layered paper-theatre story scene full screen.
//
// A scene (see ../scenes/*/scene.json and ../README.md) is 3-4 WebP layers
// placed on a fixed 1920x1080 stage, each drifting along its own keyframed path
// so the layers move in relation to one another (parallax), plus a lighting rig
// (ambient tint, glows, drifting motes, timed flashes) and localized subtitle
// cues on top. The stage is scaled to cover any landscape screen, phone (up to
// ~20:9) or tablet (4:3); important artwork stays inside the central safe area
// (STAGE_SAFE) that every aspect ratio keeps visible.
//
// The scene is painted into ONE canvas, not built as a stack of DOM layers.
// A DOM version needs a composited surface per layer (five full-stage layers,
// each with a drop-shadow, plus six blend-mode overlays). On a 1440p phone the
// compositor then holds ~100 MP of RGBA — hundreds of megabytes — and Android
// WebView starts dropping raster tiles, which shows up as black rectangles over
// the artwork. The canvas costs one texture the size of the screen and paints
// the same pixels: layers, shadows, the lighting rig and the paper sheet all
// go through the 2D context, whose blend modes match the CSS ones.
//
// The player has no dependency on the game, so it can be shown between levels,
// before the first level, or after the last one:
//
//   const player = createDioramaPlayer({ container, scene, baseUrl, locale });
//   await player.play();   // resolves with 'ended' or 'skipped'
//   player.destroy();

export const STAGE_W = 1920;
export const STAGE_H = 1080;
// Visible on every aspect ratio from 4:3 (crops the sides) to 20:9 (crops the
// top and bottom) when the stage is scaled to cover the screen.
export const STAGE_SAFE = { x: 240, y: 108, w: 1440, h: 864 };

const DEFAULT_LABELS = {
  en: { skip: 'Skip' },
  de: { skip: 'Überspringen' },
};

export function pickText(text, locale) {
  if (typeof text === 'string') return text;
  return text?.[locale] ?? text?.en ?? '';
}

/** Subtitle cue active at time t (seconds), or null. */
export function cueAt(subtitles, t) {
  return subtitles.find(cue => t >= cue.start && t < cue.end) ?? null;
}

const NARRATION_LOCALES = new Set(['de', 'en']);

/** Locale folder the voice-over lives in; an unknown locale reads English. */
export function narrationLocale(locale) {
  return NARRATION_LOCALES.has(locale) ? locale : 'en';
}

/**
 * Subtitle cues with the recorded voice-over folded in.
 *
 * A scene may ship narration/<locale>/timing.json (see ../README.md), which
 * names the cue each recorded line belongs to plus its real start and length.
 * Such a cue appears when its line is actually heard and stays up until the
 * line ends, so a slow take never leaves the text behind. Cues the voice-over
 * does not speak (act title cards) keep their authored timing, and no cue runs
 * into the next one.
 *
 * @param {Array<{start: number, end: number, text: object|string}>} subtitles
 * @param {{lines?: Array<{cue?: number, start?: number, duration?: number}>}|null} timing
 * @returns {Array<{start: number, end: number, text: object|string}>}
 */
export function voicedCues(subtitles, timing) {
  const lines = (timing?.lines ?? []).filter(
    line => Number.isFinite(line?.start) && Number.isInteger(line?.cue) && subtitles[line.cue],
  );
  if (!lines.length) return subtitles;
  const byCue = new Map(lines.map(line => [line.cue, line]));
  const ordered = [...byCue.values()].sort((a, b) => a.start - b.start);
  const nextStart = new Map(ordered.map((line, i) => [line.cue, ordered[i + 1]?.start ?? Infinity]));

  return subtitles.map((cue, index) => {
    const line = byCue.get(index);
    if (!line) return cue;
    // Never bleed into the following text: the next recorded line, or an
    // unvoiced cue such as an act title card that keeps its authored time.
    const next = subtitles[index + 1];
    const nextCueStart = next ? (byCue.get(index + 1)?.start ?? next.start) : Infinity;
    const limit = Math.min(nextStart.get(index) ?? Infinity, nextCueStart);
    const voicedEnd = line.start + (Number(line.duration) || 0);
    const end = Math.min(limit, Math.max(cue.end, voicedEnd));
    return end > line.start ? { ...cue, start: line.start, end } : cue;
  });
}

/** The scene's voice-over timing, or null when the scene has none. */
async function loadNarrationTiming(base, locale) {
  try {
    const response = await fetch(new URL(`narration/${locale}/timing.json`, base));
    if (!response.ok) return null;
    const timing = await response.json();
    return timing?.lines?.length ? timing : null;
  } catch {
    // Narration is optional: a missing or broken manifest just means no voice.
    return null;
  }
}

/**
 * The scene's voice-over track, started but not awaited: the scene clock never
 * waits on the network. Playback catches up to the scene as soon as the track
 * is audible (see the 'playing' listener in play()).
 */
function loadNarrationAudio(base, locale, timing) {
  const url = new URL(`narration/${locale}/${timing.audio ?? 'narration.mp3'}`, base);
  const audio = new Audio(url.href);
  audio.preload = 'auto';
  audio.volume = 1;
  audio.load();
  return audio;
}

/** Linear interpolation of a layer's motion keyframes at time t (seconds). */
export function sampleMotion(keyframes, t) {
  if (!keyframes?.length) return { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
  const full = keyframes.map(k => ({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, ...k }));
  if (t <= full[0].t) return full[0];
  for (let i = 1; i < full.length; i++) {
    const a = full[i - 1];
    const b = full[i];
    if (t <= b.t) {
      const raw = (t - a.t) / (b.t - a.t || 1);
      const p = raw * raw * (3 - 2 * raw); // smoothstep: gentle, theatre-rig motion
      const mix = key => a[key] + (b[key] - a[key]) * p;
      return { t, x: mix('x'), y: mix('y'), scale: mix('scale'), rotate: mix('rotate'), opacity: mix('opacity') };
    }
  }
  return full[full.length - 1];
}

/**
 * The landscape box the stage is always laid out in.
 *
 * A story scene is a 16:9 paper theatre, so a portrait screen is turned
 * instead of letterboxed: the box is the screen with width and height swapped
 * and the whole player is rotated to match, which is why the scene fills a
 * portrait screen exactly as it fills a landscape one. The player never has to
 * ask the shell for an orientation lock, and turning the device to landscape
 * mid-scene simply drops back to an unrotated box.
 * @param {number} viewW viewport width
 * @param {number} viewH viewport height
 * @returns {{turned: boolean, width: number, height: number}}
 */
export function landscapeBox(viewW, viewH) {
  const width = Number(viewW) || 0;
  const height = Number(viewH) || 0;
  const turned = height > width;
  return { turned, width: turned ? height : width, height: turned ? width : height };
}

/** Scale and offset that make the stage cover its landscape box, keeping the
 * normalised safe area visible. */
export function stageTransform(viewW, viewH) {
  const scale = Math.max(viewW / STAGE_W, viewH / STAGE_H);
  return {
    scale,
    x: (viewW - STAGE_W * scale) / 2,
    y: (viewH - STAGE_H * scale) / 2,
  };
}

/** A landscape box shorter than this gets the slimmer subtitle strip. */
export const COMPACT_BOX_HEIGHT = 500;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
    img.onerror = () => reject(new Error(`Story layer failed to load: ${src}`));
    img.src = src;
  });
}

const SHADOW_COLOR = 'rgba(20, 10, 0, 0.45)';
const SHADOW_BLUR = 12;
const SHADOW_OFFSET_Y = 14;

const NAMED_COLORS = new Map([
  ['transparent', { r: 0, g: 0, b: 0, a: 0 }],
  ['black', { r: 0, g: 0, b: 0, a: 1 }],
  ['white', { r: 255, g: 255, b: 255, a: 1 }],
]);

/** A CSS colour as {r,g,b,a} (0-255, 0-1), or null when it cannot be read. */
export function parseCssColor(value) {
  const source = String(value ?? '').trim().toLowerCase();
  const named = NAMED_COLORS.get(source);
  if (named) return named;
  const hex = source.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const channels = digits.length <= 4
      ? digits.split('').map(digit => Number.parseInt(digit + digit, 16))
      : [0, 2, 4, 6].slice(0, digits.length / 2).map(at => Number.parseInt(digits.slice(at, at + 2), 16));
    return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] === undefined ? 1 : channels[3] / 255 };
  }
  const fn = source.match(/^rgba?\(([^)]+)\)$/);
  if (!fn) return null;
  const parts = fn[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(channel => !Number.isFinite(channel))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
}

const cssColor = color => `rgba(${color.r},${color.g},${color.b},${color.a})`;

/** Colour stops of a CSS gradient string, in order, positions in 0-1. */
export function gradientStops(gradient) {
  const stops = [];
  const pattern = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent|black|white)\s*([\d.]+)?%/gi;
  let match;
  while ((match = pattern.exec(String(gradient ?? '')))) {
    const color = parseCssColor(match[1]);
    if (!color) continue;
    const at = match[2] === undefined ? stops.length ? 1 : 0 : Number(match[2]) / 100;
    stops.push({ color, at: Math.min(1, Math.max(0, at)) });
  }
  return stops;
}

/** Where a CSS gradient starts: the `at x% y%` of a radial gradient, or the
 * top-centre of the 180deg linear gradients the scenes use. */
function gradientOrigin(gradient, width, height) {
  const radial = /radial-gradient\(\s*(circle|ellipse)?[^)]*?(?:at\s+([\d.]+)%\s+([\d.]+)%)?/i.exec(String(gradient ?? ''));
  return {
    ellipse: !/circle/i.test(radial?.[1] ?? ''),
    x: width * (Number(radial?.[2] ?? 50) / 100),
    y: height * (Number(radial?.[3] ?? 50) / 100),
  };
}

/**
 * Radii of the `farthest-corner` ellipse CSS sizes a radial gradient to: the
 * shape keeps the box's aspect ratio and touches the corner furthest from the
 * centre, which is what the browser paints.
 */
function farthestCorner(width, height, x, y) {
  const dx = Math.max(x, width - x);
  const dy = Math.max(y, height - y);
  const ratio = width / height;
  const rx = Math.sqrt(dx * dx + (dy * ratio) ** 2) || 1;
  return { rx, ry: rx / ratio };
}

/** A 180deg (top to bottom) linear gradient for a CSS gradient string. */
function linearPaint(ctx, gradient, width, height) {
  const paint = ctx.createLinearGradient(0, 0, 0, height);
  for (const { color, at } of gradientStops(gradient)) paint.addColorStop(at, cssColor(color));
  return paint;
}

/**
 * A radial gradient for a CSS gradient string. Ellipses are painted by scaling
 * a unit circle, so the colour stops stay at their authored percentages.
 */
function radialPaint(ctx, gradient, width, height, origin = gradientOrigin(gradient, width, height)) {
  if (!origin.ellipse) {
    const radius = Math.max(origin.x, width - origin.x, origin.y, height - origin.y) || 1;
    const paint = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, radius);
    for (const { color, at } of gradientStops(gradient)) paint.addColorStop(at, cssColor(color));
    return { paint, matrix: null };
  }
  const { rx, ry } = farthestCorner(width, height, origin.x, origin.y);
  const paint = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const { color, at } of gradientStops(gradient)) paint.addColorStop(at, cssColor(color));
  return { paint, matrix: [rx, 0, 0, ry, origin.x, origin.y] };
}

/** Fills a rectangle with a CSS gradient, in the current transform. */
function fillGradient(ctx, gradient, width, height) {
  if (!gradientStops(gradient).length) return;
  const { paint, matrix } = radialPaint(ctx, gradient, width, height);
  ctx.save();
  if (matrix) ctx.transform(...matrix);
  ctx.fillStyle = paint;
  ctx.fillRect(matrix ? -1 : 0, matrix ? -1 : 0, matrix ? 2 : width, matrix ? 2 : height);
  ctx.restore();
}

/**
 * @param {object} options
 * @param {HTMLElement} options.container element the full-screen player is appended to
 * @param {object} options.scene parsed scene.json
 * @param {string|URL} options.baseUrl URL of the scene folder (layer src are relative to it)
 * @param {'en'|'de'} [options.locale]
 * @param {boolean} [options.reducedMotion] defaults to the prefers-reduced-motion media query
 * @param {boolean} [options.narration] play the scene's recorded voice-over (default true)
 * @param {boolean} [options.muted] start without sound; the scene still runs
 * @param {object} [options.labels] { skip } skip-button label
 */
export function createDioramaPlayer({
  container, scene, baseUrl, locale = 'en', reducedMotion, narration = true, muted = false, labels,
}) {
  const reduce = reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const text = { ...(DEFAULT_LABELS[locale] ?? DEFAULT_LABELS.en), ...labels };
  const duration = scene.duration;
  const light = scene.lighting ?? {};

  const root = el('div', 'diorama', container);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', pickText(scene.title, locale));
  if (reduce) root.classList.add('diorama--reduced');

  // One canvas paints the whole theatre — layers, their contact shadows, the
  // lighting rig and the paper. See the module comment.
  const canvas = el('canvas', 'diorama__canvas', root);
  const ctx = canvas.getContext('2d');

  const subtitle = el('p', 'diorama__subtitle', root);
  subtitle.setAttribute('aria-live', 'polite');
  const controls = el('div', 'diorama__controls', root);
  const skipBtn = el('button', 'diorama__btn diorama__btn--skip', controls);
  skipBtn.type = 'button';
  skipBtn.textContent = text.skip;

  const images = scene.layers.map(() => null);
  let grain = null;
  let paper = null;
  let paperSize = '';
  // Backing-store geometry, recomputed on every resize.
  const view = { turned: false, width: 0, height: 0, scale: 1, x: 0, y: 0, pixelRatio: 1 };

  let raf = 0;
  let startTs = 0;
  let elapsed = 0;
  let shownCue = null;
  let resolvePlay = null;
  let finished = false;
  // Cue list and clock source: the voice-over, when the scene ships one, is
  // both the timeline and the truth for when each line is on screen.
  let cues = scene.subtitles;
  let narrationAudio = null;
  let audioClocked = false;

  /** Total device pixels the canvas may allocate. Keeping this bounded keeps
   * a scene cheap on tablets with huge, high-density screens. */
  const MAX_CANVAS_PIXELS = 6e6;

  const paintPaper = () => {
    if (!grain || !view.width) return;
    const width = Math.max(1, Math.round(view.width * view.pixelRatio));
    const height = Math.max(1, Math.round(view.height * view.pixelRatio));
    const key = `${width}x${height}`;
    if (paper && paperSize === key) return;
    paper ??= document.createElement('canvas');
    paper.width = width;
    paper.height = height;
    paperSize = key;
    const paint = paper.getContext('2d');
    paint.setTransform(1, 0, 0, 1, 0, 0);
    const pattern = paint.createPattern(grain, 'repeat');
    paint.fillStyle = pattern;
    paint.fillRect(0, 0, width, height);
    paint.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
    fillGradient(paint, 'radial-gradient(ellipse at 20% 15%, rgba(255,236,200,0) 0%, rgba(140,95,40,0.25) 100%)',
      view.width, view.height);
  };

  // The scene is always landscape: a portrait screen gets the box rotated 90°
  // (see landscapeBox) so the paper theatre fills it edge to edge. The root is
  // position:fixed, so the document element is the viewport it is painted in —
  // and unlike the root's own box it does not change when the turn is applied.
  const fit = () => {
    const doc = root.ownerDocument?.documentElement;
    const box = landscapeBox(
      doc?.clientWidth || window.innerWidth || root.clientWidth,
      doc?.clientHeight || window.innerHeight || root.clientHeight,
    );
    root.classList.toggle('is-turned', box.turned);
    root.classList.toggle('is-compact', box.height < COMPACT_BOX_HEIGHT);
    if (box.turned) {
      // The rotated box is centred on the screen, so its own width/height are
      // the screen's height/width.
      root.style.setProperty('--diorama-box-width', `${box.width}px`);
      root.style.setProperty('--diorama-box-height', `${box.height}px`);
    } else {
      root.style.removeProperty('--diorama-box-width');
      root.style.removeProperty('--diorama-box-height');
    }
    const { scale, x, y } = stageTransform(box.width, box.height);
    view.turned = box.turned;
    view.width = box.width;
    view.height = box.height;
    view.scale = scale;
    view.x = x;
    view.y = y;

    // Paint at device resolution, no higher: the artwork is upscaled anyway,
    // and this is what keeps the whole scene inside one canvas texture.
    let pixelRatio = Number(window.devicePixelRatio) || 1;
    let width = Math.round(box.width * pixelRatio);
    let height = Math.round(box.height * pixelRatio);
    if (width * height > MAX_CANVAS_PIXELS) {
      const shrink = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
      pixelRatio *= shrink;
      width = Math.round(box.width * pixelRatio);
      height = Math.round(box.height * pixelRatio);
    }
    view.pixelRatio = pixelRatio;
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;
    paintPaper();
    if (images.some(Boolean)) render(elapsed);
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;

  /** Layer motion about the stage's 50% / 60% origin (see .diorama__layer). */
  const applyMotion = (pose) => {
    const ox = STAGE_W * 0.5;
    const oy = STAGE_H * 0.6;
    ctx.translate(ox + pose.x, oy + pose.y);
    ctx.rotate((pose.rotate * Math.PI) / 180);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-ox, -oy);
  };

  const drawLayers = (t) => {
    scene.layers.forEach((layer, index) => {
      const image = images[index];
      if (!image) return;
      const motion = sampleMotion(layer.motion, t);
      // Reduced motion: hold every layer in its settled final pose but keep
      // timed fades, so characters still appear when the subtitles need them.
      const pose = reduce ? sampleMotion(layer.motion, duration) : motion;
      if (motion.opacity <= 0) return;
      ctx.save();
      ctx.globalAlpha = motion.opacity;
      applyMotion(pose);
      // Cardboard cutouts stand slightly apart: a soft contact shadow sells
      // depth. The backdrop is opaque and covers the stage at every keyframe,
      // so its shadow would only fall on the black stage behind it.
      if (layer.shadow !== false && layer.role !== 'backdrop') {
        ctx.shadowColor = SHADOW_COLOR;
        ctx.shadowBlur = SHADOW_BLUR;
        ctx.shadowOffsetY = SHADOW_OFFSET_Y;
      }
      const height = (layer.width * image.naturalHeight) / image.naturalWidth;
      ctx.drawImage(image, layer.x, layer.y, layer.width, height);
      ctx.restore();
    });
  };

  const drawGlows = (t) => {
    for (const glow of light.glows ?? []) {
      const active = t >= (glow.from ?? 0) && t < (glow.to ?? Infinity);
      if (!active) continue;
      const pulse = reduce || !glow.pulse ? 1 : 0.75 + 0.25 * Math.sin((t * Math.PI * 2) / glow.pulse);
      const color = parseCssColor(glow.color);
      if (!color) continue;
      const host = glow.layer ? scene.layers.find(layer => layer.id === glow.layer) : null;
      // A glow attached to a layer rides along with that layer's motion, and
      // fades with it (it is a child of the layer in the DOM version too).
      const layerOpacity = host
        ? sampleMotion(host.motion, t).opacity
        : 1;
      if (layerOpacity <= 0) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = layerOpacity * (glow.intensity ?? 1) * pulse;
      if (host) applyMotion(reduce ? sampleMotion(host.motion, duration) : sampleMotion(host.motion, t));
      const paint = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.radius);
      paint.addColorStop(0, cssColor(color));
      paint.addColorStop(0.7, `rgba(${color.r},${color.g},${color.b},0)`);
      ctx.fillStyle = paint;
      ctx.beginPath();
      ctx.arc(glow.x, glow.y, glow.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  const drawMotes = (t) => {
    const motes = light.motes;
    if (reduce || !motes?.count) return;
    const color = parseCssColor(motes.color) ?? { r: 255, g: 255, b: 255, a: 1 };
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = cssColor(color);
    for (let i = 0; i < motes.count; i++) {
      // Deterministic spread, so every playback looks the same.
      const seed = ((i * 7919) % 997) / 997;
      const seed2 = ((i * 104729) % 991) / 991;
      const lifetime = 7 + seed * 6;
      const phase = ((((t - seed2 * 9) % lifetime) + lifetime) % lifetime) / lifetime;
      const opacity = phase < 0.15
        ? (phase / 0.15) * 0.9
        : phase < 0.8 ? 0.9 - ((phase - 0.15) / 0.65) * 0.2 : ((1 - phase) / 0.2) * 0.7;
      if (opacity <= 0) continue;
      const x = Math.round(seed * STAGE_W) + 60 * phase;
      const y = Math.round(STAGE_H * (0.35 + seed2 * 0.6)) - 260 * phase;
      ctx.globalAlpha = Math.min(1, opacity);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const drawEvents = (t) => {
    for (const event of light.events ?? []) {
      if (t < event.at || t >= event.at + event.duration) continue;
      const progress = (t - event.at) / event.duration;
      // 'flash' rises and falls (screen); 'dim' fades in, holds, fades out.
      const strength = event.type === 'flash'
        ? Math.sin(progress * Math.PI)
        : Math.min(1, progress / 0.2, (1 - progress) / 0.2);
      const color = parseCssColor(event.color);
      if (!color || strength <= 0) continue;
      ctx.save();
      ctx.globalCompositeOperation = event.type === 'flash' ? 'screen' : 'multiply';
      ctx.globalAlpha = (event.intensity ?? (event.type === 'flash' ? 1 : 0.6)) * strength;
      ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      ctx.restore();
    }
  };

  function render(t) {
    if (!view.width) return;
    const ratio = view.pixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Stage space: everything the scene is authored in.
    ctx.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.x, ratio * view.y);
    drawLayers(t);
    if (light.ambient) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      fillGradient(ctx, light.ambient, STAGE_W, STAGE_H);
      ctx.restore();
    }
    drawGlows(t);
    drawMotes(t);
    drawEvents(t);

    // Box space: the sheet and the vignette cover the whole screen, not the
    // stage, exactly like they did as absolutely positioned elements.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (paper) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(paper, 0, 0, view.width, view.height);
      ctx.restore();
    }
    ctx.save();
    fillGradient(ctx, 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(18,10,2,0.75) 100%)',
      view.width, view.height);
    ctx.restore();

    const cue = cueAt(cues, t);
    if (cue !== shownCue) {
      shownCue = cue;
      subtitle.classList.remove('is-visible');
      if (cue) {
        subtitle.textContent = pickText(cue.text, locale);
        // Next frame, so the fade-in restarts for every cue.
        requestAnimationFrame(() => subtitle.classList.add('is-visible'));
      }
    }
  }

  /** True while the voice-over itself can drive the clock. */
  function audioDrives() {
    return Boolean(narrationAudio)
      && !narrationAudio.paused && !narrationAudio.ended && narrationAudio.readyState >= 2;
  }

  function tick(ts) {
    if (audioDrives()) {
      audioClocked = true;
      elapsed = Math.min(duration, narrationAudio.currentTime);
    } else {
      // Hand the clock back to requestAnimationFrame the moment the voice-over
      // ends or stalls, so the scene still reaches its last frame.
      if (audioClocked) {
        audioClocked = false;
        startTs = ts - elapsed * 1000;
      }
      if (!startTs) startTs = ts - elapsed * 1000;
      elapsed = Math.min(duration, (ts - startTs) / 1000);
    }
    render(elapsed);
    if (elapsed >= duration) {
      // The scene ends by itself so the title screen follows without a click.
      finish('ended');
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function stopNarration() {
    if (!narrationAudio) return;
    narrationAudio.pause();
    narrationAudio.removeAttribute('src');
    narrationAudio.load();
    narrationAudio = null;
  }

  function finish(reason) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    raf = 0;
    stopNarration();
    resolvePlay?.(reason);
  }

  skipBtn.addEventListener('click', () => finish('skipped'));
  const previousFocus = document.activeElement;
  const onKey = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('skipped');
    } else if (event.key === 'Tab') {
      // Modal: keep focus on the scene's own button.
      event.preventDefault();
      skipBtn.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  return {
    element: root,
    /** Loads every layer (and the voice-over), then plays; resolves with 'ended' or 'skipped'. */
    async play() {
      const base = new URL(baseUrl, document.baseURI);
      const voice = narrationLocale(locale);
      const [timing] = await Promise.all([
        narration ? loadNarrationTiming(base, voice) : null,
        Promise.all([
          ...scene.layers.map(async (layer, index) => {
            images[index] = await loadImage(new URL(layer.src, base).href);
          }),
          // The grain sheet lives beside this module, not in the scene folder.
          loadImage(new URL('./paper-grain.webp', import.meta.url).href).then(
            (image) => { grain = image; },
            () => { grain = null; },
          ),
        ]),
      ]);
      if (timing) cues = voicedCues(scene.subtitles, timing);
      if (timing && !muted && !finished) {
        narrationAudio = loadNarrationAudio(base, voice, timing);
        // If the track only becomes audible after the scene started, slip it
        // forward to the scene clock instead of rewinding the picture to it.
        narrationAudio.addEventListener('playing', () => {
          const { currentTime, duration: audioDuration } = narrationAudio ?? {};
          if (elapsed > 0.2 && Math.abs(currentTime - elapsed) > 0.2) {
            try {
              narrationAudio.currentTime = Math.min(elapsed, audioDuration || elapsed);
            } catch {
              // A track that cannot seek simply plays from where it is.
            }
          }
        });
      }
      fit();
      resizeObserver?.observe(root);
      window.addEventListener('resize', fit);
      root.classList.add('is-playing');
      skipBtn.focus();
      return new Promise(resolve => {
        resolvePlay = resolve;
        if (finished) {
          resolve('skipped');
          return;
        }
        if (narrationAudio) {
          // A blocked autoplay only costs the voice; the scene runs on the
          // requestAnimationFrame clock either way.
          narrationAudio.play().catch(() => {});
        }
        raf = requestAnimationFrame(tick);
      });
    },
    /** Jump to a time (seconds); used by the preview scrubber and tests. */
    seek(t) {
      elapsed = Math.max(0, Math.min(duration, t));
      startTs = 0;
      if (narrationAudio && Number.isFinite(narrationAudio.duration)) {
        try {
          narrationAudio.currentTime = Math.min(elapsed, narrationAudio.duration);
        } catch {
          // Seeking a stream that is not ready yet is not worth failing over.
        }
      }
      render(elapsed);
    },
    /** Freeze on the current frame (preview stills, app backgrounding). */
    pause() {
      cancelAnimationFrame(raf);
      raf = 0;
      narrationAudio?.pause();
    },
    resume() {
      if (finished || raf || elapsed >= duration) return;
      startTs = 0;
      narrationAudio?.play().catch(() => {});
      raf = requestAnimationFrame(tick);
    },
    skip() { finish('skipped'); },
    destroy() {
      finish('skipped');
      resizeObserver?.disconnect();
      window.removeEventListener('resize', fit);
      document.removeEventListener('keydown', onKey);
      root.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    },
  };
}
