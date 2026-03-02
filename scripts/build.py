#!/usr/bin/env python3
"""
VersusThat Build Script
Generates all static HTML from data + templates.
Output goes to /dist for Cloudflare Pages deployment.
"""

import json
import os
import shutil
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

# Paths
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
COMPARISONS_DIR = DATA_DIR / "comparisons"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
DIST_DIR = ROOT / "dist"
DOMAIN = "https://versusthat.com"


def load_categories():
    with open(DATA_DIR / "categories.json") as f:
        return json.load(f)


def load_comparisons():
    comparisons = []
    if not COMPARISONS_DIR.exists():
        return comparisons
    for path in sorted(COMPARISONS_DIR.glob("*.json")):
        with open(path) as f:
            data = json.load(f)
        # Enforce alphabetical slug ordering
        data["slug"] = enforce_slug_order(data["slug"])
        comparisons.append(data)
    # Sort by date_updated descending
    comparisons.sort(key=lambda c: c.get("date_updated", ""), reverse=True)
    return comparisons


def enforce_slug_order(slug):
    """Ensure slug is alphabetically ordered: airpods-vs-galaxy-buds not galaxy-buds-vs-airpods"""
    if "-vs-" not in slug:
        return slug
    parts = slug.split("-vs-")
    if len(parts) != 2:
        return slug
    a, b = parts
    if a > b:
        return f"{b}-vs-{a}"
    return slug


def get_category_name(categories, slug):
    for cat in categories:
        if cat["slug"] == slug:
            return cat["name"]
    return slug.replace("-", " ").title()


def build_site():
    print("Building VersusThat...")

    # Clean dist
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)

    # Copy static assets
    if STATIC_DIR.exists():
        shutil.copytree(STATIC_DIR / "css", DIST_DIR / "css")
        shutil.copytree(STATIC_DIR / "js", DIST_DIR / "js")

    # Load data
    categories = load_categories()
    comparisons = load_comparisons()

    # Compute category counts
    category_counts = {}
    for comp in comparisons:
        cat = comp.get("category", "")
        category_counts[cat] = category_counts.get(cat, 0) + 1

    # Add category_name to each comparison
    for comp in comparisons:
        comp["category_name"] = get_category_name(categories, comp.get("category", ""))

    # Active categories (those with at least one comparison)
    active_categories = [c for c in categories if category_counts.get(c["slug"], 0) > 0]

    # Comparison lookup by slug
    comp_by_slug = {c["slug"]: c for c in comparisons}

    # Setup Jinja2
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=False)
    current_year = datetime.now().year

    # Common template context
    common = {
        "categories": categories,
        "current_year": current_year,
        "domain": DOMAIN,
    }

    # --- Homepage ---
    print("  Building homepage...")
    tpl = env.get_template("home.html")
    html = tpl.render(
        comparisons=comparisons,
        total_comparisons=len(comparisons),
        active_categories=active_categories,
        category_counts=category_counts,
        **common,
    )
    write_page(DIST_DIR / "index.html", html)

    # --- Comparison pages ---
    print(f"  Building {len(comparisons)} comparison pages...")
    tpl = env.get_template("comparison.html")
    for comp in comparisons:
        # Resolve related comparisons
        related = []
        for rel_slug in comp.get("related_comparisons", []):
            rel_slug = enforce_slug_order(rel_slug)
            if rel_slug in comp_by_slug:
                related.append(comp_by_slug[rel_slug])

        html = tpl.render(
            comp=comp,
            category_name=comp["category_name"],
            related=related,
            all_comparisons=comparisons,
            **common,
        )
        page_dir = DIST_DIR / comp["slug"]
        page_dir.mkdir(parents=True, exist_ok=True)
        write_page(page_dir / "index.html", html)

    # --- Category listing page ---
    print("  Building categories listing...")
    tpl = env.get_template("categories_listing.html")
    html = tpl.render(
        total_comparisons=len(comparisons),
        category_counts=category_counts,
        **common,
    )
    cat_dir = DIST_DIR / "categories"
    cat_dir.mkdir(parents=True, exist_ok=True)
    write_page(cat_dir / "index.html", html)

    # --- Individual category pages ---
    print("  Building category pages...")
    tpl = env.get_template("category.html")
    for cat in categories:
        cat_comparisons = [c for c in comparisons if c.get("category") == cat["slug"]]
        html = tpl.render(
            category=cat,
            comparisons=cat_comparisons,
            **common,
        )
        page_dir = DIST_DIR / "categories" / cat["slug"]
        page_dir.mkdir(parents=True, exist_ok=True)
        write_page(page_dir / "index.html", html)

    # --- Static pages ---
    print("  Building static pages...")
    tpl = env.get_template("static_page.html")

    static_pages = [
        {
            "slug": "about",
            "title": "About VersusThat",
            "description": "Learn about VersusThat and our mission to help you make smarter buying decisions.",
            "content": generate_about_content(),
        },
        {
            "slug": "privacy",
            "title": "Privacy Policy",
            "description": "VersusThat privacy policy — how we handle your data.",
            "content": generate_privacy_content(),
        },
        {
            "slug": "terms",
            "title": "Terms of Use",
            "description": "VersusThat terms of use and conditions.",
            "content": generate_terms_content(),
        },
    ]

    for page in static_pages:
        html = tpl.render(
            page_title=page["title"],
            page_description=page["description"],
            page_slug=page["slug"],
            page_content=page["content"],
            **common,
        )
        page_dir = DIST_DIR / page["slug"]
        page_dir.mkdir(parents=True, exist_ok=True)
        write_page(page_dir / "index.html", html)

    # --- 404 page ---
    print("  Building 404...")
    html_404 = tpl.render(
        page_title="Page Not Found",
        page_description="The page you're looking for doesn't exist.",
        page_slug="404",
        page_content='<p>The page you\'re looking for doesn\'t exist.</p><p><a href="/">Go back to the homepage</a> and find the comparison you\'re looking for.</p>',
        **common,
    )
    write_page(DIST_DIR / "404.html", html_404)

    # --- sitemap.xml ---
    print("  Building sitemap.xml...")
    build_sitemap(comparisons, categories)

    # --- robots.txt ---
    print("  Building robots.txt...")
    write_page(DIST_DIR / "robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {DOMAIN}/sitemap.xml\n")

    # --- Cloudflare _headers ---
    print("  Building _headers...")
    headers = """/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/css/*
  Cache-Control: public, max-age=31536000, immutable

/js/*
  Cache-Control: public, max-age=31536000, immutable
"""
    write_page(DIST_DIR / "_headers", headers)

    # --- Cloudflare _redirects ---
    print("  Building _redirects...")
    redirects = """# Redirect www to apex
https://www.versusthat.com/* https://versusthat.com/:splat 301
"""
    write_page(DIST_DIR / "_redirects", redirects)

    total_pages = 1 + len(comparisons) + 1 + len(categories) + len(static_pages) + 1
    print(f"\nDone! Built {total_pages} pages in /dist")


