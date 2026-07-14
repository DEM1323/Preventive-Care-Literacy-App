#!/usr/bin/env python3
"""Generate a secure EXECUTION_TOKEN for PrevCare Google Apps Script."""

import argparse
import secrets
import sys


def generate_token(byte_length: int = 32) -> str:
    """Return a URL-safe random token suitable for EXECUTION_TOKEN."""
    if byte_length < 16:
        raise ValueError("byte_length must be at least 16 for adequate entropy")
    return secrets.token_urlsafe(byte_length)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a secure execution token for PrevCare GAS + .env"
    )
    parser.add_argument(
        "--bytes",
        type=int,
        default=32,
        help="Number of random bytes before encoding (default: 32)",
    )
    args = parser.parse_args()

    try:
        token = generate_token(args.bytes)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(token)
    print(
        "\nUse this same value in both places:\n"
        "  1. Google Apps Script → Project Settings → Script Properties → EXECUTION_TOKEN\n"
        "  2. .env → VITE_GAS_EXECUTION_TOKEN=<token>",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
