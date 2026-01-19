---
'ai-token-estimator': minor
---

feat: add isWithinTokenLimit for fast token limit validation

- `isWithinTokenLimit(text, limit, options)`: Check if text is within token limit with early exit optimization
- `isChatWithinTokenLimit({ messages, model, tokenLimit, ... })`: Check if chat messages are within limit
- Returns `false` if exceeded, or the actual token count if within limit
- Uses incremental regex matching for true early-exit (avoids upfront allocation)
- Significantly faster than full tokenization when limit is exceeded early (up to 1000x+)
