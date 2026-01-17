#!/usr/bin/env python3
"""
Generate golden test fixtures using OpenAI's tiktoken library.

These fixtures are committed to the repo and used as the source of truth
for testing our native BPE implementation. This script only needs to be
run when updating fixtures, not at runtime or in CI.

Requirements:
    pip install tiktoken

Usage:
    python scripts/fixtures/generate_tiktoken_fixtures.py
"""

import json
import tiktoken
from typing import Any

# All OpenAI encodings we support
ENCODINGS = [
    "r50k_base",
    "p50k_base",
    "p50k_edit",
    "cl100k_base",
    "o200k_base",
    # o200k_harmony uses same vocab as o200k_base, just different special tokens
]

def generate_encode_fixtures() -> list[dict[str, Any]]:
    """Generate basic encode/decode test cases for each encoding."""

    test_strings = [
        # Basic ASCII
        "hello",
        "hello world",
        "Hello, world!",
        "The quick brown fox jumps over the lazy dog.",

        # Numbers and punctuation
        "12345",
        "3.14159",
        "foo@bar.com",
        "https://example.com/path?query=value",

        # Whitespace variations
        "  leading spaces",
        "trailing spaces  ",
        "multiple   spaces",
        "tabs\there",
        "newline\nhere",
        "carriage\rreturn",
        "crlf\r\nending",

        # Unicode
        "Hello 世界",
        "Привет мир",
        "مرحبا بالعالم",
        "שלום עולם",
        "こんにちは世界",
        "안녕하세요 세계",

        # Emoji
        "Hello 👋",
        "🎉🎊🎁",
        "I ❤️ coding",
        "🇺🇸🇬🇧🇯🇵",
        "👨‍👩‍👧‍👦",  # Family emoji (ZWJ sequence)

        # Code-like strings
        "function foo() { return 42; }",
        "def hello():\n    print('world')",
        "SELECT * FROM users WHERE id = 1",
        "const x = { a: 1, b: 2 };",

        # Special token-like strings (should be treated as regular text)
        "<|endoftext|>",
        "<|im_start|>system<|im_sep|>",
        "<|fim_prefix|>code<|fim_suffix|>",

        # Edge cases
        "",  # Empty string
        " ",  # Single space
        "a",  # Single char
        "aa",  # Two chars
        "aaa",  # Three chars
        "\n",  # Just newline
        "\t",  # Just tab
        "🎉",  # Single emoji

        # Long repetitive patterns
        "a" * 100,
        "hello " * 20,
        "1234567890" * 10,

        # Mixed content
        "User: Hello!\nAssistant: Hi there! How can I help you today? 👋",
        "Error: FileNotFoundError at line 42 in /path/to/file.py",
        "JSON: {\"name\": \"John\", \"age\": 30, \"city\": \"NYC\"}",
    ]

    fixtures = []

    for encoding_name in ENCODINGS:
        enc = tiktoken.get_encoding(encoding_name)

        for text in test_strings:
            # Encode treating special tokens as regular text
            tokens = enc.encode(text, disallowed_special=())

            fixtures.append({
                "encoding": encoding_name,
                "text": text,
                "tokens": tokens,
                "tokenCount": len(tokens),
            })

    return fixtures


