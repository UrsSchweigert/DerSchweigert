// fiend-walk.js - picks the frame of a fiend's walk cycle.
//
// Every fiend class has a strip in fiend-walk/ (WALK_FRAMES equally wide frames
// side by side, cut with the same box as the still in fiend-sprites/, so a frame
// and the still have the same aspect ratio). The strip is the raw generated walk:
// it is played as it came, not re-aligned, so the pacing below is the one it was
// approved at.

import { WALK_FRAMES } from './difficulty-classes.js';

/** Frames per second of the walk cycle: 110 ms a frame. */
export const WALK_FPS = 9;

/**
 * Frame index for a walk clock (seconds spent walking), looping.
 * @param {number} clock seconds since the walk started; negatives and NaN count as 0.
 * @param {number} [frames] frames in the strip.
 * @param {number} [fps]
 */
export function walkFrameIndex(clock, frames = WALK_FRAMES, fps = WALK_FPS) {
  if (!(clock > 0)) return 0;
  return Math.floor(clock * fps) % frames;
}

/**
 * Source rectangle of one frame inside a loaded strip, or null when the image is
 * not a usable strip (not loaded, or not evenly divisible into `frames` frames) -
 * the caller then keeps drawing the still.
 */
export function walkSourceRect(strip, frameIndex, frames = WALK_FRAMES) {
  if (!strip || !strip.complete || !strip.naturalWidth || !strip.naturalHeight) return null;
  if (strip.naturalWidth % frames !== 0) return null;
  const sw = strip.naturalWidth / frames;
  return { sx: frameIndex * sw, sy: 0, sw, sh: strip.naturalHeight };
}
