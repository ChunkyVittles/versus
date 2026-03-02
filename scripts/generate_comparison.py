#!/usr/bin/env python3
"""
VersusThat — Comparison Content Generator
Uses Claude API to generate comparison data from a keyword pair.

Usage:
    python scripts/generate_comparison.py "ninja vs vitamix" --category blenders
    python scripts/generate_comparison.py --batch data/seed_comparisons.txt

Requires ANTHROPIC_API_KEY environment variable.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent.parent
COMPARISONS_DIR = ROOT / "data" / "comparisons"

MODEL = "claude-sonnet-4-5-20250929"


def make_slug(keyword):
    """Convert 'Ninja vs Vitamix' to 'ninja-vs-vitamix' with alphabetical ordering."""
    keyword = keyword.lower().strip()
    # Extract the two items
    match = re.match(r"(.+?)\s+vs\.?\s+(.+)", keyword)
    if not match:
        print(f"Error: Could not parse '{keyword}'. Expected 'X vs Y' format.")
        sys.exit(1)

    item_a = match.group(1).strip()
    item_b = match.group(2).strip()

    # Slugify each part
    slug_a = re.sub(r"[^a-z0-9]+", "-", item_a).strip("-")
    slug_b = re.sub(r"[^a-z0-9]+", "-", item_b).strip("-")

    # Alphabetical order
    if slug_a > slug_b:
        slug_a, slug_b = slug_b, slug_a

    return f"{slug_a}-vs-{slug_b}"


def generate_comparison(keyword, category):
    """Call Claude API to generate comparison JSON data."""
    client = anthropic.Anthropic()
    today = date.today().isoformat()
    slug = make_slug(keyword)

    prompt = f"""You are a product comparison expert writing for VersusThat.com. Generate a detailed, objective comparison for: "{keyword}" in the "{category}" category.

Return ONLY valid JSON matching this exact structure (no markdown, no code fences, just raw JSON):

{{
  "slug": "{slug}",
  "item_a": {{
    "name": "Full product name for item A",
    "brand": "Brand name",
    "image_alt": "Descriptive alt text for product image",
    "pros": ["Pro 1", "Pro 2", "Pro 3", "Pro 4"],
    "cons": ["Con 1", "Con 2", "Con 3"],
    "price_range": "$XX-$XX",
    "best_for": "One sentence describing who this product is best for",
    "rating": 4.2,
    "affiliate_url": ""
  }},
  "item_b": {{
    "name": "Full product name for item B",
    "brand": "Brand name",
    "image_alt": "Descriptive alt text for product image",
    "pros": ["Pro 1", "Pro 2", "Pro 3", "Pro 4"],
    "cons": ["Con 1", "Con 2", "Con 3"],
    "price_range": "$XX-$XX",
    "best_for": "One sentence describing who this product is best for",
    "rating": 4.5,
    "affiliate_url": ""
  }},
  "category": "{category}",
  "comparison_summary": "2-3 sentence summary of the comparison and our recommendation.",
  "verdict": "a" or "b" or "tie",
  "verdict_text": "One-sentence verdict that includes both product names",
  "key_differences": [
    {{"aspect": "Feature Name", "item_a": "Value for A", "item_b": "Value for B", "winner": "a" or "b" or "tie"}},
    ... (include 6-8 key differences with real specs and data)
  ],
  "seo_content": "300-500 words of editorial content...",
  "faq": [
    {{"q": "Question?", "a": "Answer."}},
    ... (3-5 FAQs)
  ],
  "related_comparisons": ["slug-1-vs-slug-2", "slug-3-vs-slug-4", "slug-5-vs-slug-6"],
  "meta_title": "Item A vs Item B (2026): Which Should You Buy?",
  "meta_description": "Detailed comparison of Item A vs Item B. We break down [key aspects] to help you pick the right [category].",
  "date_published": "{today}",
  "date_updated": "{today}"
}}

