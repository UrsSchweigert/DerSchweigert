// Adapts a Campaign 2 question (campaign2-levels.js) to the problem shape the game already
// understands: `question` text for the speech bubble, `answer` and `options` as answer keys,
// plus `math` (tokens for the header) and `optionsHtml` (stacked maths for the answer
// buttons). The text and html are derived here, from validated tokens and keys only.
import { generateProblem2, revealTokens2 } from './campaign2-levels.js';
import { expressionUnicode, answerHtml } from './math-render.js';

export function generateGameProblem2(level, seed, options = {}) {
  const p = generateProblem2(level, seed, options);
  return {
    ...p,
    campaign: 2,
    operation: null,
    question: expressionUnicode(p.tokens),
    math: p.tokens,
    revealText: expressionUnicode(revealTokens2(p)),
    optionsHtml: p.options.map(answerHtml),
  };
}
