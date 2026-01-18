/**
 * HuggingFace tokenizer.json Normalizer Builder
 *
 * Compiles tokenizer.json normalizer pipelines into callable functions.
 *
 * Supported normalizers:
 * - Sequence (chain of normalizers)
 * - Lowercase
 * - NFKC
 * - Strip
 * - Replace (Pattern.String and Pattern.Regex)
 */

import type { HFNormalizer, HFPattern } from './types.js';
import type { TextNormalizer } from '../algorithms/added-tokens.js';
import { UnsupportedTokenizerError } from './validator.js';

/**
 * Build a TextNormalizer from a tokenizer.json normalizer config
 */
export function buildHFNormalizer(normalizer: HFNormalizer | undefined): TextNormalizer | null {
  if (!normalizer) return null;

  if (normalizer.type === 'Sequence') {
    const parts = normalizer.normalizers ?? [];
    const compiled = parts.map((n) => buildHFNormalizer(n)).filter(Boolean) as TextNormalizer[];
    return {
      normalize(text: string): string {
        let out = text;
        for (const part of compiled) out = part.normalize(out);
        return out;
      },
    };
  }

  if (normalizer.type === 'Lowercase') {
    return { normalize: (t: string) => t.toLowerCase() };
  }

  if (normalizer.type === 'NFKC') {
    return { normalize: (t: string) => t.normalize('NFKC') };
  }

  if (normalizer.type === 'NFC') {
    return { normalize: (t: string) => t.normalize('NFC') };
  }

  if (normalizer.type === 'NFD') {
    return { normalize: (t: string) => t.normalize('NFD') };
  }

  if (normalizer.type === 'NFKD') {
    return { normalize: (t: string) => t.normalize('NFKD') };
  }

  if (normalizer.type === 'Strip') {
    const left = normalizer.left ?? true;
    const right = normalizer.right ?? true;
    return {
      normalize(text: string): string {
        let out = text;
        if (left) out = out.replace(/^\s+/u, '');
        if (right) out = out.replace(/\s+$/u, '');
        return out;
      },
    };
  }

  if (normalizer.type === 'Replace') {
    const compiled = compileHFReplacePattern(normalizer.pattern);
    const content = normalizer.content ?? '';

    if (compiled.type === 'string') {
      // Literal substring replacement (NOT a regex). Use split/join for broad compatibility.
      return { normalize: (t: string) => t.split(compiled.value).join(content) };
    }

    // Regex replacement
    const jsReplacement = translateRustReplacementToJs(content);
    return { normalize: (t: string) => t.replace(compiled.value, jsReplacement) };
  }

  if (normalizer.type === 'Prepend') {
    const prepend = (normalizer as { prepend?: string }).prepend ?? '';
    return { normalize: (t: string) => prepend + t };
  }

  throw new UnsupportedTokenizerError(
    `Unsupported tokenizer.json normalizer: "${normalizer.type}". ` +
      'Add support in buildHFNormalizer() or provide a supported tokenizer.json.'
  );
}

type CompiledReplacePattern = { type: 'string'; value: string } | { type: 'regex'; value: RegExp };

function compileHFReplacePattern(pattern: HFPattern | undefined): CompiledReplacePattern {
  if (!pattern) {
    throw new UnsupportedTokenizerError('Replace normalizer missing pattern');
  }

  if (typeof pattern === 'string') {
    return { type: 'string', value: pattern };
  }

  if (typeof pattern === 'object' && 'String' in pattern) {
    return { type: 'string', value: pattern.String };
  }

  if (typeof pattern === 'object' && 'Regex' in pattern) {
    const raw = pattern.Regex;
    return { type: 'regex', value: compileHFRustRegexToJs(raw) };
  }

  throw new UnsupportedTokenizerError('Replace normalizer missing supported pattern (String or Regex)');
}

function compileHFRustRegexToJs(raw: string): RegExp {
  // MVP regex feature support:
  // - Pattern form: { Regex: string }
  // - No lookaround, no backreferences (Rust regex doesn't support them either)
  // - Optional leading flag group: (?i), (?m), (?s) (combined allowed: (?im))
  // - Unicode-aware \w/\d rewrites for parity with Rust regex defaults
  //
  // Anything outside this subset must throw to prevent silent mismatches.

  if (raw.includes('(?=') || raw.includes('(?!') || raw.includes('(?<=') || raw.includes('(?<!')) {
    throw new UnsupportedTokenizerError('Unsupported Regex pattern: lookaround is not supported');
  }
  if (/\\[1-9]/.test(raw) || /\\k<[^>]+>/.test(raw)) {
    throw new UnsupportedTokenizerError('Unsupported Regex pattern: backreferences are not supported');
  }

  // Named capture group syntax: Rust uses (?P<name>...), JS uses (?<name>...)
  let pattern = raw.replace(/\(\?P</g, '(?<');

  // Extract a leading flag group like (?im) or (?i)
  let flags = 'gu';
  const leadingFlags = pattern.match(/^\(\?([ims]+)\)/);
  if (leadingFlags) {
    const f = leadingFlags[1];
    if (f.includes('i')) flags += 'i';
    if (f.includes('m')) flags += 'm';
    if (f.includes('s')) flags += 's';
    pattern = pattern.slice(leadingFlags[0].length);
  }

  // Rust regex uses Unicode character classes for \w/\d by default; JS does not.
  pattern = pattern
    .replace(/\\w/g, '[\\p{L}\\p{N}_]')
    .replace(/\\W/g, '[^\\p{L}\\p{N}_]')
    .replace(/\\d/g, '\\p{Nd}')
    .replace(/\\D/g, '\\P{Nd}');

  try {
    return new RegExp(pattern, flags);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UnsupportedTokenizerError(
      `Invalid/unsupported Regex pattern for Replace normalizer: ${message}`
    );
  }
}

function translateRustReplacementToJs(replacement: string): string {
  // Rust regex replacement supports `$name` for named capture groups.
  // JS uses `$<name>`. Translate for parity.
  //
  // This is intentionally conservative:
  // - Leaves `$1..$99` intact (compatible)
  // - Leaves `$$` intact (both treat as literal `$`)
  return replacement.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, '$<$1>');
}
