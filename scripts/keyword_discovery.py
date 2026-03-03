"""
DataForSEO Keyword Discovery for VersusThat.com
================================================
Finds "X vs Y" keywords in non-electronics categories with search volume + competition data.

Usage:
    python3 scripts/keyword_discovery.py                    # Run all seed categories
    python3 scripts/keyword_discovery.py --seeds mattress grill  # Specific seeds only
    python3 scripts/keyword_discovery.py --min-volume 100   # Minimum monthly search volume
    python3 scripts/keyword_discovery.py --check-serp       # Also check SERP competition (costs more)

Note: DataForSEO "competition" score = Google Ads PPC competition (0-1), NOT organic SEO difficulty.
"""

import base64
import json
import argparse
import time
import csv
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Installing requests...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

# --- Config ---
DATAFORSEO_LOGIN = "beepbeep@acmeauctions.com"
DATAFORSEO_PASSWORD = "e24f3fcfce7a7aca"
BASE_URL = "https://api.dataforseo.com/v3"

AUTH = base64.b64encode(f"{DATAFORSEO_LOGIN}:{DATAFORSEO_PASSWORD}".encode()).decode()
HEADERS = {
    "Authorization": f"Basic {AUTH}",
    "Content-Type": "application/json",
}

# Non-electronics seed keywords for "vs" discovery
# Organized by our gap categories from competitive analysis
SEED_KEYWORDS = {
    "mattresses": [
        "mattress vs", "vs mattress", "casper vs", "purple vs mattress",
        "tempurpedic vs", "sleep number vs", "saatva vs", "helix vs",
        "nectar vs", "avocado vs mattress", "tuft and needle vs",
    ],
    "grills": [
        "grill vs", "smoker vs", "traeger vs", "green egg vs",
        "weber vs", "char-broil vs", "kamado vs", "pellet vs charcoal",
        "blackstone vs", "pit boss vs",
    ],
    "kitchen_appliances": [
        "blender vs", "ninja vs vitamix", "mixer vs", "kitchenaid vs",
        "cuisinart vs", "instant pot vs", "air fryer vs", "food processor vs",
        "keurig vs", "nespresso vs",
    ],
    "fitness_equipment": [
        "peloton vs", "nordictrack vs", "tonal vs", "mirror vs",
        "bowflex vs", "treadmill vs elliptical", "rower vs bike",
        "home gym vs", "concept2 vs",
    ],
    "home_security": [
        "simplisafe vs", "ring vs", "adt vs", "vivint vs",
        "nest vs ring", "wyze vs ring", "home security vs",
        "blink vs ring", "eufy vs ring",
    ],
    "baby_products": [
        "uppababy vs", "nuna vs", "graco vs", "chicco vs",
        "stroller vs", "car seat vs", "crib vs", "baby vs",
        "britax vs", "maxi cosi vs",
    ],
    "pet_products": [
        "blue buffalo vs", "purina vs", "dog food vs", "cat food vs",
        "royal canin vs", "hills vs", "orijen vs", "taste of the wild vs",
    ],
    "financial": [
        "robinhood vs", "fidelity vs", "chase vs", "schwab vs",
        "vanguard vs", "etrade vs", "td ameritrade vs", "roth vs traditional",
        "savings vs checking", "ira vs 401k",
    ],
    "power_tools": [
        "dewalt vs", "milwaukee vs", "makita vs", "ryobi vs",
        "bosch vs", "craftsman vs", "cordless vs corded",
        "impact driver vs drill", "dewalt vs milwaukee",
    ],
    "music_streaming": [
        "spotify vs", "apple music vs", "tidal vs", "youtube music vs",
        "amazon music vs", "pandora vs",
    ],
    "health_wearables": [
        "whoop vs", "oura vs", "garmin vs", "fitbit vs",
        "apple watch vs garmin", "whoop vs oura",
    ],
    "cars": [
        "toyota vs honda", "ford vs chevy", "suv vs sedan", "hybrid vs",
        "tesla vs", "camry vs accord", "rav4 vs crv", "truck vs suv",
        "awd vs 4wd", "lease vs buy",
    ],
    "services": [
        "uber vs lyft", "doordash vs", "grubhub vs", "instacart vs",
        "costco vs sams", "home depot vs lowes", "target vs walmart",
    ],
    "education": [
        "community college vs university", "online vs in person",
        "mba vs masters", "sat vs act", "public vs private school",
    ],
}

