#!/usr/bin/env python3
"""
VersusThat — Comparison Content Generator
Generates comparisons via the live API and saves results as static JSON files.

Usage:
    python scripts/generate_comparison.py                          # Generate all from top100_affiliates.txt
    python scripts/generate_comparison.py --query "X vs Y"         # Single comparison
    python scripts/generate_comparison.py --file custom.txt        # Custom input file
    python scripts/generate_comparison.py --dry-run                # Preview without generating
    python scripts/generate_comparison.py --no-skip-existing       # Regenerate even if file exists
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

# Try using requests, fall back to urllib
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    import urllib.error
    import ssl
    HAS_REQUESTS = False

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
COMPARISONS_DIR = DATA_DIR / "comparisons"

# Default API endpoint — use the live site
API_URL = "https://versusthat.com/api/compare"


def make_slug(query):
    """Generate alphabetically-ordered slug from a comparison query."""
    match = re.match(r'(.+?)\s+(?:vs\.?|versus)\s+(.+)', query, re.I)
    if not match:
        return None
    a = re.sub(r'[^a-z0-9]+', '-', match.group(1).strip().lower()).strip('-')
    b = re.sub(r'[^a-z0-9]+', '-', match.group(2).strip().lower()).strip('-')
    if a > b:
        a, b = b, a
    return f"{a}-vs-{b}"


def load_queries(filepath):
    """Load comparison queries from a text file (one per line, # comments ok)."""
    queries = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            # Support both "X vs Y" and "X vs Y | category" formats
            if '|' in line:
                line = line.split('|')[0].strip()
            if ' vs ' not in line.lower() and ' versus ' not in line.lower():
                continue
            queries.append(line)
    return queries


def generate_comparison(query, api_url=API_URL):
    """Call the comparison API and return the result."""
    payload = json.dumps({"query": query})

    if HAS_REQUESTS:
        try:
            resp = requests.post(api_url, json={"query": query}, timeout=120)
            data = resp.json()
            if resp.status_code != 200:
                return None, data.get("error", f"HTTP {resp.status_code}")
            return data, None
        except Exception as e:
            return None, str(e)
    else:
        try:
            ctx = ssl.create_default_context()
            req = urllib.request.Request(
                api_url,
                data=payload.encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
                data = json.loads(resp.read().decode())
            return data, None
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            try:
                err = json.loads(body).get("error", f"HTTP {e.code}")
            except Exception:
                err = f"HTTP {e.code}: {body[:200]}"
            return None, err
        except Exception as e:
            return None, str(e)


def save_comparison(slug, comp_data):
    """Save comparison data to a JSON file."""
    COMPARISONS_DIR.mkdir(parents=True, exist_ok=True)
    filepath = COMPARISONS_DIR / f"{slug}.json"
    with open(filepath, 'w') as f:
        json.dump(comp_data, f, indent=2)
    return filepath


def main():
    parser = argparse.ArgumentParser(description="Generate comparisons for VersusThat")
    parser.add_argument('--file', default=str(DATA_DIR / 'top100_affiliates.txt'),
                        help='Path to text file with comparison queries')
    parser.add_argument('--query', help='Generate a single comparison')
    parser.add_argument('--api-url', default=API_URL, help='API endpoint URL')
    parser.add_argument('--dry-run', action='store_true', help='Preview queries without generating')
    parser.add_argument('--skip-existing', action='store_true', default=True,
                        help='Skip comparisons that already have JSON files (default: True)')
    parser.add_argument('--no-skip-existing', dest='skip_existing', action='store_false',
                        help='Regenerate even if JSON file exists')
    parser.add_argument('--delay', type=int, default=5,
                        help='Seconds to wait between API calls (default: 5)')
    args = parser.parse_args()

    if args.query:
        queries = [args.query]
    else:
        if not os.path.exists(args.file):
            print(f"Error: File not found: {args.file}")
            sys.exit(1)
        queries = load_queries(args.file)

    print(f"Loaded {len(queries)} comparison queries")

    # Preview
    skipped = 0
    to_generate = []
    for q in queries:
        slug = make_slug(q)
        if not slug:
            print(f"  SKIP (bad format): {q}")
            skipped += 1
            continue
        filepath = COMPARISONS_DIR / f"{slug}.json"
        if args.skip_existing and filepath.exists():
            print(f"  EXISTS: {slug}")
            skipped += 1
            continue
        to_generate.append((q, slug))

    print(f"\nTo generate: {len(to_generate)} | Skipped: {skipped}")

    if args.dry_run:
        print("\n--- DRY RUN ---")
        for q, slug in to_generate:
            print(f"  WOULD GENERATE: {q} -> {slug}")
        return

    if not to_generate:
        print("Nothing to generate!")
        return

    print(f"\nStarting generation (delay: {args.delay}s between calls)...\n")

    success = 0
    failed = 0
    for i, (query, slug) in enumerate(to_generate):
        print(f"[{i+1}/{len(to_generate)}] Generating: {query} ({slug})...")

        result, error = generate_comparison(query, args.api_url)

        if error:
            print(f"  FAILED: {error}")
            failed += 1
            time.sleep(args.delay)
            continue

        if not result or result.get("error"):
            print(f"  FAILED: {result.get('error', 'Unknown error') if result else 'No response'}")
            failed += 1
            time.sleep(args.delay)
            continue

        comp_data = result.get("data")
        actual_slug = result.get("slug", slug)

        if not comp_data:
            print(f"  FAILED: No data in response")
            failed += 1
            time.sleep(args.delay)
            continue

        filepath = save_comparison(actual_slug, comp_data)
        cached = result.get("cached", False)
        print(f"  OK: Saved to {filepath} {'(cached)' if cached else '(new)'}")
        success += 1

        if i < len(to_generate) - 1:
            time.sleep(args.delay)

    print(f"\nDone! Generated: {success} | Failed: {failed} | Skipped: {skipped}")


if __name__ == "__main__":
    main()
