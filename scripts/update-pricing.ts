#!/usr/bin/env npx tsx

/**
 * Pricing Update Script
 *
 * Fetches latest model pricing from OpenAI, Anthropic, and Google using Firecrawl,
 * then updates src/models.ts and README.md with the new prices.
 *
 * Usage:
 *   FIRECRAWL_API_KEY=your_key npx tsx scripts/update-pricing.ts
 *
 * This script is run weekly by GitHub Actions to keep prices up to date.
 * It also updates the README.md model tables to keep npm documentation in sync.
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_MODELS } from '../src/models.js';

// Provider URLs
const PROVIDER_URLS = {
  openai: 'https://openai.com/api/pricing/',
  anthropic: 'https://www.anthropic.com/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
} as const;

// Schema for Firecrawl extract
const PRICING_SCHEMA = {
  type: 'object',
  properties: {
    models: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          model_name: { type: 'string' },
          input_cost_per_million: { type: 'number' },
          output_cost_per_million: { type: 'number' },
        },
        required: ['model_name', 'input_cost_per_million'],
      },
    },
  },
} as const;

// Chars per token by provider (these don't change)
const CHARS_PER_TOKEN: Record<string, number> = {
  openai: 4,
  anthropic: 3.5,
  google: 4,
};

interface ExtractedModel {
  model_name: string;
  input_cost_per_million: number;
  output_cost_per_million?: number;
}

interface ModelConfig {
  charsPerToken: number;
  inputCostPerMillion: number;
}

/**
 * Normalize model names from provider format to our standard format.
 */
function normalizeModelName(
  provider: string,
  rawName: string
): string | null {
  const name = rawName.toLowerCase().trim();

  if (provider === 'openai') {
    // OpenAI: "GPT-5.2" -> "gpt-5.2", "GPT-4.1 mini" -> "gpt-4.1-mini"
    return name
      .replace(/\s+/g, '-') // spaces to hyphens
      .replace(/^gpt-/, 'gpt-'); // ensure gpt- prefix is lowercase
  }

  if (provider === 'anthropic') {
    // Anthropic: "Opus 4.5" -> "claude-opus-4.5", "Sonnet 4" -> "claude-sonnet-4"
    const match = name.match(/^(opus|sonnet|haiku)\s*([\d.]+)?$/);
    if (match) {
      const [, tier, version] = match;
      return version ? `claude-${tier}-${version}` : `claude-${tier}`;
    }
    // Already has claude- prefix
    if (name.startsWith('claude-')) {
      return name;
    }
    return null;
  }

  if (provider === 'google') {
    // Google: usually already in correct format like "gemini-2.5-pro"
    // Filter out non-LLM models (imagen, veo, etc.)
    if (
      name.startsWith('gemini-') &&
      !name.includes('embedding') &&
      !name.includes('robotics')
    ) {
      // Remove -preview suffix for cleaner names
      return name.replace(/-preview$/, '');
    }
    return null;
  }

  return null;
}

/**
 * Fetch pricing from a provider using Firecrawl extract.
 */
async function fetchProviderPricing(
  firecrawl: FirecrawlApp,
  provider: string,
  url: string
): Promise<Map<string, ModelConfig>> {
  console.log(`Fetching pricing from ${provider}...`);

  const result = await firecrawl.extract([url], {
    prompt: `Extract all LLM model names and their API pricing. For each model, get: model name/ID, input cost per million tokens, output cost per million tokens. Only include text/chat models, not image or video generation models.`,
    schema: PRICING_SCHEMA,
  });

  if (!result.success || !result.data?.models) {
    console.warn(`Warning: Failed to extract pricing from ${provider}`);
    return new Map();
  }

  const models = new Map<string, ModelConfig>();
  const charsPerToken = CHARS_PER_TOKEN[provider];

  for (const extracted of result.data.models as ExtractedModel[]) {
    const normalizedName = normalizeModelName(provider, extracted.model_name);
    if (!normalizedName) {
      continue;
    }

    // Validate price is reasonable (between $0.01 and $500 per million)
    const price = extracted.input_cost_per_million;
    if (price < 0.01 || price > 500) {
      console.warn(
        `Warning: Skipping ${normalizedName} with suspicious price: $${price}/M`
      );
      continue;
    }

    models.set(normalizedName, {
      charsPerToken,
      inputCostPerMillion: price,
    });
  }

  console.log(`  Found ${models.size} models from ${provider}`);
  return models;
}

