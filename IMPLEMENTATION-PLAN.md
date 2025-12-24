# ai-token-estimator Implementation Plan

## Overview

A standalone, portable npm package that estimates token counts and costs for LLM API calls based on character count and model-specific ratios.

**Intended Use:** Rough budgeting and size estimation for LLM inputs. This is NOT a precise tokenizer - actual token counts may vary by ±20% depending on content type, language, and API framing overhead.

## Package Details

- **Name:** `ai-token-estimator`
- **Language:** TypeScript
- **Target:** npm registry (public)
- **License:** MIT
- **Node Support:** >=18.0.0

---

## Architecture

```
ai-token-estimator/
├── src/
│   ├── index.ts              # Main entry point, exports public API
│   ├── estimator.ts          # Core estimation logic
│   ├── models.ts             # Default model configurations (inline TS const)
│   └── types.ts              # TypeScript interfaces
├── tests/
│   └── estimator.test.ts     # Unit tests
├── .github/
│   └── workflows/
│       ├── ci.yml            # Lint/test/build on PR
│       └── release.yml       # Publish to npm on release
├── package.json
├── tsconfig.json
├── .gitignore
├── .changeset/               # Changesets config for versioning
├── LICENSE                   # MIT license
└── README.md
```

---

## Step 1: Project Setup

- Initialize npm package with `npm init`
- Configure TypeScript with `tsconfig.json`
- Add dev dependencies: `typescript`, `vitest`, `tsup`, `eslint`, `@changesets/cli`
- Set up `.gitignore`
- Use `files` field in `package.json` (not `.npmignore`) to whitelist published files
- Add `LICENSE` file (MIT)
- Configure `engines: { "node": ">=18.0.0" }`

---

## Step 2: Type Definitions (`src/types.ts`)

```typescript
export interface ModelConfig {
  /** Characters per token ratio for this model */
  charsPerToken: number;
  /** Cost in USD per 1 million input tokens */
  inputCostPerMillion: number;
}

export interface EstimateInput {
  /** The text to estimate tokens for */
  text: string;
  /** The model ID (must exist in default config) */
  model: string;
  /** Rounding strategy for token count (default: 'ceil') */
  rounding?: 'ceil' | 'round' | 'floor';
}

export interface EstimateOutput {
  /** The model used for estimation */
  model: string;
  /** Number of Unicode code points in the input */
  characterCount: number;
  /** Estimated token count (integer, rounded per rounding strategy) */
  estimatedTokens: number;
  /** Estimated input cost in USD */
  estimatedInputCost: number;
  /** The chars-per-token ratio used */
  charsPerToken: number;
}
```

**Character Count Definition:**
- Uses Unicode code points (`[...text].length`), NOT UTF-16 code units (`text.length`)
- This correctly counts emojis and non-BMP characters as single characters
- Example: `"👍"` counts as 1 character (not 2)

**Rounding Policy:**
- Default is `ceil` (round up) for conservative budgeting
- Can be overridden per-call with `rounding` option

---

## Step 3: Default Model Config (`src/models.ts`)

Inline TypeScript const to avoid runtime JSON loading issues with ESM/CJS bundling:

```typescript
import type { ModelConfig } from './types';

/**
 * Default model configurations.
 *
 * Pricing last verified: 2024-12-24
 * Sources:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 *
 * To update: modify this file and publish a new package version.
 */
const models: Record<string, ModelConfig> = {
  // OpenAI models (4 chars per token)
  'gpt-4o': {
    charsPerToken: 4,
    inputCostPerMillion: 2.50,
  },
  'gpt-4o-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.15,
  },
  'gpt-4.1': {
    charsPerToken: 4,
    inputCostPerMillion: 3.00,
  },
  'gpt-4.1-mini': {
    charsPerToken: 4,
    inputCostPerMillion: 0.40,
  },
  // Anthropic models (3.5 chars per token)
  'claude-opus-4.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 5.00,
  },
  'claude-sonnet-4': {
    charsPerToken: 3.5,
    inputCostPerMillion: 3.00,
  },
  'claude-haiku-3.5': {
    charsPerToken: 3.5,
    inputCostPerMillion: 0.80,
  },
};

// Deep freeze to prevent runtime mutation
Object.values(models).forEach(config => Object.freeze(config));
export const DEFAULT_MODELS: Readonly<Record<string, Readonly<ModelConfig>>> = Object.freeze(models);
```

---

## Step 4: Config Helpers (`src/models.ts`)

```typescript
/**
 * Get configuration for a specific model.
 * @throws Error if model is not found
 */
export function getModelConfig(model: string): ModelConfig {
  const config = DEFAULT_MODELS[model];
  if (!config) {
    const available = Object.keys(DEFAULT_MODELS).join(', ');
    throw new Error(
      `Unknown model: "${model}". Available models: ${available}`
    );
  }
  return config;
}

/**
 * Get list of all available model IDs.
 */
export function getAvailableModels(): string[] {
  return Object.keys(DEFAULT_MODELS);
}
```

---

## Step 5: Core Estimator (`src/estimator.ts`)

