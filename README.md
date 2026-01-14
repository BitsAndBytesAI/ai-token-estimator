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
// ['gpt-5.2', 'gpt-4o', 'claude-opus-4.5', 'gemini-3-pro', ...]
```

## Exact OpenAI tokenization (BPE)

This package includes **exact tokenization for OpenAI models** using a tiktoken-compatible BPE tokenizer (via `gpt-tokenizer`).

```ts
import { encode, decode } from 'ai-token-estimator';

const text = 'Hello, world!';
const tokens = encode(text, { model: 'gpt-5.1' }); // exact OpenAI token IDs
const roundTrip = decode(tokens, { model: 'gpt-5.1' });

console.log(tokens.length);
console.log(roundTrip); // "Hello, world!"
```

Supported encodings:
`r50k_base`, `p50k_base`, `p50k_edit`, `cl100k_base`, `o200k_base`, `o200k_harmony`

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

### `encode(text: string, options?: EncodeOptions): number[]`

Encodes text into **OpenAI token IDs** using tiktoken-compatible BPE tokenization.

### `decode(tokens: Iterable<number>, options?: { encoding?: OpenAIEncoding; model?: string }): string`

Decodes OpenAI token IDs back into text using the selected encoding/model.

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

<!-- SUPPORTED_MODELS_START -->
## Supported Models

> **Auto-updated weekly** via GitHub Actions from provider pricing pages.

### OpenAI Models

| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|
| babbage-002 | 4 | $0.40 |
| chatgpt-4o-latest | 4 | $5.00 |
| chatgpt-image-latest | 4 | $5.00 |
| codex-mini-latest | 4 | $1.50 |
| computer-use-preview | 4 | $3.00 |
| davinci-002 | 4 | $2.00 |
| gpt-3.5-0301 | 4 | $1.50 |
| gpt-3.5-turbo | 4 | $0.50 |
| gpt-3.5-turbo-0125 | 4 | $0.50 |
| gpt-3.5-turbo-0613 | 4 | $1.50 |
| gpt-3.5-turbo-1106 | 4 | $1.00 |
| gpt-3.5-turbo-16k-0613 | 4 | $3.00 |
| gpt-3.5-turbo-instruct | 4 | $1.50 |
| gpt-4-0125-preview | 4 | $10.00 |
| gpt-4-0314 | 4 | $30.00 |
| gpt-4-0613 | 4 | $30.00 |
| gpt-4-1106-preview | 4 | $10.00 |
| gpt-4-1106-vision-preview | 4 | $10.00 |
| gpt-4-32k | 4 | $60.00 |
| gpt-4-turbo-2024-04-09 | 4 | $10.00 |
| gpt-4.1 | 4 | $2.00 |
| gpt-4.1-mini | 4 | $0.40 |
| gpt-4.1-nano | 4 | $0.10 |
| gpt-4o | 4 | $2.50 |
| gpt-4o-2024-05-13 | 4 | $5.00 |
| gpt-4o-audio-preview | 4 | $2.50 |
| gpt-4o-mini | 4 | $0.15 |
| gpt-4o-mini-audio-preview | 4 | $0.15 |
| gpt-4o-mini-realtime-preview | 4 | $0.60 |
| gpt-4o-mini-search-preview | 4 | $0.15 |
| gpt-4o-realtime-preview | 4 | $5.00 |
| gpt-4o-search-preview | 4 | $2.50 |
| gpt-5 | 4 | $1.25 |
| gpt-5-chat-latest | 4 | $1.25 |
| gpt-5-codex | 4 | $1.25 |
| gpt-5-mini | 4 | $0.25 |
| gpt-5-nano | 4 | $0.05 |
| gpt-5-pro | 4 | $15.00 |
| gpt-5-search-api | 4 | $1.25 |
| gpt-5.1 | 4 | $1.25 |
| gpt-5.1-chat-latest | 4 | $1.25 |
| gpt-5.1-codex | 4 | $1.25 |
| gpt-5.1-codex-max | 4 | $1.25 |
| gpt-5.1-codex-mini | 4 | $0.25 |
| gpt-5.2 | 4 | $1.75 |
| gpt-5.2-chat-latest | 4 | $1.75 |
| gpt-5.2-codex | 4 | $1.75 |
| gpt-5.2-pro | 4 | $21.00 |
| gpt-audio | 4 | $2.50 |
| gpt-audio-mini | 4 | $0.60 |
| gpt-image-1 | 4 | $5.00 |
| gpt-image-1-mini | 4 | $2.00 |
| gpt-image-1.5 | 4 | $5.00 |
| gpt-realtime | 4 | $4.00 |
| gpt-realtime-mini | 4 | $0.60 |
| o1 | 4 | $15.00 |
| o1-mini | 4 | $1.10 |
| o1-pro | 4 | $150.00 |
| o3 | 4 | $2.00 |
| o3-deep-research | 4 | $10.00 |
| o3-mini | 4 | $1.10 |
| o3-pro | 4 | $20.00 |
| o4-mini | 4 | $1.10 |
| o4-mini-deep-research | 4 | $2.00 |

### Anthropic Claude Models

| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|
| claude-haiku-3 | 3.5 | $0.25 |
| claude-haiku-3.5 | 3.5 | $0.80 |
| claude-haiku-4.5 | 3.5 | $1.00 |
| claude-opus-3 | 3.5 | $15.00 |
| claude-opus-4 | 3.5 | $15.00 |
| claude-opus-4.1 | 3.5 | $15.00 |
| claude-opus-4.5 | 3.5 | $5.00 |
| claude-sonnet-4 | 3.5 | $3.00 |
| claude-sonnet-4.5 | 3.5 | $3.00 |

### Google Gemini Models

| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|
| gemini-2.0-flash | 4 | $0.10 |
| gemini-2.0-flash-lite | 4 | $0.08 |
| gemini-2.5-computer-use-preview-10-2025 | 4 | $1.25 |
| gemini-2.5-flash | 4 | $0.30 |
| gemini-2.5-flash-lite | 4 | $0.10 |
| gemini-2.5-flash-lite-preview-09-2025 | 4 | $0.10 |
| gemini-2.5-flash-native-audio-preview-12-2025 | 4 | $0.50 |
| gemini-2.5-flash-preview-09-2025 | 4 | $0.30 |
| gemini-2.5-flash-preview-tts | 4 | $0.50 |
| gemini-2.5-pro | 4 | $1.25 |
| gemini-2.5-pro-preview-tts | 4 | $1.00 |
| gemini-3-flash | 4 | $0.50 |
| gemini-3-pro | 4 | $2.00 |

*Last updated: 2026-01-14*
<!-- SUPPORTED_MODELS_END -->

## Pricing Updates

Model pricing is automatically updated weekly via GitHub Actions. The update script fetches the latest prices directly from:
- [OpenAI Pricing](https://platform.openai.com/docs/pricing)
- [Anthropic Pricing](https://www.anthropic.com/pricing)
- [Google AI Pricing](https://ai.google.dev/gemini-api/docs/pricing)

You can check when prices were last updated:

```typescript
import { LAST_UPDATED } from 'ai-token-estimator';
console.log(LAST_UPDATED); // e.g. '2026-01-14'
```

## License

MIT
