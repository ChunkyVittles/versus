#!/usr/bin/env python3
"""
Fetch product images from Pexels API for comparison pages.
Uses item names as search queries, downloads one image per item,
saves to static/images/comparisons/.

Usage:
    export PEXELS_API_KEY=your_key_here
    python scripts/fetch_images.py
    python scripts/fetch_images.py --slug airpods-pro-vs-bose-quietcomfort-ultra-earbuds
"""
import json
import os
import sys
import time
import re
from pathlib import Path

try:
    import requests
except ImportError:
    print("pip install requests")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
COMP_DIR = ROOT / "data" / "comparisons"
IMG_DIR = ROOT / "static" / "images" / "comparisons"
IMG_DIR.mkdir(parents=True, exist_ok=True)

API_KEY = os.environ.get("PEXELS_API_KEY", "")
if not API_KEY:
    print("Set PEXELS_API_KEY environment variable")
    sys.exit(1)

HEADERS = {"Authorization": API_KEY}
PEXELS_URL = "https://api.pexels.com/v1/search"


def search_image(query, width=800):
    """Search Pexels for an image, return the medium-size URL or None."""
    try:
        resp = requests.get(
            PEXELS_URL,
            headers=HEADERS,
            params={"query": query, "per_page": 1, "size": "medium"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            photos = data.get("photos", [])
            if photos:
                return photos[0]["src"]["medium"]
    except Exception as e:
        print(f"    Error searching '{query}': {e}")
    return None


def download_image(url, filepath):
    """Download image to filepath."""
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            filepath.write_bytes(resp.content)
            return True
    except Exception:
        pass
    return False


def simplify_query(name):
    """Simplify product name to a better search query."""
    # Remove parenthetical content
    q = re.sub(r'\([^)]*\)', '', name).strip()
    # Remove common suffixes
    for remove in ['Series', 'Edition', 'Generation', 'Platform', 'System', 'Plan']:
        q = q.replace(remove, '').strip()
    # Take first 4 words max
    words = q.split()[:4]
    return " ".join(words)


def process_comparison(slug):
    """Fetch images for a single comparison."""
    filepath = COMP_DIR / f"{slug}.json"
    if not filepath.exists():
        print(f"  Not found: {slug}")
        return

    data = json.load(open(filepath))

    for side in ["item_a", "item_b"]:
        item = data[side]
        name = item.get("name", "")
        img_filename = f"{slug}_{side}.jpg"
        img_path = IMG_DIR / img_filename

        if img_path.exists():
            continue

        query = simplify_query(name)
        print(f"  Searching: '{query}'...")
        url = search_image(query)

        if not url:
            # Try broader search with just brand or category
            brand = item.get("brand", "")
            if brand:
                url = search_image(brand + " product")

        if url:
            if download_image(url, img_path):
                print(f"    Saved: {img_filename}")
            else:
                print(f"    Download failed")
        else:
            print(f"    No image found for '{query}'")

        time.sleep(2)  # Rate limit: be nice to Pexels API


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", help="Process single comparison")
    parser.add_argument("--limit", type=int, default=0, help="Max comparisons to process")
    args = parser.parse_args()

    if args.slug:
        process_comparison(args.slug)
        return

    slugs = sorted([f.stem for f in COMP_DIR.glob("*.json")])
    print(f"Processing {len(slugs)} comparisons...")

    processed = 0
    for slug in slugs:
        process_comparison(slug)
        processed += 1
        if args.limit and processed >= args.limit:
            print(f"\nStopped at --limit {args.limit}")
            break

    # Count results
    downloaded = len(list(IMG_DIR.glob("*.jpg")))
    print(f"\nDone. {downloaded} images in {IMG_DIR}")


if __name__ == "__main__":
    main()
