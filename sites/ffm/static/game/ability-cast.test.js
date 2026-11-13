// Cast feedback wiring: a successful ability cast makes exactly one sound and
// one screen effect, a rejected cast makes neither, and the earth slow's aura
// lives for exactly the runtime spike duration. main.js is a browser module,
// so the tests extract the activation seam and run it against the real pure
// runtime with stubbed audio and screen-fx sinks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { createAbilityRuntime } from './cooldown-abilities.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function functionSource(name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist in main.js`);
  return match[0];
}

const EXTRACTED = [
  'activateAbility',
  'abilityCastOrigin',
  'playAbilityCastFeedback',
  'startSpikeAura',
  'stopSpikeAura',
  'clearSpikeSlow',
];

function castEnv({
  level = 20,
  activeFiend = null,
  inputDisabled = false,
  remaining = 5,
  castResult = true,
  spikeSlow,
} = {}) {
  const calls = { sounds: [], effects: [], casts: [] };
  const emitters = [];
  const runtimeOptions = { level };
  if (spikeSlow) runtimeOptions.spikeSlow = spikeSlow;
  const context = {
    HERO_X: 110,
    GROUND_Y: 380,
    HERO_CENTRE_ABOVE_GROUND: 78,
    createAbilityRuntime,
    restoreSpikeSlow: () => true,
    activeFiend,
    inputDisabled,
    remainingEnemyCount: () => remaining,
    __calls: calls,
    __nextFiend: { x: 0, y: 0 },
    audio: {
      playAbilityCast(id) { calls.sounds.push(id); },
    },
    ffmScreenFx: {
      play(name, payload) { calls.effects.push({ name, payload }); },
      emitter(duration, rate, fn) {
        const emitter = { duration, rate, fn };
        emitters.push(emitter);
        return emitter;
      },
    },
    ffmFx: {
      fiendCentre(fiend) {
        return fiend ? { x: fiend.x, y: fiend.y - 34 } : null;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext([
    'let abilityRuntime = null;',
    'let spikeAuraToken = 0;',
    'let spikeSlowedFiends = new Set();',
    'let spikeSpawnSlowLeft = 0;',
    `abilityRuntime = createAbilityRuntime(${JSON.stringify(runtimeOptions)});`,
    `function castWindAbility() { __calls.casts.push('wind'); activeFiend = __nextFiend; return ${castResult}; }`,
    `function castStormAbility() { __calls.casts.push('storm'); activeFiend = __nextFiend; return ${castResult}; }`,
    `function castEarthAbility() { __calls.casts.push('earth'); activeFiend = __nextFiend; return ${castResult}; }`,
    ...EXTRACTED.map(functionSource),
  ].join('\n'), context);
  return {
    calls,
    emitters,
    run: (code) => vm.runInContext(code, context),
    auraPulses: () => calls.effects.filter((effect) => effect.name === 'spikeAura'),
  };
}

describe('ability cast feedback', () => {
  it('makes one effect per successful cast, at the pre-cast target, and no second cue', () => {
    for (const [id, effect] of [['wind', 'windCast'], ['storm', 'stormCast'], ['earth', 'spikeCast']]) {
      const env = castEnv({ activeFiend: { x: 520, y: 300 } });
      assert.equal(env.run(`activateAbility('${id}')`), true, `${id} activates`);
      // The spell's own cue belongs to the press now (the bar's onPress), so the
      // cast seam must not voice it a second time.
      assert.deepEqual(env.calls.sounds, [], `${id} is not double-voiced by the cast seam`);
      assert.equal(env.calls.effects.length, 1, `${id} makes exactly one effect`);
      assert.equal(env.calls.effects[0].name, effect);
      // The cast stubs replace the fiend, so a centre read after the cast would
      // land on the new one; the effect still points at the original target.
      assert.equal(env.calls.effects[0].payload.x, 520, `${id} fires at the target it was cast on`);
      assert.equal(env.calls.effects[0].payload.y, 266);
    }
  });

  it('stays silent for locked, cooling, no-target and refused casts', () => {
    const locked = castEnv({ level: 1, activeFiend: { x: 520, y: 300 } });
    assert.equal(locked.run("activateAbility('storm')"), false);
    assert.deepEqual(locked.calls.sounds, []);
    assert.deepEqual(locked.calls.effects, []);

    const cooling = castEnv({ activeFiend: { x: 520, y: 300 } });
    assert.equal(cooling.run("activateAbility('wind')"), true);
    assert.equal(cooling.run("activateAbility('wind')"), false, 'the cooldown refuses the second cast');
    assert.deepEqual(cooling.calls.sounds, []);
    assert.equal(cooling.calls.effects.length, 1);

    const noTarget = castEnv({ activeFiend: null });
    assert.equal(noTarget.run("activateAbility('wind')"), false);
    assert.deepEqual(noTarget.calls.sounds, []);
    assert.deepEqual(noTarget.calls.effects, []);

    const refused = castEnv({ activeFiend: { x: 520, y: 300 }, castResult: false });
    assert.equal(refused.run("activateAbility('wind')"), false);
    assert.deepEqual(refused.calls.sounds, []);
    assert.deepEqual(refused.calls.effects, []);
  });

  it('sizes the earth aura from the runtime spike and stops it when the slow clears', () => {
    const env = castEnv({
      activeFiend: { x: 520, y: 300 },
      spikeSlow: { durationSeconds: 5, factor: 0.6, targets: 1 },
    });
    assert.equal(env.run("activateAbility('earth')"), true);
    assert.equal(env.emitters.length, 1, 'one aura emitter per earth cast');
    const emitter = env.emitters[0];
    assert.equal(emitter.duration, 5, 'the emitter runs for the runtime spike duration');
    assert.equal(emitter.duration, env.run('abilityRuntime.spikeState.durationSeconds'));

    emitter.fn(0.2);
    assert.equal(env.auraPulses().length, 1, 'the aura pulses while the slow runs');
    assert.equal(env.auraPulses()[0].payload.progress, 0.2);

    env.run('clearSpikeSlow()');
    emitter.fn(0.4);
    assert.equal(env.auraPulses().length, 1, 'no pulse once the runtime slow is cleared');
  });

  it('stops the aura when the runtime spike expires on its own', () => {
    const env = castEnv({
      activeFiend: { x: 520, y: 300 },
      spikeSlow: { durationSeconds: 5, factor: 0.6, targets: 1 },
    });
    assert.equal(env.run("activateAbility('earth')"), true);
    const emitter = env.emitters[0];
    env.run('abilityRuntime.tick(5, { encounterRunning: true })');
    assert.equal(env.run('abilityRuntime.spikeState.active'), false);
    emitter.fn(0.9);
    assert.equal(env.auraPulses().length, 0, 'the aura ends with the runtime spike');
  });

  it('cracks the glass orb and sparkles the score from the HUD seams', () => {
    // Press feedback: the bar reports the press, main.js makes the sound and
    // the shards. Both live in one callback so they can never drift apart.
    const press = source.match(/onPress: \(id, button\) => \{[\s\S]*?\n  \},/);
    assert.ok(press, 'the bar is created with an onPress callback');
    assert.match(press[0], /audio\.playAbilityPress\?\.\(\)/, 'glass breaks');
    assert.match(press[0], /audio\.playAbilityCast\?\.\(id\)/, "and the spell's own voice plays with it");
    assert.match(press[0], /hudBurst\.burst\(button, 'glass'/);

    const score = source.match(/onScoreGain: \(\{ element: readout \}\) => \{[\s\S]*?\n  \},/);
    assert.ok(score, 'the chrome is created with an onScoreGain callback');
    assert.match(score[0], /hudBurst\.burst\(readout, 'score'/);

    // One burst factory for the whole HUD, and it honours reduced motion.
    assert.match(source, /const hudBurst = createDomBurst\(\{/);
    assert.match(source, /const hudBurst = createDomBurst\(\{[\s\S]*?reducedMotion: globalThis\.matchMedia/);

    // A cooling orb gets its own dull cue, so no press is silent.
    const refused = source.match(/onRefused: \(\) => \{[\s\S]*?\n  \},/);
    assert.ok(refused, 'the bar is created with an onRefused callback');
    assert.match(refused[0], /audio\.playAbilityRefused\?\.\(\)/);
    assert.doesNotMatch(refused[0], /burst/, 'nothing broke, so nothing shatters');

    // The cast cue stays exactly where it was: on a successful cast only.
    const feedback = source.match(/function playAbilityCastFeedback\(id, origin\) \{[\s\S]*?\n\}/);
    assert.ok(feedback);
    assert.doesNotMatch(feedback[0], /playAbilityPress/, 'the cast is not the click');
    assert.doesNotMatch(feedback[0], /audio\.playAbilityCast\?\.\(id\)/, 'the cue is not repeated on the cast');
  });

  it('never triggers cast feedback from the frame loop', () => {
    const loop = source.match(/function gameLoop\(ts\)[\s\S]*?\n\}/);
    assert.ok(loop, 'gameLoop must exist');
    assert.ok(!/playAbilityCastFeedback|startSpikeAura|playAbilityCast/.test(loop[0]),
      'the frame loop only renders what the activation seam already fired');
  });
});
