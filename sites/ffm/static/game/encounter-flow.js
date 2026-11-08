export function resolveDragonBreath(fiends) {
  let defeated = 0;
  for (const fiend of fiends) {
    if (fiend.isDead || fiend.state === 'death' || fiend.state === 'retreat') continue;
    fiend.hp = 0;
    fiend.setState('death');
    defeated++;
  }
  return defeated;
}

export function createAnswerClock() {
  let elapsed = 0;
  return {
    reset() { elapsed = 0; },
    advance(seconds, active) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Invalid answer-clock interval');
      if (active) elapsed += seconds;
    },
    read() { return elapsed; },
  };
}