/**
 * Group models by provider
 */
function groupModelsByProvider(allModels: Map<string, ModelConfig>): {
  openai: [string, ModelConfig][];
  anthropic: [string, ModelConfig][];
  google: [string, ModelConfig][];
} {
  const openaiModels: [string, ModelConfig][] = [];
  const anthropicModels: [string, ModelConfig][] = [];
  const googleModels: [string, ModelConfig][] = [];

  for (const [name, config] of allModels) {
    if (name.startsWith('gpt-') || name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4')) {
      openaiModels.push([name, config]);
    } else if (name.startsWith('claude-')) {
      anthropicModels.push([name, config]);
    } else if (name.startsWith('gemini-')) {
      googleModels.push([name, config]);
    }
  }

  // Sort each group alphabetically
  openaiModels.sort((a, b) => a[0].localeCompare(b[0]));
  anthropicModels.sort((a, b) => a[0].localeCompare(b[0]));
  googleModels.sort((a, b) => a[0].localeCompare(b[0]));

  return { openai: openaiModels, anthropic: anthropicModels, google: googleModels };
}

/**
 * Format price for display (e.g., 0.075 -> "$0.08", 15 -> "$15.00")
 */
function formatPrice(price: number): string {
  if (price < 1) {
    return `$${price.toFixed(2)}`;
  }
  return `$${price.toFixed(2)}`;
}

/**
 * Generate the README supported models section
 */
function generateReadmeModelsSection(
  allModels: Map<string, ModelConfig>,
  timestamp: string
): string {
  const { openai, anthropic, google } = groupModelsByProvider(allModels);

  const formatTableRow = ([name, config]: [string, ModelConfig]) =>
    `| ${name} | ${config.charsPerToken} | ${formatPrice(config.inputCostPerMillion)} |`;

  const tableHeader = `| Model | Chars/Token | Input Cost (per 1M tokens) |
|-------|-------------|---------------------------|`;

  return `<!-- SUPPORTED_MODELS_START -->
## Supported Models

> **Auto-updated weekly** via GitHub Actions from provider pricing pages.

### OpenAI Models

${tableHeader}
${openai.map(formatTableRow).join('\n')}

### Anthropic Claude Models

${tableHeader}
${anthropic.map(formatTableRow).join('\n')}

### Google Gemini Models

${tableHeader}
${google.map(formatTableRow).join('\n')}

*Last updated: ${timestamp}*
<!-- SUPPORTED_MODELS_END -->`;
}

/**
 * Update the README.md with the new models section
 */
function updateReadme(
  allModels: Map<string, ModelConfig>,
  timestamp: string,
  readmePath: string
): void {
  const content = fs.readFileSync(readmePath, 'utf-8');
  const newSection = generateReadmeModelsSection(allModels, timestamp);

  // Replace content between markers
  const startMarker = '<!-- SUPPORTED_MODELS_START -->';
  const endMarker = '<!-- SUPPORTED_MODELS_END -->';

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.warn('Warning: README markers not found, skipping README update');
    return;
  }

  const newContent =
    content.substring(0, startIdx) +
    newSection +
    content.substring(endIdx + endMarker.length);

  fs.writeFileSync(readmePath, newContent, 'utf-8');
  console.log(`Updated ${readmePath}`);
}

/**
 * Generate the TypeScript source code for models.ts
 */
