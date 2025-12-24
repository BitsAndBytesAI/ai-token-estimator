# ai-token-estimator Implementation Plan

## Overview

A standalone, portable npm package that estimates token counts and costs for LLM API calls based on character count and configurable model parameters.

## Package Details

- **Name:** `ai-token-estimator`
- **Language:** TypeScript
- **Target:** npm registry (public)
- **License:** MIT

---

## Architecture

```
ai-token-estimator/
├── src/
│   ├── index.ts              # Main entry point, exports public API
│   ├── estimator.ts          # Core estimation logic
│   ├── config.ts             # Config loader and validation
│   └── types.ts              # TypeScript interfaces
├── config/
│   └── models.json           # Default model configurations
├── tests/
│   └── estimator.test.ts     # Unit tests
├── package.json
├── tsconfig.json
├── .gitignore
├── .npmignore
└── README.md
```

---

## Step 1: Project Setup

- Initialize npm package with `npm init`
- Configure TypeScript with `tsconfig.json`
- Add dev dependencies: `typescript`, `vitest` (for testing), `tsup` (for bundling)
- Set up `.gitignore` and `.npmignore`

---

## Step 2: Type Definitions (`src/types.ts`)

```typescript
export interface ModelConfig {
  charsPerToken: number;
  inputCostPerMillion: number;   // USD per 1M tokens
  outputCostPerMillion: number;  // USD per 1M tokens
}

export interface ModelsConfig {
  models: Record<string, ModelConfig>;
}

export interface EstimateInput {
  text: string;
  model: string;
  customConfig?: ModelsConfig;  // Optional override for default config
}

export interface EstimateOutput {
  model: string;
  characterCount: number;
  estimatedTokens: number;
  estimatedInputCost: number;   // USD
  estimatedOutputCost: number;  // USD (if same token count were output)
  charsPerToken: number;        // The ratio used
}
```

---

## Step 3: Default Model Config (`config/models.json`)

```json
{
  "models": {
    "gpt-4o": {
      "charsPerToken": 4,
      "inputCostPerMillion": 2.50,
      "outputCostPerMillion": 1.25
    },
    "gpt-4o-mini": {
      "charsPerToken": 4,
      "inputCostPerMillion": 0.15,
      "outputCostPerMillion": 0.60
    },
    "gpt-4.1": {
      "charsPerToken": 4,
      "inputCostPerMillion": 3.00,
      "outputCostPerMillion": 12.00
    },
    "claude-opus-4.5": {
      "charsPerToken": 3.5,
      "inputCostPerMillion": 5.00,
      "outputCostPerMillion": 25.00
    },
    "claude-sonnet-4": {
      "charsPerToken": 3.5,
      "inputCostPerMillion": 3.00,
      "outputCostPerMillion": 15.00
    }
  }
}
```

---

## Step 4: Config Loader (`src/config.ts`)

- Load default config from `config/models.json`
- Allow merging with custom config passed at runtime
- Validate that requested model exists in config
- Export `getModelConfig(model: string, customConfig?: ModelsConfig): ModelConfig`

---

## Step 5: Core Estimator (`src/estimator.ts`)

```typescript
export function estimate(input: EstimateInput): EstimateOutput {
  // 1. Get model config (from default or custom)
  // 2. Count characters in input.text
  // 3. Calculate tokens: characterCount / charsPerToken
  // 4. Calculate costs: tokens * costPerMillion / 1_000_000
  // 5. Return EstimateOutput
}
```

---

## Step 6: Public API (`src/index.ts`)

```typescript
export { estimate } from './estimator';
export { getModelConfig, getAvailableModels } from './config';
export type {
  EstimateInput,
  EstimateOutput,
  ModelConfig,
  ModelsConfig
} from './types';
```

---

## Step 7: Unit Tests (`tests/estimator.test.ts`)

Test cases:
- Correct token estimation for known character counts
- Correct cost calculation
- Custom config override works
- Unknown model throws descriptive error
- Empty string returns zero tokens/cost
- Large text handling

---

## Step 8: Build & Package

- Use `tsup` to bundle for CJS and ESM
- Configure `package.json` with proper `main`, `module`, `types` exports
- Add `prepublishOnly` script to run tests and build

---

## Step 9: Documentation (`README.md`)

- Installation instructions
- Basic usage examples
- Custom config example
- Available models list
- API reference

---

## Step 10: Publish to npm

- Create npm account if needed
- Run `npm publish`

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
- [ ] Default config includes GPT-4o, GPT-4.1, Claude Opus 4.5, Claude Sonnet 4
- [ ] Custom config can override defaults at runtime
- [ ] Unit tests pass
- [ ] README documents usage

---

## Timeline Estimate

Steps 1-9 can be completed in a single session. Step 10 (npm publish) requires npm credentials.
