#!/usr/bin/env python3
"""Backfill related_comparisons so every page has at least 3-5 links."""
import json
from pathlib import Path
from collections import defaultdict

COMP_DIR = Path(__file__).resolve().parent.parent / "data" / "comparisons"

# Load all comparisons
all_data = {}
by_cat = defaultdict(list)
for f in COMP_DIR.glob("*.json"):
    d = json.load(open(f))
    all_data[d["slug"]] = d
    by_cat[d.get("category", "general")].append(d["slug"])

all_slugs = set(all_data.keys())
MIN_RELATED = 3
MAX_RELATED = 5
fixed = 0

for slug, data in all_data.items():
    existing = [r for r in data.get("related_comparisons", []) if r in all_slugs and r != slug]

    if len(existing) >= MIN_RELATED:
        continue

    cat = data.get("category", "general")
    slug_words = set(slug.replace("-vs-", "-").split("-"))

    # Candidates: same category first, then cross-category by word overlap
    same_cat = [s for s in by_cat.get(cat, []) if s != slug and s not in existing]
    other_cats = [s for s in all_slugs if s != slug and s not in existing and s not in same_cat]

    # Score by word overlap
    def score(candidate):
        cand_words = set(candidate.replace("-vs-", "-").split("-"))
        return len(slug_words & cand_words)

    same_cat.sort(key=score, reverse=True)
    other_cats.sort(key=score, reverse=True)

    # Fill from same category first, then cross-category
    candidates = same_cat + other_cats
    for c in candidates:
        if len(existing) >= MAX_RELATED:
            break
        if c not in existing:
            existing.append(c)

    if existing != data.get("related_comparisons", []):
        data["related_comparisons"] = existing[:MAX_RELATED]
        with open(COMP_DIR / f"{slug}.json", "w") as f:
            json.dump(data, f, indent=2)
        fixed += 1

print(f"Backfilled related_comparisons in {fixed} files")

# Verify
under_3 = 0
for f in COMP_DIR.glob("*.json"):
    d = json.load(open(f))
    valid = [r for r in d.get("related_comparisons", []) if r in all_slugs]
    if len(valid) < 3:
        under_3 += 1
print(f"Pages still under 3 related links: {under_3}")