def generate_chat_completion_fixtures() -> list[dict[str, Any]]:
    """
    Generate chat completion token counting fixtures.

    These test cases cover:
    - Simple messages (system, user, assistant)
    - Messages with names
    - Function definitions
    - Function calls in messages
    - function_call control parameter
    """

    # Use o200k_base (gpt-4o's encoding) as the reference
    enc = tiktoken.get_encoding("o200k_base")

    def count_tokens(text: str) -> int:
        return len(enc.encode(text, disallowed_special=()))

    # Token overhead constants (these match OpenAI's actual behavior)
    MESSAGE_OVERHEAD = 3  # <|im_start|>, role, <|im_sep|>
    NAME_OVERHEAD = 1
    FUNCTION_ROLE_DISCOUNT = 2
    COMPLETION_OVERHEAD = 3  # Reply priming
    FUNCTION_CALL_METADATA_OVERHEAD = 3
    FUNCTION_CALL_NAME_OVERHEAD = 4
    FUNCTION_CALL_NONE_OVERHEAD = 1
    FUNCTION_DEF_OVERHEAD = 9
    SYSTEM_FUNCTION_DEDUCTION = 4

    def format_function_type(param: dict, indent: int = 0) -> str:
        """Format a parameter type for TypeScript."""
        ptype = param.get("type", "any")

        if ptype == "string":
            if "enum" in param:
                return " | ".join(json.dumps(v) for v in param["enum"])
            return "string"
        elif ptype in ("integer", "number"):
            if "enum" in param:
                return " | ".join(str(v) for v in param["enum"])
            return "number"
        elif ptype == "boolean":
            return "boolean"
        elif ptype == "null":
            return "null"
        elif ptype == "array":
            items = param.get("items", {})
            return f"{format_function_type(items, indent)}[]"
        elif ptype == "object":
            props = param.get("properties", {})
            if not props:
                return "{}"
            inner = format_object_properties(param, indent + 2)
            closing = " " * indent
            return f"{{\n{inner}\n{closing}}}"
        return "any"

    def format_object_properties(obj: dict, indent: int = 0) -> str:
        """Format object properties for TypeScript type definition."""
        props = obj.get("properties", {})
        if not props:
            return ""

        required = set(obj.get("required", []))
        indent_str = " " * indent
        lines = []

        for name, prop in props.items():
            if prop.get("description") and indent < 2:
                lines.append(f"{indent_str}// {prop['description']}")
            optional = "" if name in required else "?"
            formatted_type = format_function_type(prop, indent)
            lines.append(f"{indent_str}{name}{optional}: {formatted_type},")

        return "\n".join(lines)

    def format_function_definitions(functions: list[dict]) -> str:
        """Format function definitions as TypeScript namespace."""
        lines = ["namespace functions {", ""]

        for fn in functions:
            if fn.get("description"):
                lines.append(f"// {fn['description']}")

            params = fn.get("parameters", {})
            props = params.get("properties", {})

            if not params or not props:
                lines.append(f"type {fn['name']} = () => any;")
            else:
                lines.append(f"type {fn['name']} = (_: {{")
                formatted = format_object_properties(params, 0)
                if formatted:
                    lines.append(formatted)
                lines.append("}) => any;")
            lines.append("")

        lines.append("} // namespace functions")
        return "\n".join(lines)

    def count_message_tokens(msg: dict, has_functions: bool, is_first_system: bool) -> dict:
        """Count tokens for a single message."""
        string_tokens = 0
        overhead = MESSAGE_OVERHEAD

        # Role
        if msg.get("role"):
            string_tokens += count_tokens(msg["role"])

        # Content (with system padding for functions)
        content = msg.get("content") or ""
        if has_functions and msg.get("role") == "system" and is_first_system:
            if content and not content.endswith("\n"):
                content = content + "\n"
        if content:
            string_tokens += count_tokens(content)

        # Name
        if msg.get("name"):
            string_tokens += count_tokens(msg["name"])
            overhead += NAME_OVERHEAD

        # Function call in message
        if msg.get("function_call"):
            fc = msg["function_call"]
            if fc.get("name"):
                string_tokens += count_tokens(fc["name"])
            if fc.get("arguments"):
                string_tokens += count_tokens(fc["arguments"])
            overhead += FUNCTION_CALL_METADATA_OVERHEAD

        # Function role discount
        if msg.get("role") == "function":
            overhead -= FUNCTION_ROLE_DISCOUNT

        return {
            "stringTokens": string_tokens,
            "overhead": overhead,
            "total": string_tokens + overhead,
        }

    def count_chat_completion_tokens(
        messages: list[dict],
        functions: list[dict] | None = None,
        function_call: str | dict | None = None,
    ) -> dict:
        """Count total tokens for a chat completion request."""
        has_functions = bool(functions)
        has_system = any(m.get("role") == "system" for m in messages)

        # Count message tokens
        message_tokens = 0
        breakdown = []
        system_padded = False

        for msg in messages:
            is_first_system = (
                msg.get("role") == "system" and
                has_functions and
                not system_padded
            )
            if is_first_system:
                system_padded = True

            msg_result = count_message_tokens(msg, has_functions, is_first_system)
            message_tokens += msg_result["total"]
            breakdown.append({
                "role": msg.get("role"),
                **msg_result,
            })

        # Completion overhead
        completion_overhead = COMPLETION_OVERHEAD

        # Function definition tokens
        function_tokens = 0
        if has_functions:
            formatted = format_function_definitions(functions)
            function_tokens = count_tokens(formatted) + FUNCTION_DEF_OVERHEAD
            if has_system:
                function_tokens -= SYSTEM_FUNCTION_DEDUCTION

        # function_call control tokens
        function_call_tokens = 0
        if function_call and function_call != "auto":
            if function_call == "none":
                function_call_tokens = FUNCTION_CALL_NONE_OVERHEAD
            elif isinstance(function_call, dict) and function_call.get("name"):
                function_call_tokens = (
                    count_tokens(function_call["name"]) +
                    FUNCTION_CALL_NAME_OVERHEAD
                )

        total = (
            message_tokens +
            completion_overhead +
            function_tokens +
            function_call_tokens
        )

        return {
            "totalTokens": total,
            "messageTokens": message_tokens,
            "completionOverheadTokens": completion_overhead,
            "functionTokens": function_tokens,
            "functionCallTokens": function_call_tokens,
            "messageBreakdown": breakdown,
        }

    # Test cases
    test_cases = [
        # Simple messages
        {
            "messages": [
                {"role": "system", "content": "You are a helpful, pattern-following assistant that translates corporate jargon into plain English."},
            ],
        },
        {
            "messages": [
                {"role": "system", "name": "example_user", "content": "New synergies will help drive top-line growth."},
            ],
        },
        {
            "messages": [
                {"role": "system", "name": "example_assistant", "content": "Things working well together will increase revenue."},
            ],
        },
        {
            "messages": [
                {"role": "system", "name": "example_user", "content": "Let's circle back when we have more bandwidth to touch base on opportunities for increased leverage."},
            ],
        },
        {
            "messages": [
                {"role": "system", "name": "example_assistant", "content": "Let's talk later when we're less busy about how to do better."},
            ],
        },
        {
            "messages": [
                {"role": "user", "content": "This late pivot means we don't have time to boil the ocean for the client deliverable."},
            ],
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
        },
        {
            "messages": [{"role": "user", "content": "hello world"}],
        },
        {
            "messages": [{"role": "system", "content": "hello"}],
        },
        {
            "messages": [{"role": "system", "content": "hello:"}],
        },
        {
            "messages": [
                {"role": "system", "content": "# Important: you're the best robot"},
                {"role": "user", "content": "hello robot"},
                {"role": "assistant", "content": "hello world"},
            ],
        },

        # With functions
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {"name": "foo", "parameters": {"type": "object", "properties": {}}},
            ],
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {"name": "foo", "parameters": {"type": "object", "properties": {}}},
            ],
            "function_call": "none",
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {"name": "foo", "parameters": {"type": "object", "properties": {}}},
            ],
            "function_call": "auto",
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {"name": "foo", "parameters": {"type": "object", "properties": {}}},
            ],
            "function_call": {"name": "foo"},
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {"name": "foo", "description": "Do a foo", "parameters": {"type": "object", "properties": {}}},
            ],
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {
                    "name": "bing_bong",
                    "description": "Do a bing bong",
                    "parameters": {
                        "type": "object",
                        "properties": {"foo": {"type": "string"}},
                    },
                },
            ],
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {
                    "name": "bing_bong",
                    "description": "Do a bing bong",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "foo": {"type": "string"},
                            "bar": {"type": "number", "description": "A number"},
                        },
                    },
                },
            ],
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {
                    "name": "bing_bong",
                    "description": "Do a bing bong",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "foo": {
                                "type": "object",
                                "properties": {
                                    "bar": {"type": "string", "enum": ["a", "b", "c"]},
                                    "baz": {"type": "boolean"},
                                },
                            },
                        },
                    },
                },
            ],
        },

        # Function role messages
        {
            "messages": [
                {"role": "user", "content": "hello world"},
                {"role": "function", "name": "do_stuff", "content": "{}"},
            ],
        },
        {
            "messages": [
                {"role": "user", "content": "hello world"},
                {"role": "function", "name": "do_stuff", "content": '{"foo": "bar", "baz": 1.5}'},
            ],
        },
        {
            "messages": [
                {"role": "function", "name": "dance_the_tango", "content": '{"a": { "b" : { "c": false}}}'},
            ],
        },

        # Assistant with function_call
        {
            "messages": [
                {
                    "role": "assistant",
                    "content": "",
                    "function_call": {"name": "do_stuff", "arguments": '{"foo": "bar", "baz": 1.5}'},
                },
            ],
        },
        {
            "messages": [
                {
                    "role": "assistant",
                    "content": "",
                    "function_call": {"name": "do_stuff", "arguments": '{"foo":"bar", "baz":\n\n 1.5}'},
                },
            ],
        },

        # Messages with functions
        {
            "messages": [
                {"role": "system", "content": "Hello"},
                {"role": "user", "content": "Hi there"},
            ],
            "functions": [
                {"name": "do_stuff", "parameters": {"type": "object", "properties": {}}},
            ],
        },
        {
            "messages": [
                {"role": "system", "content": "Hello:"},
                {"role": "user", "content": "Hi there"},
            ],
            "functions": [
                {"name": "do_stuff", "parameters": {"type": "object", "properties": {}}},
            ],
        },
        {
            "messages": [
                {"role": "system", "content": "Hello:"},
                {"role": "system", "content": "Hello"},
                {"role": "user", "content": "Hi there"},
            ],
            "functions": [
                {"name": "do_stuff", "parameters": {"type": "object", "properties": {}}},
            ],
        },
        {
            "messages": [
                {"role": "system", "content": "Hello:"},
                {"role": "system", "content": "Hello"},
                {"role": "user", "content": "Hi there"},
            ],
            "functions": [
                {"name": "do_stuff", "parameters": {"type": "object", "properties": {}}},
                {"name": "do_other_stuff", "parameters": {"type": "object", "properties": {}}},
            ],
        },
        {
            "messages": [
                {"role": "system", "content": "Hello:"},
                {"role": "system", "content": "Hello"},
                {"role": "user", "content": "Hi there"},
            ],
            "functions": [
                {"name": "do_stuff", "parameters": {"type": "object", "properties": {}}},
                {"name": "do_other_stuff", "parameters": {"type": "object", "properties": {}}},
            ],
            "function_call": {"name": "do_stuff"},
        },

        # Complex function with nested objects and arrays
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {
                    "name": "get_recipe",
                    "parameters": {
                        "type": "object",
                        "required": ["ingredients", "instructions", "time_to_cook"],
                        "properties": {
                            "ingredients": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "required": ["name", "unit", "amount"],
                                    "properties": {
                                        "name": {"type": "string"},
                                        "unit": {"type": "string", "enum": ["grams", "ml", "cups", "pieces", "teaspoons"]},
                                        "amount": {"type": "number"},
                                    },
                                },
                            },
                            "instructions": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Steps to prepare the recipe (no numbering)",
                            },
                            "time_to_cook": {
                                "type": "number",
                                "description": "Total time to prepare the recipe in minutes",
                            },
                        },
                    },
                },
            ],
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {
                    "name": "function",
                    "description": "description",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "quality": {
                                "type": "object",
                                "properties": {
                                    "pros": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                        "description": "Write 3 points why this text is well written",
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        },
        {
            "messages": [{"role": "user", "content": "hello"}],
            "functions": [
                {
                    "name": "function",
                    "description": "desctiption1",
                    "parameters": {
                        "type": "object",
                        "description": "desctiption2",
                        "properties": {
                            "mainField": {"type": "string", "description": "description3"},
                            "field number one": {
                                "type": "object",
                                "description": "description4",
                                "properties": {
                                    "yesNoField": {"type": "string", "description": "description5", "enum": ["Yes", "No"]},
                                    "howIsInteresting": {"type": "string", "description": "description6"},
                                    "scoreInteresting": {"type": "number", "description": "description7"},
                                    "isInteresting": {"type": "string", "description": "description8", "enum": ["Yes", "No"]},
                                },
                            },
                        },
                    },
                },
            ],
        },
    ]

    fixtures = []
    for tc in test_cases:
        result = count_chat_completion_tokens(
            tc["messages"],
            tc.get("functions"),
            tc.get("function_call"),
        )
        fixtures.append({
            "input": tc,
            "expected": result,
        })

    return fixtures


def main():
    print("Generating tiktoken golden fixtures...")
    print(f"tiktoken version: {tiktoken.__version__}")

    # Generate encode fixtures
    encode_fixtures = generate_encode_fixtures()
    print(f"Generated {len(encode_fixtures)} encode fixtures")

    # Generate chat completion fixtures
    chat_fixtures = generate_chat_completion_fixtures()
    print(f"Generated {len(chat_fixtures)} chat completion fixtures")

    # Combine into output
    output = {
        "generatedWith": f"tiktoken {tiktoken.__version__}",
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "encodeFixtures": encode_fixtures,
        "chatCompletionFixtures": chat_fixtures,
    }

    # Write to JSON file
    output_path = "tests/fixtures/tiktoken-golden.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Written to {output_path}")
    print("Done!")


if __name__ == "__main__":
    main()
