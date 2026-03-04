#!/usr/bin/env python3
"""
VersusThat — Batch Intro & FAQ Generator
Adds comparison_intro and missing required FAQs to existing articles.

Usage:
    python scripts/add_intros.py
    python scripts/add_intros.py --dry-run

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

MODEL = "claude-haiku-4-5-20251001"

INTRO_PROMPT = """Generate a comparison_intro paragraph for a product comparison page.

Product A: {item_a_name}
Product B: {item_b_name}
Category: {category}
Verdict: {verdict_text}

Write a 2-3 sentence opening paragraph that MUST naturally include ALL of these phrasings woven into real sentences:
- "{item_a_name} vs {item_b_name}"
- "{item_a_name} or {item_b_name}"
- "which is better" (referring to the two products)
- "difference between {item_a_name} and {item_b_name}"
- "{item_a_name} compared to {item_b_name}"

This paragraph appears at the top of the comparison page and needs to sound natural and helpful, not keyword-stuffed. It should make the reader want to keep reading.

BANNED WORDS: ultimately, comprehensive, robust, seamless, intuitive, significant, substantial, crucial, essential, notably, remarkably, conversely, furthermore, moreover, delve, navigate, elevate

Return ONLY the paragraph text, nothing else. No quotes, no labels, no JSON."""

FAQ_PROMPT = """Generate FAQ entries for a product comparison page.

Product A: {item_a_name}
Product B: {item_b_name}
Verdict: {verdict_text}
Summary: {comparison_summary}

Generate ONLY the following missing FAQ entries as a JSON array:
{missing_faqs_description}

Each entry should have "q" and "a" fields. Answers should be 2-3 sentences, direct and opinionated.

Return ONLY a valid JSON array like: [{{"q": "...", "a": "..."}}]
No markdown, no explanation."""


def has_faq_pattern(faqs, item_a_name, item_b_name, pattern_type):
    """Check if any FAQ matches a required pattern."""
    a_lower = item_a_name.lower()
    b_lower = item_b_name.lower()

    for faq in faqs:
        q = faq.get("q", "").lower()
        has_both = a_lower in q and b_lower in q

        if pattern_type == "better_than" and has_both and "better" in q:
            return True
        elif pattern_type == "should_buy" and has_both and ("should" in q) and ("buy" in q or "get" in q):
            return True
        elif pattern_type == "difference" and has_both and ("difference" in q):
            return True

    return False


def get_missing_faqs(faqs, item_a_name, item_b_name):
    """Return list of missing required FAQ patterns."""
    missing = []

    if not has_faq_pattern(faqs, item_a_name, item_b_name, "better_than"):
        missing.append(f'- "Is {item_a_name} better than {item_b_name}?"')

    if not has_faq_pattern(faqs, item_a_name, item_b_name, "should_buy"):
        missing.append(f'- "Should I buy {item_a_name} or {item_b_name}?"')

    if not has_faq_pattern(faqs, item_a_name, item_b_name, "difference"):
        missing.append(f'- "What is the difference between {item_a_name} and {item_b_name}?"')

    return missing


def process_article(client, data, dry_run=False):
    """Add comparison_intro and missing FAQs to an article. Returns True if modified."""
    item_a_name = data.get("item_a", {}).get("name", "")
    item_b_name = data.get("item_b", {}).get("name", "")
    category = data.get("category", "general")
    verdict_text = data.get("verdict_text", "")
    comparison_summary = data.get("comparison_summary", "")
    faqs = data.get("faq", [])

    modified = False

    # --- Add comparison_intro ---
    if not data.get("comparison_intro"):
        if dry_run:
            print(f"    Would generate intro")
        else:
            prompt = INTRO_PROMPT.format(
                item_a_name=item_a_name,
                item_b_name=item_b_name,
                category=category,
                verdict_text=verdict_text,
            )

            message = client.messages.create(
                model=MODEL,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )

            intro = message.content[0].text.strip()
            # Remove surrounding quotes if present
            if (intro.startswith('"') and intro.endswith('"')) or (intro.startswith("'") and intro.endswith("'")):
                intro = intro[1:-1]

            data["comparison_intro"] = intro
            modified = True
            print(f"    Added intro ({len(intro)} chars)")

        time.sleep(0.5)
    else:
        print(f"    Skipping intro (already has one)")

    # --- Add missing FAQs ---
    missing = get_missing_faqs(faqs, item_a_name, item_b_name)

    if missing:
        if dry_run:
            print(f"    Would add {len(missing)} missing FAQ(s): {', '.join(missing)}")
        else:
            prompt = FAQ_PROMPT.format(
                item_a_name=item_a_name,
                item_b_name=item_b_name,
                verdict_text=verdict_text,
                comparison_summary=comparison_summary,
                missing_faqs_description="\n".join(missing),
            )

            message = client.messages.create(
                model=MODEL,
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = message.content[0].text.strip()

            # Strip markdown fences if present
            if response_text.startswith("```"):
                response_text = re.sub(r"^```(?:json)?\n?", "", response_text)
                response_text = re.sub(r"\n?```$", "", response_text)

            new_faqs = json.loads(response_text)

            if isinstance(new_faqs, list):
                data["faq"] = faqs + new_faqs
                modified = True
                print(f"    Added {len(new_faqs)} FAQ(s)")

            time.sleep(0.5)
    else:
        print(f"    All required FAQs present")

    return modified


def main():
    parser = argparse.ArgumentParser(description="Add comparison_intro and missing FAQs to existing articles")
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

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Processing {total} articles...\n")

    client = anthropic.Anthropic() if not args.dry_run else None
    today = date.today().isoformat()
    updated = 0
    skipped = 0
    failed = 0

    for i, path in enumerate(json_files, 1):
        slug = path.stem
        print(f"[{i}/{total}] Adding intro to {slug}.json...")

        try:
            with open(path) as f:
                data = json.load(f)

            modified = process_article(client, data, dry_run=args.dry_run)

            if modified and not args.dry_run:
                data["date_updated"] = today
                with open(path, "w") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                updated += 1
            elif args.dry_run:
                updated += 1
            else:
                skipped += 1

        except Exception as e:
            print(f"    Error: {e}")
            failed += 1

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Complete: {updated} updated, {skipped} skipped, {failed} failed")


if __name__ == "__main__":
    main()