# Keywords to EXCLUDE (electronics / tech that versus.com already covers)
ELECTRONICS_EXCLUDE = [
    "iphone", "samsung", "galaxy", "pixel", "android", "ios",
    "laptop", "macbook", "chromebook", "thinkpad", "dell", "lenovo", "asus", "hp ",
    "gpu", "nvidia", "amd", "intel", "rtx", "radeon", "cpu", "processor", "ram",
    "monitor", "display", "oled", "qled", "4k tv", "8k",
    "headphone", "earbuds", "airpods", "sony wh", "bose qc",
    "tablet", "ipad",
    "router", "modem", "wifi",
    "playstation", "xbox", "nintendo", "ps5", "ps4",
    "camera", "canon", "nikon", "sony a7", "fujifilm",
    "ssd", "hdd", "hard drive", "storage",
    "keyboard", "mouse", "gaming",
    "smartwatch", "apple watch vs samsung",  # vs samsung = tech head-to-head
    "speaker", "sonos", "jbl", "bluetooth",
    "printer", "scanner",
    "drone", "dji",
]


def is_electronics(keyword: str) -> bool:
    """Check if a keyword is electronics/tech related"""
    kw_lower = keyword.lower()
    return any(term in kw_lower for term in ELECTRONICS_EXCLUDE)


def is_vs_keyword(keyword: str) -> bool:
    """Check if keyword contains a vs/versus pattern"""
    kw_lower = keyword.lower()
    return " vs " in kw_lower or " versus " in kw_lower or kw_lower.endswith(" vs")


def get_keyword_suggestions(seed: str, limit: int = 100) -> list[dict]:
    """Get keyword suggestions from DataForSEO"""
    payload = [{
        "keywords": [seed],
        "location_code": 2840,  # US
        "language_code": "en",
        "include_seed_keyword": True,
        "limit": limit,
    }]

    resp = requests.post(
        f"{BASE_URL}/keywords_data/google_ads/keywords_for_keywords/live",
        headers=HEADERS,
        json=payload,
    )
    resp.raise_for_status()
    data = resp.json()

    if data.get("status_code") != 20000:
        print(f"  Error for '{seed}': {data.get('status_message')}")
        return []

    tasks = data.get("tasks", [])
    if not tasks or not tasks[0].get("result"):
        return []

    return tasks[0]["result"]