IMPORTANT GUIDELINES:
- Use REAL product specifications, prices, and data. Be accurate.
- The slug must be alphabetically ordered (e.g., airpods-vs-galaxy-buds NOT galaxy-buds-vs-airpods). I've computed it for you: "{slug}"
- item_a should be the alphabetically first product in the slug, item_b the second
- Ratings should be realistic (3.5-4.9 range), based on typical consumer ratings
- Price ranges should reflect current market prices
- The seo_content should be substantial (300-500 words), written in an authoritative but accessible tone. Naturally include both "[A] vs [B]" and "[B] vs [A]" phrasings. Discuss use cases, value proposition, and buying advice.
- FAQs should be genuine questions people search for about this comparison
- Related comparisons should be real product matchups in the same category (use alphabetically-ordered slugs)
- Be objective and data-driven. Both products have merits — explain the tradeoffs clearly.
- The verdict should have a clear winner with a nuanced explanation (not just "X is better")
- meta_title should include the current year (2026)
- key_differences should include real specs (wattage, weight, dimensions, battery life, etc.) not vague descriptions"""

    print(f"  Calling Claude API for '{keyword}'...")

    message = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    # Clean up response — remove any markdown fences if present
    if response_text.startswith("```"):
        response_text = re.sub(r"^```(?:json)?\n?", "", response_text)
        response_text = re.sub(r"\n?```$", "", response_text)

    try:
        data = json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"  Error: Failed to parse JSON response: {e}")
        print(f"  Response preview: {response_text[:200]}...")
        return None

    # Validate required fields
    required = ["slug", "item_a", "item_b", "category", "verdict", "verdict_text", "key_differences"]
    for field in required:
        if field not in data:
            print(f"  Error: Missing required field '{field}'")
            return None

    # Enforce slug
    data["slug"] = slug

    return data


def save_comparison(data):
    """Save comparison JSON to data/comparisons/"""
    COMPARISONS_DIR.mkdir(parents=True, exist_ok=True)
    path = COMPARISONS_DIR / f"{data['slug']}.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved: {path}")
    return path


def run_single(keyword, category):
    """Generate and save a single comparison."""
    slug = make_slug(keyword)
    output_path = COMPARISONS_DIR / f"{slug}.json"

    if output_path.exists():
        print(f"  Skipping '{keyword}' — already exists at {output_path}")
        return True

    data = generate_comparison(keyword, category)
    if data:
        save_comparison(data)
        return True
    return False


def run_batch(batch_file):
    """Process a batch file of comparisons."""
    path = Path(batch_file)
    if not path.exists():
        print(f"Error: Batch file not found: {batch_file}")
        sys.exit(1)

    lines = path.read_text().strip().split("\n")
    total = len(lines)
    success = 0
    skipped = 0
    failed = 0

    print(f"Processing {total} comparisons from {batch_file}...\n")

    for i, line in enumerate(lines, 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        parts = line.split("|")
        if len(parts) != 2:
            print(f"  [{i}/{total}] Skipping malformed line: {line}")
            skipped += 1
            continue

        keyword, category = parts[0].strip(), parts[1].strip()
        print(f"[{i}/{total}] {keyword} ({category})")

        slug = make_slug(keyword)
        output_path = COMPARISONS_DIR / f"{slug}.json"
        if output_path.exists():
            print(f"  Skipping — already exists")
            skipped += 1
            continue

        try:
            data = generate_comparison(keyword, category)
            if data:
                save_comparison(data)
                success += 1
            else:
                failed += 1
        except Exception as e:
            print(f"  Error: {e}")
            failed += 1

        # Rate limiting — be polite to the API
        if i < total:
            time.sleep(1)

    print(f"\nBatch complete: {success} generated, {skipped} skipped, {failed} failed")


def main():
    parser = argparse.ArgumentParser(description="Generate comparison content using Claude API")
    parser.add_argument("keyword", nargs="?", help='Comparison keyword, e.g. "ninja vs vitamix"')
    parser.add_argument("--category", "-c", help="Category slug, e.g. blenders")
    parser.add_argument("--batch", "-b", help="Path to batch file (one comparison per line: keyword|category)")

    args = parser.parse_args()

    # Check API key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        sys.exit(1)

    if args.batch:
        run_batch(args.batch)
    elif args.keyword:
        if not args.category:
            print("Error: --category is required when generating a single comparison.")
            sys.exit(1)
        run_single(args.keyword, args.category)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
