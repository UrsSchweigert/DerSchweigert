// Skill-intro screens for Campaign 2: an explanation plus a worked example (EN/DE), shown
// on the first level of an act like the Campaign 1 intros in skill-intro.js. The texts are
// first drafts for review. Merge into i18n.js when the picker
// screen is wired up (keys are already `c2Intro.<slug>.<stage>`).

import { I, F, OP, EQ, POW, ROOT, LOG } from './expr.js';

export const SKILL_INTROS_2 = Object.freeze({
  1: { slug: 'fractions', example: { tokens: [{ t: 'frac', n: 3, d: 12 }, { t: 'op', s: '=' }, { t: 'frac', n: 1, d: 4 }] } },
  11: { slug: 'powers', example: { tokens: [POW(I(-3), I(3)), EQ, I(-27)] } },
  16: { slug: 'roots', example: { tokens: [ROOT(3, I(343)), EQ, I(7)] } },
  21: { slug: 'exponentLaws', example: { tokens: [POW(I(8), F(2, 3)), EQ, I(4)] } },
  26: { slug: 'radicals', example: { tokens: [ROOT(2, I(72)), EQ, { t: 'surd', q: { n: 6, d: 1 }, r: 2 }] } },
  31: { slug: 'logarithms', example: { tokens: [LOG(3, F(1, 9)), EQ, I(-2)] } },
  36: { slug: 'synthesis', example: { tokens: [POW(F(2, 3), I(-2)), OP('−'), ROOT(2, F(81, 16)), EQ, I(0)] } },
  6: { slug: 'unlike', example: { tokens: [{ t: 'frac', n: 1, d: 3 }, { t: 'op', s: '+' }, { t: 'frac', n: 1, d: 4 }, { t: 'op', s: '=' }, { t: 'frac', n: 7, d: 12 }] } },
});

