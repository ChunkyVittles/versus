#!/usr/bin/env python3
"""
VersusThat — Batch Article Rewriter
Rewrites existing comparison articles to sound more natural and less formulaic.

Usage:
    python scripts/rewrite_articles.py
    python scripts/rewrite_articles.py --dry-run

Requires ANTHROPIC_API_KEY environment variable.
"""

import argparse
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent.parent
COMPARISONS_DIR = ROOT / "data" / "comparisons"

MODEL = "claude-sonnet-4-5-20250929"

REWRITE_PROMPT = """You are rewriting product comparison content to sound more natural and less formulaic.

Here is the current content as JSON:
{content_json}

Rewrite ONLY these fields and return them as JSON:
- "seo_content": Rewrite to sound like a specific knowledgeable person. Use occasional first person. Vary sentence and paragraph length. The content should be {target_length} words (vary this naturally, don't hit it exactly). IMPORTANT: preserve all factual claims, numbers, specs, and prices from the original — just change the writing style.
- "meta_title": Keep the same structure but change the ending. Do NOT use "Which Should You Buy?" — use a specific angle relevant to this comparison.
- "verdict_text": Make it punchier and more opinionated. One sentence.
- "comparison_summary": Rewrite to sound less formulaic. 2-3 sentences.
- "faq": Keep the same questions but rewrite answers to be more conversational and direct.

BANNED WORDS — do not use any of these in any field: ultimately, comprehensive, robust, seamless, intuitive, significant, substantial, crucial, essential, notably, remarkably, conversely, furthermore, moreover, game-changer, stands out, remains one of, dive into, let's explore, delve, navigate, elevate, testament to, it's worth noting, whether you're looking, in today's, in the world of, at the end of the day, boils down to, when it comes to, the bottom line, however (use "but" instead)

Return ONLY valid JSON with these 5 fields. No markdown fences, no explanation."""

# Category -> target word count mapping
SIMPLE_CATEGORIES = {"blenders", "headphones", "vacuums", "coffee-makers", "air-fryers"}
TECH_CATEGORIES = {"smartphones", "laptops", "tablets", "cameras", "gaming-consoles", "tvs", "routers", "fitness-trackers"}
COMPLEX_CATEGORIES = {"financial", "education", "services", "cars", "streaming"}


def get_target_length(category):
    if category in SIMPLE_CATEGORIES:
        return 280
    elif category in TECH_CATEGORIES:
        return 420
    elif category in COMPLEX_CATEGORIES:
        return 580
    else:
        return 420  # default to tech length


def rewrite_article(client, data, dry_run=False):
    """Rewrite a single article's content fields."""
    category = data.get("category", "general")
    target_length = get_target_length(category)

    # Extract the 5 fields to rewrite
    content_to_rewrite = {
        "seo_content": data.get("seo_content", ""),
        "meta_title": data.get("meta_title", ""),
        "verdict_text": data.get("verdict_text", ""),
        "comparison_summary": data.get("comparison_summary", ""),
        "faq": data.get("faq", []),
    }

    prompt = REWRITE_PROMPT.format(
        content_json=json.dumps(content_to_rewrite, indent=2),
        target_length=target_length,
    )

    if dry_run:
        print(f"    Would rewrite with target_length={target_length} (category: {category})")
        return None

    message = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    # Strip markdown fences if present
    if response_text.startswith("```"):
        import re
        response_text = re.sub(r"^```(?:json)?\n?", "", response_text)
        response_text = re.sub(r"\n?```$", "", response_text)

    rewritten = json.loads(response_text)

    # Validate we got the expected fields
    expected_fields = {"seo_content", "meta_title", "verdict_text", "comparison_summary", "faq"}
    if not expected_fields.issubset(rewritten.keys()):
        missing = expected_fields - rewritten.keys()
        raise ValueError(f"Missing fields in response: {missing}")

    return rewritten


def main():
    parser = argparse.ArgumentParser(description="Batch rewrite existing comparison articles")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        sys.exit(1)

    if not COMPARISONS_DIR.exists():
        print(f"Error: Comparisons directory not found: {COMPARISONS_DIR}")
        sys.exit(1)

    json_files = sorted(COMPARISONS_DIR.glob("*.json"))
    total = len(json_files)

    if total == 0:
        print("No comparison files found.")
        return

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Rewriting {total} articles...\n")

    client = anthropic.Anthropic() if not args.dry_run else None
    today = date.today().isoformat()
    success = 0
    failed = 0

    for i, path in enumerate(json_files, 1):
        slug = path.stem
        print(f"[{i}/{total}] Rewriting {slug}.json...")

        try:
            with open(path) as f:
                data = json.load(f)

            rewritten = rewrite_article(client, data, dry_run=args.dry_run)

            if args.dry_run:
                success += 1
                continue

            # Merge rewritten fields back into original data
            data["seo_content"] = rewritten["seo_content"]
            data["meta_title"] = rewritten["meta_title"]
            data["verdict_text"] = rewritten["verdict_text"]
            data["comparison_summary"] = rewritten["comparison_summary"]
            data["faq"] = rewritten["faq"]
            data["date_updated"] = today

            with open(path, "w") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            print(f"    Done.")
            success += 1

        except Exception as e:
            print(f"    Error: {e}")
            failed += 1

        # Rate limit delay between API calls
        if i < total and not args.dry_run:
            time.sleep(1)

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Complete: {success} rewritten, {failed} failed")


if __name__ == "__main__":
    main()
