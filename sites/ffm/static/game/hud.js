// hud.js — HUD management for Arithmo Slayer

import { Renderer } from './renderer.js';

export class HUD {
  constructor(renderer) {
    this._renderer = renderer;
    this._state = {
      hearts: 3,
      maxHearts: 5,
      score: 0,
      combo: 0,
      level: 1,
      difficulty: 'medium',
      healGlowRatio: 0,
      healFillRatio: 0,
      isShapesMode: false
    };
  }

  update(state) {
    Object.assign(this._state, state);
  }

  draw() {
    const levelLabel = this._state.isShapesMode ? 'Shapes' : 'Level ' + this._state.level;
    this._renderer.drawHUD(
      this._state.hearts,
      this._state.maxHearts,
      this._state.score,
      this._state.combo,
      levelLabel,
      this._state.healGlowRatio,
      this._state.healFillRatio,
      this._state.isShapesMode // hideScore — Shapes mode is unscored, so hide the coin/score/combo readout entirely
    );
  }
}
