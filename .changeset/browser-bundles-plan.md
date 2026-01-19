---
"ai-token-estimator": patch
---

Add implementation plan for browser IIFE bundles (Feature #11)

This plan documents:
- Per-encoding IIFE bundles for CDN usage (o200k_base, o200k_harmony, cl100k_base, p50k_base, p50k_edit, r50k_base)
- Browser entry points in src/browser/
- Build configuration using tsup IIFE format
- Cross-platform build scripts (Windows/macOS/Linux)
- Comprehensive artifact testing via node:vm
- README documentation for CDN usage via unpkg/jsdelivr