function generateModelsFile(
  allModels: Map<string, ModelConfig>,
  timestamp: string
): string {
  const { openai: openaiModels, anthropic: anthropicModels, google: googleModels } = groupModelsByProvider(allModels);

  const formatModel = ([name, config]: [string, ModelConfig]) =>
    `  '${name}': {
    charsPerToken: ${config.charsPerToken},
    inputCostPerMillion: ${config.inputCostPerMillion},
  },`;

  return `import type { ModelConfig } from './types.js';

/**
 * Default model configurations.
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Last updated: ${timestamp}
 *
 * Sources:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 *
 * This file is automatically updated weekly by GitHub Actions.
 */

export const LAST_UPDATED = '${timestamp}';

const models: Record<string, ModelConfig> = {
  // ===================
  // OpenAI Models
  // ===================
  // OpenAI uses ~4 chars per token for English text

${openaiModels.map(formatModel).join('\n')}

  // ===================
  // Anthropic Models
  // ===================
  // Anthropic uses ~3.5 chars per token for English text

${anthropicModels.map(formatModel).join('\n')}

  // ===================
  // Google Gemini Models
  // ===================
  // Gemini uses similar tokenization to OpenAI (~4 chars per token)

${googleModels.map(formatModel).join('\n')}
};

// Deep freeze to prevent runtime mutation
Object.values(models).forEach((config) => Object.freeze(config));
export const DEFAULT_MODELS: Readonly<Record<string, Readonly<ModelConfig>>> =
  Object.freeze(models);

/**
 * Get configuration for a specific model.
 * @param model - The model ID to look up
 * @returns The model configuration
 * @throws Error if model is not found
 */
export function getModelConfig(model: string): ModelConfig {
  const config = DEFAULT_MODELS[model];
  if (!config) {
    const available = Object.keys(DEFAULT_MODELS).join(', ');
    throw new Error(
      \`Unknown model: "\${model}". Available models: \${available}\`
    );
  }
  return config;
}

/**
 * Get list of all available model IDs.
 * @returns Array of model ID strings
 */
export function getAvailableModels(): string[] {
  return Object.keys(DEFAULT_MODELS);
}
`;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error('Error: FIRECRAWL_API_KEY environment variable is required');
    process.exit(1);
  }

  const firecrawl = new FirecrawlApp({ apiKey });

  // Start with existing models (preserve models not found in scrape)
  const allModels = new Map<string, ModelConfig>();
  for (const [name, config] of Object.entries(DEFAULT_MODELS)) {
    allModels.set(name, {
      charsPerToken: config.charsPerToken,
      inputCostPerMillion: config.inputCostPerMillion,
    });
  }
  console.log(`Starting with ${allModels.size} existing models`);

  // Fetch pricing from all providers and update/add models
  let updatedCount = 0;
  let addedCount = 0;

  for (const [provider, url] of Object.entries(PROVIDER_URLS)) {
    try {
      const models = await fetchProviderPricing(firecrawl, provider, url);
      for (const [name, config] of models) {
        if (allModels.has(name)) {
          const existing = allModels.get(name)!;
          if (existing.inputCostPerMillion !== config.inputCostPerMillion) {
            console.log(
              `  Updated ${name}: $${existing.inputCostPerMillion} -> $${config.inputCostPerMillion}`
            );
            updatedCount++;
          }
        } else {
          console.log(`  Added new model: ${name} at $${config.inputCostPerMillion}/M`);
          addedCount++;
        }
        allModels.set(name, config);
      }
    } catch (error) {
      console.error(`Error fetching from ${provider}:`, error);
      // Continue with other providers - we still have existing models
    }
  }

  console.log(`\nSummary: ${updatedCount} prices updated, ${addedCount} new models added`);

  // Count models by provider
  const openaiCount = [...allModels.keys()].filter(
    (k) => k.startsWith('gpt-') || k.startsWith('o')
  ).length;
  const anthropicCount = [...allModels.keys()].filter((k) =>
    k.startsWith('claude-')
  ).length;
  const googleCount = [...allModels.keys()].filter((k) =>
    k.startsWith('gemini-')
  ).length;

  console.log(
    `Total: ${allModels.size} models (OpenAI: ${openaiCount}, Anthropic: ${anthropicCount}, Google: ${googleCount})`
  );

  // Generate and write the file
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const content = generateModelsFile(allModels, timestamp);

  const outputPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'src',
    'models.ts'
  );

  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`\nUpdated ${outputPath}`);

  // Update README.md
  const readmePath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'README.md'
  );
  updateReadme(allModels, timestamp, readmePath);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
