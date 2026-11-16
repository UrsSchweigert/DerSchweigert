// strike-fx.js — the swing's visual effect per weapon family, drawn with canvas
// primitives only. Every effect is a pure function of the swing clip's progress
// `t`, so nothing is stored, scheduled or random: the same `t` draws the same
// calls. The bow's arrow is part of this drawing and nothing else - it is not an
// entity and the hit never waits for it.

export const FX_FADE = 0.55;          // progress span a strike effect fades over
export const BOW_REACH = 110;         // arrow flight, inside the sword arc's 146px reach

// Fixed per-index particle tables (angle in radians, distance in px).
const BURST_PARTICLES = Array.from({ length: 8 }, (_, i) => ({
  a: (i / 8) * Math.PI * 2 + 0.2,
  r: 18 + (i % 3) * 9,
}));
const TRAIL_PARTICLES = [[-14, 3], [-24, -4], [-34, 5], [-44, -2], [-54, 4]];

/** Where the arrow is at progress t, from the anchor to the landing point. */
export function arrowX(cx, t, hitStart) {
  const k = hitStart > 0 ? Math.min(1, Math.max(0, t / hitStart)) : 1;
  return cx + BOW_REACH * k;
}

function burst(ctx, glow, x, y, t, hitStart, fade, core, mid, line) {
  const flash = Math.max(0, 1 - (t - hitStart) / 0.3);
  glow(ctx, x, y, 56 * (0.7 + 0.5 * flash), 0.8 * flash, core, mid);
  ctx.globalAlpha = fade;
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  const spread = 1 + (1 - fade) * 0.8;
  for (const p of BURST_PARTICLES) {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(p.a) * p.r * 0.5 * spread, y + Math.sin(p.a) * p.r * 0.5 * spread);
    ctx.lineTo(x + Math.cos(p.a) * p.r * spread, y + Math.sin(p.a) * p.r * spread);
    ctx.stroke();
  }
}

function sword(ctx, glow, cx, cy, t, hitStart, fade) {
  // The arc is centred on the hands and sweeps along the path the blade
  // travelled, from up-right to down-right, so it reads as a trail rather
  // than a decoration floating next to the hero.
  // Fatter than the blade it trails: an ellipse wide in x and shorter in y,
  // stroked in four layers (soft outer haze, body, bright edge, white core)
  // so the slash has structure instead of being one uniform line.
  const radiusX = 146, radiusY = 98;
  const a0 = -1.35, a1 = 0.92, a1x = a1;
  const layers = [
    [26, '#1b4f8c', 0.26],
    [16, '#2f8fd8', 0.42],
    [9, '#7fd4ff', 0.68],
    [3.5, '#ffffff', 0.95],
  ];
  for (const [width, colour, alpha] of layers) {
    ctx.globalAlpha = fade * alpha;
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusX, radiusY, -0.38, a0, a1x);
    ctx.stroke();
  }
  // Structured glow: the leading edge of the sweep burns brighter, and the
  // tail feathers out, so the eye reads direction of travel.
  for (let i = 0; i < 5; i++) {
    const from = a0 + (a1x - a0) * (i / 5);
    const to = a0 + (a1x - a0) * ((i + 1) / 5) + 0.03;
    ctx.globalAlpha = fade * (0.1 + 0.22 * i);
    ctx.lineWidth = 18 + i * 4;
    ctx.strokeStyle = i >= 3 ? '#bfeaff' : '#3d8fd0';
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusX, radiusY, -0.38, from, to);
    ctx.stroke();
  }

  // A single burst at the impact, same light as the cast: the swing is the
  // moment the hit lands, so it gets one flash rather than a steady glow.
  const flash = Math.max(0, 1 - (t - hitStart) / 0.3);
  glow(ctx, cx + Math.cos(a1x) * radiusX, cy + Math.sin(a1x) * radiusY,
    64 * (0.7 + 0.5 * flash), 0.8 * flash, '#ffffff', '#8fd8ff');

  // Sparks fly off the blade end, where the arc is brightest.
  ctx.globalAlpha = fade;
  ctx.strokeStyle = '#cfeeff';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = a1x - 0.18 + i * 0.14;
    const r0 = 1.0, r1 = 1.0 + (0.1 + (i % 2) * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * radiusX * r0, cy + Math.sin(a) * radiusY * r0);
    ctx.lineTo(cx + Math.cos(a) * radiusX * r1, cy + Math.sin(a) * radiusY * r1);
    ctx.stroke();
  }
}

function buckler(ctx, glow, cx, cy, t, hitStart, fade) {
  const x = cx + 30, size = 26 + (1 - fade) * 18;
  ctx.globalAlpha = fade * 0.9;
  ctx.strokeStyle = '#ffd98a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, cy, size, -1.1, 1.1);
  ctx.stroke();
  burst(ctx, glow, x + 10, cy, t, hitStart, fade, '#ffffff', '#ffc65a', '#fff0c8');
}

function staff(ctx, glow, cx, cy, t, hitStart, fade) {
  glow(ctx, cx + 40, cy, 70 * (0.8 + 0.4 * fade), 0.85 * fade, '#f2e6ff', '#a56bff');
  ctx.globalAlpha = fade * 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx + 40, cy, 9 * fade + 3, 0, Math.PI * 2);
  ctx.fill();
  burst(ctx, glow, cx + 40, cy, t, hitStart, fade, '#ffffff', '#c9a0ff', '#e6d2ff');
}

function fist(ctx, glow, cx, cy, t, hitStart, fade) {
  const x = cx + 36;
  ctx.globalAlpha = fade;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    const r = 14 + i * 12 + (1 - fade) * 20;
    ctx.beginPath();
    ctx.arc(x, cy, r, -0.9, 0.9);
    ctx.stroke();
  }
  burst(ctx, glow, x, cy, t, hitStart, fade, '#ffffff', '#ff9a5a', '#ffd9b8');
}

function bow(ctx, glow, cx, cy, t, hitStart, fade) {
  const x = arrowX(cx, t, hitStart);
  if (t < hitStart) {
    // In flight: a short shaft with a particle trail behind it.
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = '#f3e3b8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 16, cy);
    ctx.lineTo(x, cy);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, cy - 4);
    ctx.lineTo(x + 7, cy);
    ctx.lineTo(x, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#cfeeff';
    TRAIL_PARTICLES.forEach(([dx, dy], i) => {
      ctx.globalAlpha = 0.6 - i * 0.1;
      ctx.beginPath();
      ctx.arc(x + dx, cy + dy, 2.5 - i * 0.3, 0, Math.PI * 2);
      ctx.fill();
    });
    return;
  }
  burst(ctx, glow, x, cy, t, hitStart, fade, '#ffffff', '#9fe28a', '#e6ffd8');
}

const FAMILIES = { sword, buckler, staff, fist, bow };

/**
 * Draw the strike effect at the anchor (cx, cy). `t` is the swing clip's
 * progress, `hitStart` the progress at which the "hit" frame starts and `glow`
 * the shared additive glow. Unknown families draw as sword.
 */
export function drawStrikeFx(ctx, family, { cx, cy, t, hitStart, glow }) {
  const draw = FAMILIES[family] ?? sword;
  // Only the bow flies before the hit; everything else waits for its frame.
  if (draw !== bow && t < hitStart - 0.06) return;
  const fade = Math.max(0, 1 - (t - hitStart) / FX_FADE);
  if (fade <= 0) return;
  // The FX sets alpha, line width and stroke colours; it owns its own state.
  ctx.save();
  draw(ctx, glow, cx, cy, t, hitStart, fade);
  ctx.restore();
}