def get_search_volume(keywords: list[str]) -> list[dict]:
    """Get search volume for specific keywords"""
    # API accepts max 700 keywords per request
    results = []
    for i in range(0, len(keywords), 700):
        batch = keywords[i:i+700]
        payload = [{
            "keywords": batch,
            "location_code": 2840,
            "language_code": "en",
        }]

        resp = requests.post(
            f"{BASE_URL}/keywords_data/google_ads/search_volume/live",
            headers=HEADERS,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("status_code") != 20000:
            print(f"  Search volume error: {data.get('status_message')}")
            continue

        tasks = data.get("tasks", [])
        if tasks and tasks[0].get("result"):
            results.extend(tasks[0]["result"])

    return results


def check_balance():
    """Check DataForSEO account balance"""
    resp = requests.get(f"{BASE_URL}/appendix/user_data", headers=HEADERS)
    resp.raise_for_status()
    data = resp.json()
    result = data.get("tasks", [{}])[0].get("result", [{}])[0]
    balance = result.get("money", {}).get("balance", 0)
    print(f"DataForSEO balance: ${balance:.2f}")
    return balance


def main():
    parser = argparse.ArgumentParser(description="Find 'X vs Y' keywords for VersusThat.com")
    parser.add_argument("--seeds", nargs="+", help="Specific seed categories to query",
                        choices=list(SEED_KEYWORDS.keys()))
    parser.add_argument("--min-volume", type=int, default=50,
                        help="Minimum monthly search volume (default: 50)")
    parser.add_argument("--max-competition", type=float, default=1.0,
                        help="Max PPC competition score 0-1 (default: 1.0 = no filter)")
    parser.add_argument("--limit", type=int, default=100,
                        help="Results per seed keyword (default: 100)")
    parser.add_argument("--output", type=str, default="data/keyword_opportunities.csv",
                        help="Output CSV path")
    parser.add_argument("--balance-only", action="store_true",
                        help="Just check account balance and exit")
    args = parser.parse_args()

    # Check balance first
    balance = check_balance()
    if args.balance_only:
        return

    categories = args.seeds or list(SEED_KEYWORDS.keys())

    # Estimate cost
    total_seeds = sum(len(SEED_KEYWORDS[c]) for c in categories)
    est_cost = total_seeds * 0.001  # ~$0.001 per keyword suggestion request
    print(f"\nWill query {total_seeds} seed keywords across {len(categories)} categories")
    print(f"Estimated cost: ~${est_cost:.3f}")

    if balance < est_cost:
        print(f"WARNING: Balance (${balance:.2f}) may be insufficient!")
        return

    # Collect all vs keywords
    all_keywords = {}  # keyword -> {category, volume, competition, cpc}

    for category in categories:
        seeds = SEED_KEYWORDS[category]
        print(f"\n{'='*60}")
        print(f"Category: {category} ({len(seeds)} seeds)")
        print(f"{'='*60}")

        for seed in seeds:
            print(f"  Querying: '{seed}'...", end=" ", flush=True)
            results = get_keyword_suggestions(seed, limit=args.limit)

            vs_count = 0
            for kw_data in results:
                keyword = kw_data.get("keyword", "")

                # Must be a "vs" keyword
                if not is_vs_keyword(keyword):
                    continue

                # Skip electronics
                if is_electronics(keyword):
                    continue

                volume = int(kw_data.get("search_volume", 0) or 0)
                try:
                    competition = float(kw_data.get("competition", 0) or 0)
                except (TypeError, ValueError):
                    competition = 0.0
                try:
                    cpc = float(kw_data.get("cpc", 0) or 0)
                except (TypeError, ValueError):
                    cpc = 0.0
                competition_level = kw_data.get("competition_level", "")

                # Apply filters
                if volume < args.min_volume:
                    continue
                if competition > args.max_competition:
                    continue

                # Keep highest volume if duplicate
                if keyword in all_keywords:
                    if volume <= all_keywords[keyword]["volume"]:
                        continue

                all_keywords[keyword] = {
                    "category": category,
                    "volume": volume,
                    "competition": competition,
                    "competition_level": competition_level,
                    "cpc": cpc,
                }
                vs_count += 1

            print(f"found {vs_count} vs keywords")
            time.sleep(0.2)  # Rate limiting

    # Sort by volume descending
    sorted_keywords = sorted(
        all_keywords.items(),
        key=lambda x: x[1]["volume"],
        reverse=True,
    )

    # Print results
    print(f"\n{'='*80}")
    print(f"RESULTS: {len(sorted_keywords)} non-electronics 'vs' keywords found")
    print(f"{'='*80}")
    print(f"\n{'Keyword':<50} {'Vol':>6} {'Comp':>6} {'CPC':>7} {'Level':<10} {'Category'}")
    print(f"{'-'*50} {'-'*6} {'-'*6} {'-'*7} {'-'*10} {'-'*15}")

    for keyword, data in sorted_keywords[:100]:  # Top 100
        print(f"{keyword:<50} {data['volume']:>6} {data['competition']:>6.3f} "
              f"${data['cpc']:>5.2f} {data['competition_level']:<10} {data['category']}")

    # Save to CSV
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["keyword", "monthly_volume", "ppc_competition", "competition_level",
                         "cpc", "category", "slug_suggestion"])
        for keyword, data in sorted_keywords:
            # Generate slug suggestion
            slug = keyword.lower().strip()
            slug = slug.replace(" versus ", " vs ")
            parts = slug.split(" vs ")
            if len(parts) == 2:
                a = parts[0].strip().replace(" ", "-")
                b = parts[1].strip().replace(" ", "-")
                # Alphabetical ordering
                if a > b:
                    a, b = b, a
                slug = f"{a}-vs-{b}"
            else:
                slug = slug.replace(" ", "-")

            writer.writerow([
                keyword,
                data["volume"],
                round(data["competition"], 3),
                data["competition_level"],
                round(data["cpc"], 2),
                data["category"],
                slug,
            ])

    print(f"\nFull results saved to: {output_path}")
    print(f"Total keywords: {len(sorted_keywords)}")

    # Summary by category
    print(f"\n{'='*40}")
    print("SUMMARY BY CATEGORY")
    print(f"{'='*40}")
    cat_stats = {}
    for kw, data in sorted_keywords:
        cat = data["category"]
        if cat not in cat_stats:
            cat_stats[cat] = {"count": 0, "total_volume": 0, "avg_cpc": []}
        cat_stats[cat]["count"] += 1
        cat_stats[cat]["total_volume"] += data["volume"]
        cat_stats[cat]["avg_cpc"].append(data["cpc"])

    for cat, stats in sorted(cat_stats.items(), key=lambda x: x[1]["total_volume"], reverse=True):
        avg_cpc = sum(stats["avg_cpc"]) / len(stats["avg_cpc"]) if stats["avg_cpc"] else 0
        print(f"  {cat:<25} {stats['count']:>4} keywords  {stats['total_volume']:>8} total vol  ${avg_cpc:.2f} avg CPC")


if __name__ == "__main__":
    main()