def build_sitemap(comparisons, categories):
    today = datetime.now().strftime("%Y-%m-%d")
    urls = []

    # Homepage
    urls.append({"loc": "/", "priority": "1.0", "changefreq": "daily"})

    # Comparison pages
    for comp in comparisons:
        urls.append({
            "loc": f"/{comp['slug']}/",
            "priority": "0.8",
            "changefreq": "weekly",
            "lastmod": comp.get("date_updated", today),
        })

    # Category listing
    urls.append({"loc": "/categories/", "priority": "0.7", "changefreq": "weekly"})

    # Category pages
    for cat in categories:
        urls.append({"loc": f"/categories/{cat['slug']}/", "priority": "0.6", "changefreq": "weekly"})

    # Static pages
    for slug in ["about", "privacy", "terms"]:
        urls.append({"loc": f"/{slug}/", "priority": "0.3", "changefreq": "monthly"})

    xml_urls = ""
    for u in urls:
        xml_urls += "  <url>\n"
        xml_urls += f"    <loc>{DOMAIN}{u['loc']}</loc>\n"
        if "lastmod" in u:
            xml_urls += f"    <lastmod>{u['lastmod']}</lastmod>\n"
        xml_urls += f"    <changefreq>{u['changefreq']}</changefreq>\n"
        xml_urls += f"    <priority>{u['priority']}</priority>\n"
        xml_urls += "  </url>\n"

    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{xml_urls}</urlset>
"""
    write_page(DIST_DIR / "sitemap.xml", sitemap)


def write_page(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def generate_about_content():
    return """
<h2>What is VersusThat?</h2>
<p>VersusThat is a product comparison site built for people who are stuck between two choices. Whether you're deciding between blenders, smartphones, headphones, or mattresses, we break down the differences so you can pick with confidence.</p>

