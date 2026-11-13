// diorama-player.js — plays one layered paper-theatre story scene full screen.
//
// A scene (see ../scenes/*/scene.json and ../README.md) is 3-4 PNG layers placed
// on a fixed 1920x1080 stage, each drifting along its own keyframed path so the
// layers move in relation to one another (parallax), plus a lighting rig
// (ambient tint, glows, drifting motes, timed flashes) and localized subtitle
// cues on top. The stage is scaled to cover any landscape screen, phone (up to
// ~20:9) or tablet (4:3); important artwork stays inside the central safe area
// (STAGE_SAFE) that every aspect ratio keeps visible.
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

/**
 * Hides a lighting overlay that is not contributing any pixels.
 *
 * Every blend-mode overlay spans the whole stage, so the compositor keeps a
 * full-stage surface for it whether or not it is visible: on a high-density
 * phone the flash and the dim alone are several megapixels of texture for a
 * few seconds of use. `visibility` is written only when it changes, so a fade
 * in progress keeps its per-frame opacity updates to itself.
 */
function hideIdleOverlay(node) {
  const idle = !(Number.parseFloat(node.style.opacity) > 0);
  if (idle === (node.dataset.idle === '1')) return;
  node.dataset.idle = idle ? '1' : '0';
  node.style.visibility = idle ? 'hidden' : 'visible';
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

  const root = el('div', 'diorama', container);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', pickText(scene.title, locale));
  if (reduce) root.classList.add('diorama--reduced');

  const stage = el('div', 'diorama__stage', root);
  const layerEls = scene.layers.map(layer => {
    const wrap = el('div', `diorama__layer diorama__layer--${layer.role}`, stage);
    wrap.style.zIndex = String(layer.z ?? 0);
    const img = el('img', 'diorama__img', wrap);
    img.alt = '';
    img.draggable = false;
    Object.assign(img.style, {
      left: `${layer.x}px`, top: `${layer.y}px`, width: `${layer.width}px`,
    });
    if (layer.shadow === false) img.classList.add('diorama__img--flat');
    return { layer, wrap, img };
  });

  const light = scene.lighting ?? {};
  const ambient = el('div', 'diorama__ambient', stage);
  if (light.ambient) ambient.style.background = light.ambient;
  const glowEls = (light.glows ?? []).map(glow => {
    // A glow attached to a layer rides along with that layer's motion.
    const host = layerEls.find(entry => entry.layer.id === glow.layer)?.wrap ?? stage;
    const g = el('div', 'diorama__glow', host);
    Object.assign(g.style, {
      left: `${glow.x - glow.radius}px`, top: `${glow.y - glow.radius}px`,
      width: `${glow.radius * 2}px`, height: `${glow.radius * 2}px`,
      background: `radial-gradient(circle, ${glow.color} 0%, transparent 70%)`,
      zIndex: String(glow.z ?? 50),
    });
    return { glow, g };
  });
  const motes = el('div', 'diorama__motes', stage);
  if (!reduce && light.motes) {
    for (let i = 0; i < light.motes.count; i++) {
      const m = el('span', 'diorama__mote', motes);
      // Deterministic spread so every playback looks the same.
      const seed = (i * 7919) % 997 / 997;
      const seed2 = (i * 104729) % 991 / 991;
      m.style.left = `${Math.round(seed * STAGE_W)}px`;
      m.style.top = `${Math.round(STAGE_H * (0.35 + seed2 * 0.6))}px`;
      m.style.background = light.motes.color;
      m.style.animationDelay = `${(-seed2 * 9).toFixed(2)}s`;
      m.style.animationDuration = `${(7 + seed * 6).toFixed(2)}s`;
    }
  }
  const flash = el('div', 'diorama__flash', stage);
  const dim = el('div', 'diorama__dim', stage);
  el('div', 'diorama__paper', root);
  el('div', 'diorama__vignette', root);

  const subtitle = el('p', 'diorama__subtitle', root);
  subtitle.setAttribute('aria-live', 'polite');
  const controls = el('div', 'diorama__controls', root);
  const skipBtn = el('button', 'diorama__btn diorama__btn--skip', controls);
  skipBtn.type = 'button';
  skipBtn.textContent = text.skip;

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
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;

  function render(t) {
    for (const { layer, wrap } of layerEls) {
      const m = sampleMotion(layer.motion, t);
      // Reduced motion: hold every layer in its settled final pose but keep
      // timed fades, so characters still appear when the subtitles need them.
      const pose = reduce ? sampleMotion(layer.motion, duration) : m;
      wrap.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.rotate}deg) scale(${pose.scale})`;
      wrap.style.opacity = String(m.opacity);
    }
    for (const { glow, g } of glowEls) {
      const active = t >= (glow.from ?? 0) && t < (glow.to ?? Infinity);
      const pulse = reduce || !glow.pulse ? 1 : 0.75 + 0.25 * Math.sin(t * Math.PI * 2 / glow.pulse);
      g.style.opacity = active ? String((glow.intensity ?? 1) * pulse) : '0';
    }
    flash.style.opacity = '0';
    dim.style.opacity = '0';
    for (const ev of light.events ?? []) {
      if (t < ev.at || t >= ev.at + ev.duration) continue;
      const p = (t - ev.at) / ev.duration;
      // 'flash' rises and falls (screen); 'dim' fades in, holds, fades out (multiply).
      const strength = ev.type === 'flash'
        ? Math.sin(p * Math.PI)
        : Math.min(1, p / 0.2, (1 - p) / 0.2);
      const target = ev.type === 'flash' ? flash : dim;
      target.style.background = ev.color;
      target.style.opacity = String((ev.intensity ?? (ev.type === 'flash' ? 1 : 0.6)) * strength);
    }
    // A transparent full-stage blend layer still costs a compositor surface,
    // and these two are idle for all but a few seconds of a scene. Hide them
    // outright unless an event is playing (see hideIdleOverlay).
    hideIdleOverlay(flash);
    hideIdleOverlay(dim);
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
        Promise.all(layerEls.map(async ({ layer, img }) => {
          const loaded = await loadImage(new URL(layer.src, base).href);
          img.src = loaded.src;
        })),
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
