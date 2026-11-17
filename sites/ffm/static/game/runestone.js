// runestone.js - the one small runestone every counting visual uses: the Shapes
// mode (canvas bubble and header rows) and the counted additions on the first
// levels (see levels.js, `visual`).
//
// The art is a 29 x 48 PNG rendered with fal.ai (fal-ai/flux-1/schnell, seed
// 709913294, prompt: "a single small runestone, upright grey carved stone with
// one glowing blue rune on its face, 16-bit pixel art game icon ... on a plain
// solid pure white background"), then keyed to transparency, cropped and scaled
// down. It is embedded as a constant so the DOM needs no image request and the
// canvas and the header always show the same stone.

export const RUNESTONE_WIDTH = 29;
export const RUNESTONE_HEIGHT = 48;

const RUNESTONE_PNG_BASE64 =
  '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' +
  'z77I/wEvO8kaSptyuQAAAABJRU5ErkJggg==';

/** `src` for an <img> showing the stone (show it with image-rendering: pixelated). */
export function runestoneDataUri() {
  return `data:image/png;base64,${RUNESTONE_PNG_BASE64}`;
}

let canvasImage = null;
/**
 * Draws the stone onto a 2D canvas context, centred on (cx, cy), `height` px
 * tall. Queued bubbles pass `active: false` and draw it a little dimmer.
 * Returns false (drawing nothing) until the image has decoded or where the
 * environment has no Image constructor.
 */
export function drawRunestone(ctx, cx, cy, height, { active = true } = {}) {
  if (!canvasImage && typeof globalThis.Image === 'function') {
    canvasImage = new globalThis.Image();
    canvasImage.src = runestoneDataUri();
  }
  if (!canvasImage?.complete || !canvasImage.naturalWidth) return false;
  const width = (height * RUNESTONE_WIDTH) / RUNESTONE_HEIGHT;
  const previousAlpha = ctx.globalAlpha;
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = previousAlpha * (active ? 1 : 0.7);
  ctx.drawImage(canvasImage, cx - width / 2, cy - height / 2, width, height);
  ctx.globalAlpha = previousAlpha;
  ctx.imageSmoothingEnabled = previousSmoothing;
  return true;
}

/** Appends `count` stone images to `parent` (a DOM element) and returns them. */
export function appendRunestones(doc, parent, count, src = runestoneDataUri()) {
  const stones = [];
  for (let i = 0; i < count; i++) {
    const img = doc.createElement('img');
    img.className = 'runestone';
    img.src = src;
    img.alt = '';
    img.setAttribute?.('aria-hidden', 'true');
    parent.appendChild(img);
    stones.push(img);
  }
  return stones;
}