<h2>Our Approach</h2>
<p>Every comparison on VersusThat follows the same rigorous process:</p>
<ul>
    <li><strong>Research:</strong> We analyze specs, reviews, and real-world performance data for every product we cover.</li>
    <li><strong>Compare:</strong> We put products side by side across the dimensions that actually matter — not just marketing bullet points.</li>
    <li><strong>Verdict:</strong> We give you a clear recommendation with reasoning, not wishy-washy "it depends" non-answers.</li>
</ul>

<h2>Why Trust Us?</h2>
<p>We're not paid by brands. Our comparisons are based on publicly available specifications, expert reviews, and real user feedback. When we recommend a product, it's because we genuinely believe it's the better choice for the stated use case.</p>

<h2>Affiliate Disclosure</h2>
<p>VersusThat may earn a commission when you click our affiliate links and make a purchase. This helps us keep the site running and free to use. Our affiliate relationships never influence our comparisons or recommendations.</p>

<h2>Contact</h2>
<p>Have a comparison you'd like us to cover? Found an error? We'd love to hear from you. Reach out at hello@versusthat.com.</p>
"""


def generate_privacy_content():
    return """
<p><em>Last updated: March 2, 2026</em></p>

<h2>Information We Collect</h2>
<p>VersusThat collects minimal information to operate and improve the site:</p>
<ul>
    <li><strong>Usage Data:</strong> We use privacy-respecting analytics to understand how visitors use the site. This may include pages visited, time on site, and referral sources.</li>
    <li><strong>Cookies:</strong> We use essential cookies for site functionality. We do not use tracking cookies for advertising.</li>
</ul>

<h2>How We Use Information</h2>
<p>Any information collected is used solely to:</p>
<ul>
    <li>Improve site content and user experience</li>
    <li>Understand which comparisons are most helpful</li>
    <li>Maintain site security and performance</li>
</ul>

<h2>Third-Party Services</h2>
<p>We may use third-party services for analytics and hosting. These services have their own privacy policies. We use Cloudflare for hosting and may use privacy-focused analytics tools.</p>

<h2>Affiliate Links</h2>
<p>Our site contains affiliate links to product retailers. When you click these links, the retailer may set cookies on your device to track the referral. This is governed by the retailer's privacy policy, not ours.</p>

<h2>Your Rights</h2>
<p>You can disable cookies in your browser settings. Since we don't collect personal information, there is generally no personal data to request, modify, or delete.</p>

<h2>Changes</h2>
<p>We may update this policy from time to time. Changes will be reflected on this page with an updated date.</p>

<h2>Contact</h2>
<p>Questions about this policy? Contact us at hello@versusthat.com.</p>
"""


def generate_terms_content():
    return """
<p><em>Last updated: March 2, 2026</em></p>

<h2>Acceptance of Terms</h2>
<p>By accessing and using VersusThat (versusthat.com), you agree to these Terms of Use. If you do not agree, please do not use the site.</p>

<h2>Content Disclaimer</h2>
<p>VersusThat provides product comparisons for informational purposes only. While we strive for accuracy, we cannot guarantee that all specifications, prices, or availability information is current or complete. Product details change frequently, and we recommend verifying critical information with the manufacturer or retailer before making a purchase.</p>

<h2>Affiliate Relationships</h2>
<p>VersusThat participates in affiliate programs. We may earn commissions from qualifying purchases made through links on our site. These relationships do not influence our editorial content or recommendations.</p>

<h2>Intellectual Property</h2>
<p>All content on VersusThat, including text, graphics, and design, is the property of VersusThat and is protected by copyright. You may not reproduce, distribute, or create derivative works from our content without permission.</p>

<h2>User Conduct</h2>
<p>You agree not to:</p>
<ul>
    <li>Scrape or systematically download content from the site</li>
    <li>Use the site for any unlawful purpose</li>
    <li>Attempt to interfere with the site's operation</li>
</ul>

<h2>Limitation of Liability</h2>
<p>VersusThat is provided "as is" without warranties of any kind. We are not liable for any damages arising from your use of the site or reliance on its content, including purchasing decisions made based on our comparisons.</p>

<h2>Changes</h2>
<p>We reserve the right to modify these terms at any time. Continued use of the site constitutes acceptance of updated terms.</p>

<h2>Contact</h2>
<p>Questions about these terms? Contact us at hello@versusthat.com.</p>
"""


if __name__ == "__main__":
    build_site()
