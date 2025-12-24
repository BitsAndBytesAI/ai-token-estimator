# ai-token-estimator

Estimate token counts and costs for LLM API calls based on character count and model-specific ratios.

> **Important:** This is a rough estimation tool for budgeting purposes, not a precise tokenizer. Actual token counts may vary by ±20% depending on:
> - Content type (code vs prose)
> - Language (CJK languages use more tokens)
> - API message framing overhead
> - Special characters and formatting

## Installation

```bash
npm install ai-token-estimator
```

## Usage

```typescript
import { estimate, getAvailableModels } from 'ai-token-estimator';

// Basic usage
const result = estimate({
  text: 'Hello, world! This is a test message.',
  model: 'gpt-4o'
});

console.log(result);
// {
//   model: 'gpt-4o',
//   characterCount: 38,
//   estimatedTokens: 10,
//   estimatedInputCost: 0.000025,
//   charsPerToken: 4
// }

// List available models
console.log(getAvailableModels());
// ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'claude-opus-4.5', 'claude-sonnet-4', 'claude-haiku-3.5']
```

## API Reference

### `estimate(input: EstimateInput): EstimateOutput`

Estimates token count and cost for the given text and model.

**Parameters:**

```typescript
interface EstimateInput {
  text: string;           // The text to estimate tokens for
  model: string;          // Model ID (e.g., 'gpt-4o', 'claude-opus-4.5')
  rounding?: 'ceil' | 'round' | 'floor';  // Rounding strategy (default: 'ceil')
}
```

**Returns:**

```typescript
interface EstimateOutput {
  model: string;           // The model used
  characterCount: number;  // Number of Unicode code points
  estimatedTokens: number; // Estimated token count (integer)
  estimatedInputCost: number; // Estimated cost in USD
  charsPerToken: number;   // The ratio used for this model
}
```

### `getAvailableModels(): string[]`

Returns an array of all supported model IDs.

### `getModelConfig(model: string): ModelConfig`

Returns the configuration for a specific model. Throws if the model is not found.

```typescript
interface ModelConfig {
  charsPerToken: number;      // Characters per token ratio
  inputCostPerMillion: number; // USD per 1M input tokens
}
```

### `DEFAULT_MODELS`

Read-only object containing all model configurations. Frozen to prevent runtime mutation.

## Rounding Options

By default, token counts are rounded up (`ceil`) for conservative budgeting. You can override this:

```typescript
// Round up (default) - conservative for budgeting
estimate({ text, model: 'gpt-4o', rounding: 'ceil' });

// Round down - optimistic estimate
estimate({ text, model: 'gpt-4o', rounding: 'floor' });

// Round to nearest - balanced estimate
estimate({ text, model: 'gpt-4o', rounding: 'round' });
```

## Character Counting

This package counts Unicode code points, not UTF-16 code units. This means:
- Emojis count as 1 character (not 2)
- Accented characters count correctly
- Most source code characters count as 1

## Supported Models

| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|
| gpt-4o | 4 | $2.50 |
| gpt-4o-mini | 4 | $0.15 |
| gpt-4.1 | 4 | $3.00 |
| gpt-4.1-mini | 4 | $0.40 |
| claude-opus-4.5 | 3.5 | $5.00 |
| claude-sonnet-4 | 3.5 | $3.00 |
| claude-haiku-3.5 | 3.5 | $0.80 |

*Pricing last verified: December 2025*

## Updating Pricing

Model configurations are embedded in the package. To update pricing:
1. Modify `src/models.ts`
2. Create a changeset: `npx changeset`
3. Publish a new version

## License

MIT
