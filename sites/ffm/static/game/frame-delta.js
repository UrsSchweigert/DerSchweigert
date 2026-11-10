// frame-delta.js — the game loop's per-frame time step.
//
// The loop gets its time from two sources: requestAnimationFrame, which
// reports the moment the frame *started*, and a manual kick-off that calls
// gameLoop(performance.now()). The manual value is taken while the current
// task runs, so it can be later than the timestamp of the next frame, and the
// raw difference then comes out negative. A long stall (backgrounded tab, a
// paused debugger) goes the other way and produces an unusable huge step.
//
// Neither may reach the gameplay timers: createAnswerClock().advance() rejects
// a non-finite or negative interval, and one such frame used to abort the
// whole loop. Clamp every step into [0, MAX_FRAME_DELTA] instead.

/** Longest time step a single frame may advance gameplay, in seconds. */
export const MAX_FRAME_DELTA = 0.1;

/**
 * Time step for one frame.
 *
 * @param {number} timestamp current frame time in milliseconds
 * @param {number|null} previous previous frame time, or null before the first frame
 * @returns {number} seconds to advance, always finite and within [0, MAX_FRAME_DELTA]
 */
export function frameDelta(timestamp, previous) {
  if (previous === null || previous === undefined) return 0;
  if (!Number.isFinite(timestamp) || !Number.isFinite(previous)) return 0;
  const seconds = (timestamp - previous) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, MAX_FRAME_DELTA);
}
