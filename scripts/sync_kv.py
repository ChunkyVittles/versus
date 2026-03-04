#!/usr/bin/env python3
"""
Sync KV comparisons to static data files.

Pulls all comparisons from Cloudflare KV and saves them as JSON files
in data/comparisons/. Static files are the source of truth for the build
system (search index, sitemap, templates). This script ensures dynamically
generated comparisons become permanent static pages.

Usage:
    python scripts/sync_kv.py

Requires a valid Cloudflare OAuth token in ~/.wrangler/config/default.toml
(managed by wrangler login).
"""

import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    # Fall back to urllib if requests not installed
    import urllib.request
    import urllib.error

    class requests:
        @staticmethod
        def get(url, headers=None):
            req = urllib.request.Request(url, headers=headers or {})
            try:
                resp = urllib.request.urlopen(req)
                return type("Resp", (), {"ok": True, "json": lambda: json.loads(resp.read()), "text": resp.read().decode()})()
            except urllib.error.HTTPError as e:
                return type("Resp", (), {"ok": False, "status_code": e.code, "text": e.read().decode()})()

        @staticmethod
        def post(url, headers=None, data=None):
            req = urllib.request.Request(url, data=data.encode() if data else None, headers=headers or {}, method="POST")
            try:
                resp = urllib.request.urlopen(req)
                return type("Resp", (), {"ok": True, "json": lambda: json.loads(resp.read())})()
            except urllib.error.HTTPError as e:
                return type("Resp", (), {"ok": False, "status_code": e.code, "text": e.read().decode()})()

        @staticmethod
        def put(url, headers=None, data=None):
            req = urllib.request.Request(url, data=data.encode() if isinstance(data, str) else data, headers=headers or {}, method="PUT")
            try:
                resp = urllib.request.urlopen(req)
                return type("Resp", (), {"ok": True})()
            except urllib.error.HTTPError as e:
                return type("Resp", (), {"ok": False, "status_code": e.code, "text": e.read().decode()})()


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "comparisons"
ACCOUNT_ID = "73dc075a05ec7910d286e84df20b0960"
KV_NAMESPACE_ID = "bb93c00bc2f44704968eea79a54109d3"
KV_BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_NAMESPACE_ID}"

WRANGLER_CONFIG = Path.home() / "Library" / "Preferences" / ".wrangler" / "config" / "default.toml"
# Linux fallback
if not WRANGLER_CONFIG.exists():
    WRANGLER_CONFIG = Path.home() / ".wrangler" / "config" / "default.toml"


def get_token():
    """Read OAuth token from wrangler config, refresh if expired."""
    if not WRANGLER_CONFIG.exists():
        print("Error: No wrangler config found. Run 'wrangler login' first.")
        sys.exit(1)

    config = WRANGLER_CONFIG.read_text()
    token = None
    refresh = None
    for line in config.splitlines():
        if line.startswith("oauth_token"):
            token = line.split('"')[1]
        elif line.startswith("refresh_token"):
            refresh = line.split('"')[1]

    # Test if token works
    resp = requests.get(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.ok:
        return token

    # Try refreshing
    if refresh:
        print("  Token expired, refreshing...")
        resp = requests.post(
            "https://dash.cloudflare.com/oauth2/token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=f"grant_type=refresh_token&refresh_token={refresh}&client_id=54d11594-84e4-41aa-b438-e81b8fa78ee7",
        )
        if resp.ok:
            data = resp.json()
            if "access_token" in data:
                # Update config file with new tokens
                new_config = config
                new_config = new_config.replace(
                    f'oauth_token = "{token}"',
                    f'oauth_token = "{data["access_token"]}"',
                )
                if "refresh_token" in data:
                    new_config = new_config.replace(
                        f'refresh_token = "{refresh}"',
                        f'refresh_token = "{data["refresh_token"]}"',
                    )
                WRANGLER_CONFIG.write_text(new_config)
                return data["access_token"]

    print("Error: Could not authenticate with Cloudflare. Run 'wrangler login'.")
    sys.exit(1)


def list_kv_keys(token, prefix="comp:"):
    """List all KV keys with given prefix."""
    keys = []
    cursor = None
    while True:
        url = f"{KV_BASE}/keys?prefix={prefix}&limit=1000"
        if cursor:
            url += f"&cursor={cursor}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {token}"})
        if not resp.ok:
            print(f"Error listing keys: {resp.text}")
            return keys
        data = resp.json()
        keys.extend([k["name"] for k in data.get("result", [])])
        cursor = data.get("result_info", {}).get("cursor")
        if not cursor:
            break
    return keys


def get_kv_value(token, key):
    """Get a single KV value."""
    resp = requests.get(
        f"{KV_BASE}/values/{key}",
        headers={"Authorization": f"Bearer {token}"},
    )
    if not resp.ok:
        return None
    try:
        return resp.json()
    except Exception:
        return None


def put_kv_value(token, key, value):
    """Write a value to KV."""
    data = json.dumps(value) if not isinstance(value, str) else value
    resp = requests.put(
        f"{KV_BASE}/values/{key}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        data=data,
    )
    return resp.ok


def upload_affiliates(token):
    """Upload data/affiliates.json to KV key 'affiliates'."""
    affiliates_path = ROOT / "data" / "affiliates.json"
    if not affiliates_path.exists():
        print("  No data/affiliates.json found, skipping.")
        return
    with open(affiliates_path) as f:
        affiliates = json.load(f)
    if put_kv_value(token, "affiliates", affiliates):
        print(f"  Uploaded affiliates.json to KV ({len(affiliates)} partners)")
    else:
        print("  Warning: Failed to upload affiliates.json to KV")


def sync():
    print("Syncing KV comparisons to static files...")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Get existing static slugs
    existing = {p.stem for p in DATA_DIR.glob("*.json")}
    print(f"  {len(existing)} existing static comparisons")

    token = get_token()

    # Upload affiliates.json to KV
    upload_affiliates(token)

    # List all comparison keys in KV
    keys = list_kv_keys(token)
    print(f"  {len(keys)} comparisons in KV")

    new_count = 0
    updated_count = 0

    for key in keys:
        slug = key.replace("comp:", "")
        filepath = DATA_DIR / f"{slug}.json"

        if slug in existing:
            # Already have it — skip (static files are source of truth once synced)
            continue

        print(f"  Pulling: {slug}")
        data = get_kv_value(token, key)
        if not data:
            print(f"    Warning: Could not read {key}")
            continue

        # Ensure slug is set
        data["slug"] = slug

        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

        new_count += 1

    print(f"\nDone! {new_count} new comparisons synced.")
    if new_count > 0:
        print(f"Run 'python scripts/build.py' to rebuild the site.")


if __name__ == "__main__":
    sync()
