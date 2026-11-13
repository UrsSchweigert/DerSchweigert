// dom-burst.js — short-lived DOM particles for HUD elements.
//
// The playfield has its own canvas engine (screen-fx.js), but the ability orbs
// and the score readout are DOM nodes in the answer zone and the header, above
// and below that canvas. This module gives those two the same kind of spark
// without a second render loop: it appends absolutely positioned shards to the
// host element, lets one CSS animation move them (direction and rotation come
// from custom properties), and removes each shard on its own `animationend`.
// No clock, no interval, no frame loop.
//
// Reduced motion keeps the feedback but drops the flight: the shards fade in
// place, so a player who asked for less movement still sees that something
// happened.

export const BURST_LAYER_CLASS = 'dom-burst';
export const BURST_SHARD_CLASS = 'dom-burst-shard';

const DEFAULT_COUNT = 12;
const MAX_COUNT = 40;
// Tones are pure data so a burst can never smuggle colours into the stylesheet:
// the CSS reads them through the custom properties below.
export const BURST_TONES = Object.freeze({
  // Ability orb: cold glass.
  glass: Object.freeze({ angle: 0, spread: 360, speed: 48, drift: 10, size: 8, spin: 260 }),
  // Score gain: warm brass, thrown upward like coins.
  score: Object.freeze({ angle: -90, spread: 150, speed: 36, drift: 6, size: 6, spin: 180 }),
});

function clampCount(value) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(0, number));
}

function randomBetween(random, min, max) {
  return min + random() * (max - min);
}

/**
 * Create a burst factory bound to one document.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {boolean} [options.reducedMotion] keep the sparks but not the flight
 * @param {() => number} [options.random] injection point for tests
 * @returns {{ burst: (host: object, tone?: keyof typeof BURST_TONES, count?: number) => number, activeCount: () => number }}
 */
export function createDomBurst({
  doc = globalThis.document,
  reducedMotion = false,
  random = Math.random,
} = {}) {
  const create = doc?.createElement?.bind(doc);
  let live = 0;

  function burst(host, tone = 'glass', count = DEFAULT_COUNT) {
    if (!create || !host?.appendChild) return 0;
    const shape = BURST_TONES[tone] ?? BURST_TONES.glass;
    const total = clampCount(count);
    if (total === 0) return 0;
    for (let i = 0; i < total; i += 1) {
      const shard = create('span');
      // Even spread plus a little jitter: a perfect circle of shards reads as a
      // printed ring, not as a shatter.
      // `angle` is the centre of the cone, so a 150° score spray stays upward
      // instead of half of it raining back down.
      const angle = shape.angle - shape.spread / 2 + (i / total) * shape.spread
        + randomBetween(random, -8, 8);
      const distance = shape.speed * randomBetween(random, 0.55, 1.25);
      const radians = (angle * Math.PI) / 180;
      const size = Math.max(2, Math.round(shape.size * randomBetween(random, 0.6, 1.15)));
      shard.className = BURST_SHARD_CLASS;
      shard.setAttribute('aria-hidden', 'true');
      if (reducedMotion) shard.dataset.reduced = 'true';
      shard.style.setProperty('--burst-x', `${(Math.cos(radians) * distance).toFixed(1)}px`);
      shard.style.setProperty('--burst-y', `${(Math.sin(radians) * distance - shape.drift).toFixed(1)}px`);
      shard.style.setProperty('--burst-rot', `${Math.round(randomBetween(random, -shape.spin, shape.spin))}deg`);
      shard.style.setProperty('--burst-size', `${size}px`);
      shard.style.setProperty('--burst-delay', `${Math.round(i * 8)}ms`);
      const forget = () => {
        live = Math.max(0, live - 1);
        shard.removeEventListener?.('animationend', forget);
        shard.remove?.();
      };
      shard.addEventListener?.('animationend', forget);
      host.appendChild(shard);
      live += 1;
    }
    return total;
  }

  return {
    burst,
    activeCount: () => live,
    /** True when this factory animates its shards instead of only fading them. */
    animates: !reducedMotion,
  };
}
