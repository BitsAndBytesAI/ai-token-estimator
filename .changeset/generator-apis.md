---
"ai-token-estimator": minor
---

Add generator-based APIs for memory-efficient streaming tokenization

New functions:
- `encodeGenerator(text, options)` - Yields token chunks during encoding
- `encodeChatGenerator(messages, options)` - Yields token chunks for chat messages
- `decodeGenerator(tokens, options)` - Yields text chunks during decoding
- `decodeAsyncGenerator(tokens, options)` - Yields text chunks from async token streams

These generators are useful for:
- Processing large inputs without loading all tokens into memory
- Streaming pipelines with other generators/transforms
- Progress tracking during encoding
- Decoding streaming LLM responses
