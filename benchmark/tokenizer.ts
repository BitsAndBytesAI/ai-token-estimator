import { encode, estimate } from '../src/index.js';

function time<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  // eslint-disable-next-line no-console
  console.log(`${label}: ${elapsed.toFixed(2)}ms`);
  return result;
}

function main(): void {
  // Keep this size modest so the benchmark runs quickly and doesn't allocate
  // huge arrays of token IDs.
  const text = 'a'.repeat(50_000);

  time('estimate (heuristic)', () =>
    estimate({ text, model: 'gpt-5.1', tokenizer: 'heuristic' })
  );

  time('encode (OpenAI BPE)', () => encode(text, { model: 'gpt-5.1' }).length);
}

main();