```typescript
import { getModelConfig } from './models';
import type { EstimateInput, EstimateOutput } from './types';

/**
 * Count Unicode code points in a string.
 * This correctly handles emojis and surrogate pairs.
 * Uses for...of loop to avoid array allocation for large inputs.
 */
function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) {
    count++;
  }
  return count;
}

/**
 * Estimate token count and cost for the given text and model.
 */
export function estimate(input: EstimateInput): EstimateOutput {
  const { text, model, rounding = 'ceil' } = input;
  const config = getModelConfig(model);

  const characterCount = countCodePoints(text);
  const rawTokens = characterCount / config.charsPerToken;

  // Apply rounding strategy
  let estimatedTokens: number;
  switch (rounding) {
    case 'floor':
      estimatedTokens = Math.floor(rawTokens);
      break;
    case 'round':
      estimatedTokens = Math.round(rawTokens);
      break;
    case 'ceil':
    default:
      estimatedTokens = Math.ceil(rawTokens);
  }

  const estimatedInputCost = (estimatedTokens * config.inputCostPerMillion) / 1_000_000;

  return {
    model,
    characterCount,
    estimatedTokens,
    estimatedInputCost,
    charsPerToken: config.charsPerToken,
  };
}
```

---

## Step 6: Public API (`src/index.ts`)

```typescript
export { estimate } from './estimator';
export { getModelConfig, getAvailableModels, DEFAULT_MODELS } from './models';
export type { EstimateInput, EstimateOutput, ModelConfig } from './types';
```

---

## Step 7: Unit Tests (`tests/estimator.test.ts`)

Test cases:

**Basic functionality:**
- Correct token estimation for known character counts
- Correct cost calculation
- Empty string returns zero tokens/cost

**Rounding:**
- Default rounding is `ceil`
- `floor` rounding works correctly
- `round` rounding works correctly
- Edge case: exact division (no rounding needed)

**Character counting:**
- ASCII text counted correctly
- Non-ASCII (accented characters) counted correctly
- Emoji counted as single characters (not surrogate pairs)
- Mixed content (code with emoji in comments)

**Model handling:**
- All default models are accessible
- Unknown model throws descriptive error with available models list
- `getAvailableModels()` returns all model IDs

**Performance:**
- Large string (1MB+) doesn't cause quadratic behavior
- Estimation completes in reasonable time

**Edge cases:**
- Whitespace-only input
- Single character input

---

## Step 8: Build & Package

- Use `tsup` to bundle for CJS and ESM
- tsup default output: `dist/index.js` (ESM), `dist/index.mjs` or `dist/index.cjs` depending on package type
- Set `"type": "module"` in package.json for ESM-first, tsup will emit `.cjs` for CommonJS
- Configure `package.json`:
  ```json
  {
    "type": "module",
    "main": "./dist/index.cjs",
    "module": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
      ".": {
        "import": {
          "types": "./dist/index.d.ts",
          "default": "./dist/index.js"
        },
        "require": {
          "types": "./dist/index.d.cts",
          "default": "./dist/index.cjs"
        }
      }
    },
    "files": ["dist", "LICENSE", "README.md"],
    "engines": { "node": ">=18.0.0" }
  }
  ```
- Scripts:
  ```json
  {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "prepublishOnly": "npm run lint && npm run test && npm run build"
  }
  ```

---

## Step 9: CI/CD Setup

### `.github/workflows/ci.yml` (PR checks)
- Trigger: `pull_request` to any branch, `push` to main only
- Jobs:
  - Lint
  - Test (matrix: Node 18, 20, 22)
  - Build

### `.github/workflows/release.yml` (npm publish)
- Trigger: push to main (changesets action)
- Uses `@changesets/action` to:
  - Create release PR with version bumps
  - Publish to npm when release PR is merged
- Requires `NPM_TOKEN` secret

### Changesets
- Initialize with `npx changeset init`
- For each change, run `npx changeset` to create a changeset
- Changesets handle version bumping and changelog generation

---

## Step 10: Documentation (`README.md`)

Contents:
- **Accuracy Disclaimer** (prominent, at top):
  - Explains this is an estimate, not exact tokenization
  - Notes variation by language (CJK uses more tokens), code vs prose, API overhead
  - States intended use: rough budgeting for LLM API costs
- Installation instructions
- Basic usage example
- API reference:
  - `estimate(input)` - main function
  - `getAvailableModels()` - list supported models
  - `getModelConfig(model)` - get config for a model
- Rounding options explanation
- Character counting explanation (code points vs code units)
- Supported models table with current pricing
- "Updating pricing" note for maintainers
- License

---

## Step 11: Publish to npm

- Ensure npm account exists and is logged in
- Add `NPM_TOKEN` to GitHub repository secrets
- Create initial changeset and merge to main
- Changesets action will create release PR
- Merge release PR to publish

---

## Future Integration with Stealthcoder

After the package is published, integrate into stealthcoder worker:

1. Install package: `npm install ai-token-estimator`
2. In `worker/src/lib/reviewer.ts` (or equivalent), after PR discovery:
   - Concatenate all code file contents for the PR
   - Call `estimate({ text: allCode, model: configuredModel })`
   - Store `estimatedTokens` and `estimatedInputCost` in the run document
3. Update Firestore `runs/{runId}` schema to include:
   ```typescript
   {
     // existing fields...
     tokenEstimate: {
       characterCount: number;
       estimatedTokens: number;
       estimatedInputCost: number;
       model: string;
     }
   }
   ```

---

## Done When

- [ ] Package published to npm as `ai-token-estimator`
- [ ] Can be installed and used: `npm install ai-token-estimator`
- [ ] Exports `estimate()` function with proper TypeScript types
- [ ] Default config includes GPT-4o, GPT-4.1, Claude Opus 4.5, Claude Sonnet 4, etc.
- [ ] Rounding option works (ceil/round/floor)
- [ ] Character counting uses code points (handles emoji correctly)
- [ ] Unit tests pass (including non-ASCII, rounding, performance)
- [ ] CI runs on PRs (lint, test, build)
- [ ] Changesets configured for release management
- [ ] npm publish automated via GitHub Actions
- [ ] README includes accuracy disclaimer and usage docs
- [ ] LICENSE file included
