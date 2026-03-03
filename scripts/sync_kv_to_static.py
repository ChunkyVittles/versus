#!/usr/bin/env python3
"""
Sync dynamically generated comparisons from Cloudflare KV back to static JSON files.
Run this periodically, then rebuild and redeploy the static site.

Usage:
    python scripts/sync_kv_to_static.py

Requires env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID
"""

import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
COMPARISONS_DIR = ROOT / "data" / "comparisons"

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
KV_NAMESPACE_ID = os.environ.get("KV_NAMESPACE_ID")

BASE_URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_NAMESPACE_ID}"


def get_headers():
    return {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }


def list_kv_keys(prefix="comp:"):
    """List all keys in KV namespace with given prefix."""
    keys = []
    cursor = None

    while True:
        url = f"{BASE_URL}/keys?prefix={prefix}&limit=1000"
        if cursor:
            url += f"&cursor={cursor}"

        resp = requests.get(url, headers=get_headers())
        data = resp.json()

        if not data.get("success"):
            print(f"Error listing keys: {data.get('errors')}")
            break

        for key_info in data.get("result", []):
            keys.append(key_info["name"])

        cursor = data.get("result_info", {}).get("cursor")
        if not cursor:
            break

    return keys


def get_kv_value(key):
    """Fetch a single value from KV."""
    url = f"{BASE_URL}/values/{key}"
    resp = requests.get(url, headers=get_headers())
    if resp.status_code == 200:
        return resp.json()
    return None


def sync():
    if not all([ACCOUNT_ID, API_TOKEN, KV_NAMESPACE_ID]):
        print("Error: Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and KV_NAMESPACE_ID env vars.")
        sys.exit(1)

    COMPARISONS_DIR.mkdir(parents=True, exist_ok=True)

    print("Fetching KV keys...")
    keys = list_kv_keys("comp:")
    print(f"Found {len(keys)} comparisons in KV")

    new_count = 0
    skip_count = 0

    for key in keys:
        slug = key.replace("comp:", "")
        output_path = COMPARISONS_DIR / f"{slug}.json"

        if output_path.exists():
            skip_count += 1
            continue

        print(f"  Syncing: {slug}")
        data = get_kv_value(key)
        if data:
            # Remove dynamic generation marker
            data.pop("_generated", None)
            with open(output_path, "w") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            new_count += 1

    print(f"\nDone: {new_count} new comparisons synced, {skip_count} already existed")
    if new_count > 0:
        print("Run 'python scripts/build.py' to rebuild the static site.")


if __name__ == "__main__":
    sync()
