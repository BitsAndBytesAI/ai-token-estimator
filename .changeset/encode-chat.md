---
'ai-token-estimator': minor
---

feat: add encodeChat for chat-aware tokenization

- `encodeChat(messages, options)`: Encode chat messages into token IDs using ChatML format
- Returns exact token sequences including special message delimiter tokens (`<|im_start|>`, `<|im_sep|>`, `<|im_end|>`)
- Supports cl100k_base (GPT-4, GPT-3.5-turbo) and o200k_base (GPT-4o, GPT-4o-mini) encodings
- Experimental support for o200k_harmony encoding
- Includes assistant response priming by default (configurable via `primeAssistant` option)
- Handles message `name` field and `function_call` in assistant messages
- Rejects non-OpenAI models (claude-*, gemini-*) and tools API features (tool_calls, tool_call_id)
