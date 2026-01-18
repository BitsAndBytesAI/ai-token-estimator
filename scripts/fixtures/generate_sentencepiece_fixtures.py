#!/usr/bin/env python3
"""
Generate golden test fixtures for SentencePiece tokenizer parity testing.

This script uses the official Python sentencepiece library to generate
expected encode/decode results that our TypeScript implementation can be
tested against.

Usage:
    pip install sentencepiece
    python scripts/fixtures/generate_sentencepiece_fixtures.py

The script expects model files in tests/.models/ directory.
"""

import json
import sys
from pathlib import Path

try:
    import sentencepiece as spm
except ImportError:
    print("Error: sentencepiece not installed. Run: pip install sentencepiece")
    sys.exit(1)


# Test cases covering various edge cases
TEST_CASES = [
    # Basic text
    "Hello, world!",
    "The quick brown fox jumps over the lazy dog.",
    "Hello",
    "hello",
    "HELLO",

    # Single characters
    "a",
    "A",
    "1",
    " ",

    # Unicode - various scripts
    "日本語テスト",
    "こんにちは世界",
    "Привет мир",
    "Здравствуй",
    "مرحبا بالعالم",
    "שלום עולם",
    "Γειά σου κόσμε",
    "你好世界",
    "안녕하세요",
    "สวัสดีโลก",

    # Emoji and ZWJ sequences
    "🎉",
    "🚀💻🎯",
    "👨‍👩‍👧‍👦",
    "🏳️‍🌈",
    "👩🏽‍💻",
    "🇺🇸",
    "❤️",

    # Combining characters
    "café",
    "cafe\u0301",
    "나는 한국어",
    "ñ",
    "n\u0303",

    # Edge cases - empty and whitespace
    "",
    " ",
    "   ",
    "\n",
    "\t",
    "\n\t\r",
    "\r\n",

    # Whitespace handling
    "word1  word2   word3",
    " leading",
    "trailing ",
    "  both  ",
    "multiple   spaces   here",
    "tabs\there",
    "newlines\nhere",
    "mixed \t\n whitespace",

    # Long text
    "a" * 100,
    "hello " * 50,
    "The quick brown fox " * 20,

    # Numbers and punctuation
    "12345",
    "3.14159",
    "1,234,567.89",
    "-42",
    "+100",
    "1e10",
    "50%",
    "$100.00",

    # Special characters that might be control tokens
    "<s>",
    "</s>",
    "<unk>",
    "<pad>",
    "<mask>",
    "[CLS]",
    "[SEP]",
    "[MASK]",
    "<s>text</s>",
    "text with <unk> token",

    # Mixed content
    "Hello 世界! 🌍 Привет",
    "Code: def foo(): pass",
    "Email: test@example.com",
    "URL: https://example.com/path?query=1&foo=bar",
    "Path: /usr/local/bin/python",
    "Windows: C:\\Users\\test\\file.txt",

    # Potential normalization edge cases
    "ﬁ",
    "ﬂ",
    "①②③",
    "Ａ",
    "ａ",
    "\u00A0",
    "…",
    "—",
    "–",
    "\u2018\u2019",
    "\u201c\u201d",

    # Code snippets
    "function foo() { return 42; }",
    "def hello():\n    print('world')",
    "SELECT * FROM users WHERE id = 1;",
    "const x = { a: 1, b: 2 };",
    "<html><body>Hello</body></html>",

    # JSON/structured data
    '{"key": "value"}',
    '["a", "b", "c"]',

    # Mathematical expressions
    "x² + y² = z²",
    "∑(i=1 to n)",
    "∫f(x)dx",
    "α β γ δ",
    "π ≈ 3.14159",

    # Currency and symbols
    "€100",
    "£50",
    "¥1000",
    "₿0.01",
    "© 2024",
    "® trademark",
    "™ symbol",

    # Repeated patterns
    "aaaaaaaaaa",
    "abababababab",
    "123123123123",
    "....",
    "!!!!",
    "????",

    # Boundary cases
    "a b",
    "a  b",
    "a   b",
    " a",
    "a ",
    " a ",
]


def generate_fixtures(model_path, output_path, model_name):
    """Generate test fixtures for a single model."""
    print(f"Loading model: {model_path}")
    sp = spm.SentencePieceProcessor()
    sp.Load(model_path)

    fixtures = {
        "model_name": model_name,
        "model_path": str(model_path),
        "vocab_size": sp.GetPieceSize(),
        "encode_fixtures": [],
        "decode_fixtures": [],
        "roundtrip_fixtures": [],
    }

    # Add some vocab info
    fixtures["special_tokens"] = {
        "unk_id": sp.unk_id() if hasattr(sp, "unk_id") else sp.PieceToId("<unk>"),
        "bos_id": sp.bos_id() if hasattr(sp, "bos_id") else -1,
        "eos_id": sp.eos_id() if hasattr(sp, "eos_id") else -1,
        "pad_id": sp.pad_id() if hasattr(sp, "pad_id") else -1,
    }

    success_count = 0
    error_count = 0

    for text in TEST_CASES:
        try:
            ids = sp.EncodeAsIds(text)
            pieces = sp.EncodeAsPieces(text)
            decoded = sp.DecodeIds(ids)

            fixtures["encode_fixtures"].append({
                "input": text,
                "expected_ids": ids,
                "expected_pieces": pieces,
            })

            fixtures["decode_fixtures"].append({
                "input_ids": ids,
                "expected": decoded,
            })

            # Roundtrip check
            roundtrip_ok = (decoded == text) or (text == "" and decoded == "")
            fixtures["roundtrip_fixtures"].append({
                "original": text,
                "encoded": ids,
                "decoded": decoded,
                "roundtrip_ok": roundtrip_ok,
            })

            success_count += 1

        except Exception as e:
            print(f"  Warning: Failed to process {repr(text)[:50]}: {e}", file=sys.stderr)
            error_count += 1

    # Write fixtures
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(fixtures, f, indent=2, ensure_ascii=False)

    print(f"  Generated {success_count} fixtures to {output_path}")
    if error_count > 0:
        print(f"  ({error_count} test cases failed)")
    print(f"  Vocab size: {fixtures['vocab_size']}")


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    models_dir = project_root / "tests" / ".models"
    fixtures_dir = project_root / "tests" / "fixtures"

    # Model configurations
    models = [
        {
            "name": "t5",
            "filename": "t5-tokenizer.model",
            "output": "t5-golden.json",
        },
        {
            "name": "albert",
            "filename": "albert-tokenizer.model",
            "output": "albert-golden.json",
        },
        {
            "name": "xlnet",
            "filename": "xlnet-tokenizer.model",
            "output": "xlnet-golden.json",
        },
    ]

    generated = 0

    for model in models:
        model_path = models_dir / model["filename"]
        output_path = fixtures_dir / model["output"]

        if not model_path.exists():
            print(f"Skipping {model['name']}: Model not found at {model_path}")
            continue

        print(f"\n{'='*60}")
        print(f"Generating fixtures for {model['name']}")
        print(f"{'='*60}")

        generate_fixtures(str(model_path), str(output_path), model["name"])
        generated += 1

    print(f"\n{'='*60}")
    print(f"Done! Generated fixtures for {generated} model(s)")
    print(f"{'='*60}")

    if generated == 0:
        print("\nNo models found. Please download model files first.")
        sys.exit(1)


if __name__ == "__main__":
    main()