export const INTRO_TEXT_2 = Object.freeze({
  'c2Intro.fractions.explanation': {
    en: 'A fraction is part of a whole: 3/4 means 3 of 4 equal parts. Different fractions can be equal, like 2/4 and 1/2. Always give answers in lowest terms.',
    de: 'Ein Bruch ist ein Teil eines Ganzen: 3/4 bedeutet 3 von 4 gleich großen Teilen. Verschiedene Brüche können gleich groß sein, etwa 2/4 und 1/2. Gib Ergebnisse immer vollständig gekürzt an.',
  },
  'c2Intro.fractions.workedExample': {
    en: '3/12 = 1/4. Divide the top and the bottom by 3. Going the other way, multiply both by the same number.',
    de: '3/12 = 1/4. Teile Zähler und Nenner durch 3. In die andere Richtung multiplizierst du beide mit derselben Zahl.',
  },
  'c2Intro.unlike.explanation': {
    en: 'To add or subtract fractions, first give them the same denominator. Multiplying fractions is easier: top times top, bottom times bottom. To divide, flip the second fraction and multiply.',
    de: 'Zum Addieren oder Subtrahieren von Brüchen brauchst du zuerst denselben Nenner. Das Multiplizieren ist einfacher: Zähler mal Zähler, Nenner mal Nenner. Beim Dividieren drehst du den zweiten Bruch um und multiplizierst.',
  },
  'c2Intro.unlike.workedExample': {
    en: '1/3 + 1/4 = 4/12 + 3/12 = 7/12. Twelve is the smallest number both 3 and 4 divide into.',
    de: '1/3 + 1/4 = 4/12 + 3/12 = 7/12. Zwölf ist die kleinste Zahl, in die 3 und 4 aufgehen.',
  },
  'c2Intro.powers.explanation': {
    en: 'A power repeats multiplication: 2⁴ means 2 × 2 × 2 × 2 = 16. Anything to the power 0 is 1. A negative base needs brackets: (−3)² = 9.',
    de: 'Eine Potenz wiederholt die Multiplikation: 2⁴ bedeutet 2 × 2 × 2 × 2 = 16. Jede Zahl hoch 0 ergibt 1. Eine negative Basis braucht Klammern: (−3)² = 9.',
  },
  'c2Intro.powers.workedExample': {
    en: '(−3)³ = (−3) × (−3) × (−3) = −27. An odd number of minus signs gives a minus.',
    de: '(−3)³ = (−3) × (−3) × (−3) = −27. Eine ungerade Anzahl Minuszeichen ergibt Minus.',
  },
  'c2Intro.roots.explanation': {
    en: 'A root undoes a power. √49 asks: which number squared gives 49? ∛343 asks: which number cubed gives 343?',
    de: 'Eine Wurzel macht eine Potenz rückgängig. √49 fragt: Welche Zahl zum Quadrat ergibt 49? ∛343 fragt: Welche Zahl hoch drei ergibt 343?',
  },
  'c2Intro.roots.workedExample': {
    en: '∛343 = 7, because 7 × 7 × 7 = 343.',
    de: '∛343 = 7, denn 7 × 7 × 7 = 343.',
  },
  'c2Intro.exponentLaws.explanation': {
    en: 'Same base: multiplying adds the exponents, dividing subtracts them, a power of a power multiplies them. A negative exponent flips the fraction: 2⁻³ = 1/8. A fractional exponent is a root.',
    de: 'Gleiche Basis: Beim Multiplizieren addierst du die Exponenten, beim Dividieren subtrahierst du sie, bei einer Potenz von einer Potenz multiplizierst du sie. Ein negativer Exponent kehrt den Bruch um: 2⁻³ = 1/8. Ein Bruch im Exponenten ist eine Wurzel.',
  },
  'c2Intro.exponentLaws.workedExample': {
    en: '8^(2/3) = (∛8)² = 2² = 4. The denominator is the root, the numerator is the power.',
    de: '8^(2/3) = (∛8)² = 2² = 4. Der Nenner ist die Wurzel, der Zähler die Potenz.',
  },
  'c2Intro.radicals.explanation': {
    en: 'Pull square factors out of a root: √72 = √(36 · 2) = 6√2. Like radicals add like terms. √a × √b = √(ab). To clear a root from the bottom, multiply top and bottom by it.',
    de: 'Ziehe Quadratfaktoren aus der Wurzel: √72 = √(36 · 2) = 6√2. Gleiche Wurzeln addierst du wie gleiche Terme. √a × √b = √(ab). Um eine Wurzel aus dem Nenner zu entfernen, erweiterst du mit ihr.',
  },
  'c2Intro.radicals.workedExample': {
    en: '√72 = √36 × √2 = 6√2. And 6/√3 = 6√3/3 = 2√3.',
    de: '√72 = √36 × √2 = 6√2. Und 6/√3 = 6√3/3 = 2√3.',
  },
  'c2Intro.logarithms.explanation': {
    en: 'A logarithm asks for the exponent: log₂ 8 = 3, because 2³ = 8. The log of a fraction is negative. Laws: log(xy) = log x + log y, log(x/y) = log x − log y, log(xⁿ) = n · log x.',
    de: 'Ein Logarithmus fragt nach dem Exponenten: log₂ 8 = 3, denn 2³ = 8. Der Logarithmus eines Bruchs ist negativ. Regeln: log(xy) = log x + log y, log(x/y) = log x − log y, log(xⁿ) = n · log x.',
  },
  'c2Intro.logarithms.workedExample': {
    en: 'log₃(1/9) = −2, because 3⁻² = 1/9.',
    de: 'log₃(1/9) = −2, denn 3⁻² = 1/9.',
  },
  'c2Intro.synthesis.explanation': {
    en: 'Everything you have learned now appears together. Work from the inside out, keep fractions as fractions and simplify at the end.',
    de: 'Alles, was du gelernt hast, kommt jetzt zusammen vor. Rechne von innen nach außen, lass Brüche Brüche bleiben und vereinfache am Schluss.',
  },
  'c2Intro.synthesis.workedExample': {
    en: '(2/3)⁻² − √(81/16) = 9/4 − 9/4 = 0.',
    de: '(2/3)⁻² − √(81/16) = 9/4 − 9/4 = 0.',
  },
});

export function getSkillIntro2(level) {
  if (!Number.isInteger(level) || level < 1 || level > 40) throw new RangeError('Level must be between 1 and 40');
  const intro = SKILL_INTROS_2[level];
  if (!intro) return null;
  const base = `c2Intro.${intro.slug}`;
  return {
    level,
    localizationKey: base,
    stages: [
      { type: 'explanation', localizationKey: `${base}.explanation` },
      { type: 'worked-example', localizationKey: `${base}.workedExample`, tokens: intro.example.tokens },
    ],
    timed: false,
  };
}
