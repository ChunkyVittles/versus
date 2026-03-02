# VersusThat

**versusthat.com** — This versus that, we help you decide.

A static comparison site where every page compares one thing versus another. Built with Python + Jinja2, deployed to Cloudflare Pages.

## Quick Start

```bash
# Build the site
python3 scripts/build.py

# Generate a new comparison (requires ANTHROPIC_API_KEY)
python3 scripts/generate_comparison.py "ninja vs vitamix" --category blenders

# Batch generate
python3 scripts/generate_comparison.py --batch data/seed_comparisons.txt
```

## Project Structure

```
versus/
├── data/
│   ├── categories.json          # All categories
│   ├── comparisons/             # One JSON file per comparison
│   └── seed_comparisons.txt     # Batch generation seed file
├── templates/                   # Jinja2 templates
├── static/                      # CSS and JS
├── scripts/
│   ├── build.py                 # Static site generator
│   └── generate_comparison.py   # Content generation via Claude API
└── dist/                        # Generated output (deploy this)
```

## Workflow

1. `python3 scripts/generate_comparison.py "X vs Y" --category slug`
2. Review/edit JSON in `data/comparisons/`
3. `python3 scripts/build.py`
4. Deploy `dist/` to Cloudflare Pages
