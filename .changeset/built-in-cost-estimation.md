---
"ai-token-estimator": minor
---

Add built-in cost estimation API with output, cached, and batch pricing support

New exports:
- `estimateCost()` - Calculate cost from explicit token counts
- `estimateCostFromText()` - Sync cost estimation with auto token counting
- `estimateCostFromTextAsync()` - Async cost estimation with provider-backed tokenizers
- `getTotalCost()` - Quick helper for total cost calculation

Extended `estimate()` and `estimateAsync()`:
- New inputs: `outputTokens`, `cachedInputTokens`, `mode` ('standard' | 'batch')
- New outputs: `estimatedOutputCost`, `estimatedCachedInputCost`, `estimatedTotalCost`

Extended `ModelConfig`:
- New optional fields: `outputCostPerMillion`, `cachedInputCostPerMillion`, `batchInputCostPerMillion`, `batchOutputCostPerMillion`

Updated pricing script to extract extended pricing fields from provider pages.
