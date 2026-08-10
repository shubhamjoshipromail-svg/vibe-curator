#!/usr/bin/env node
/** Offline report from already-recorded usage. Makes no API calls. */
import { readFileSync } from 'node:fs';

const file = JSON.parse(readFileSync(new URL('../src/effects/builtin.json', import.meta.url), 'utf8'));
const models = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const usage = file.effects.reduce(
  (sum, effect) => ({
    input: sum.input + (effect.usage?.input ?? 0),
    output: sum.output + (effect.usage?.output ?? 0),
  }),
  { input: 0, output: 0 },
);

console.log(`Recorded corpus: ${file.effects.length} effects, ${usage.input} input + ${usage.output} output tokens`);
for (const [model, price] of Object.entries(models)) {
  const cost = usage.input / 1e6 * price.input + usage.output / 1e6 * price.output;
  console.log(`${model.padEnd(22)} $${cost.toFixed(4)} total, $${(cost / file.effects.length).toFixed(4)} / successful effect`);
}
console.log('Compile success and retry rate require an explicitly authorized live eval run.');
