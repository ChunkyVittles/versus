// Route: POST /api/compare
// Body: { "query": "roomba vs dyson" }
// Returns: { "status": "ok", "slug": "dyson-vs-roomba", "data": {...}, "cached": bool }

export async function onRequestPost(context) {
    const { request, env } = context;

    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    const body = await request.json();
    const query = body.query?.trim();

    if (!query || !query.toLowerCase().includes(' vs ')) {
        return Response.json(
            { error: 'Query must be in "X vs Y" format' },
            { status: 400, headers: corsHeaders }
        );
    }

    const slug = makeSlug(query);
    if (!slug) {
        return Response.json(
            { error: 'Could not parse comparison query' },
            { status: 400, headers: corsHeaders }
        );
    }

    // Check KV cache first
    const cached = await env.COMPARISONS_KV.get(`comp:${slug}`, 'json');
    if (cached) {
        return Response.json(
            { status: 'ok', slug, data: cached, cached: true },
            { headers: corsHeaders }
        );
    }

    // Rate limiting per IP
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `rate:${ip}`;
    const rateCount = parseInt(await env.COMPARISONS_KV.get(rateKey) || '0');
    if (rateCount >= 10) {
        return Response.json(
            { error: 'Rate limit exceeded. Try again later.' },
            { status: 429, headers: corsHeaders }
        );
    }
    await env.COMPARISONS_KV.put(rateKey, String(rateCount + 1), { expirationTtl: 3600 });

    // Global daily limit
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `daily:${today}`;
    const dailyCount = parseInt(await env.COMPARISONS_KV.get(dailyKey) || '0');
    if (dailyCount >= 100) {
        return Response.json(
            { error: 'Daily generation limit reached. Try again tomorrow.' },
            { status: 429, headers: corsHeaders }
        );
    }
    await env.COMPARISONS_KV.put(dailyKey, String(dailyCount + 1), { expirationTtl: 86400 });

    // Basic content filter
    if (isBlocked(query)) {
        return Response.json(
            { error: 'This comparison cannot be generated.' },
            { status: 400, headers: corsHeaders }
        );
    }

    // Generate via Claude API
    const comparisonData = await generateComparison(query, slug, env.ANTHROPIC_API_KEY);
    if (!comparisonData) {
        return Response.json(
            { error: 'Failed to generate comparison. Please try again.' },
            { status: 500, headers: corsHeaders }
        );
    }

    // Store in KV
    await env.COMPARISONS_KV.put(`comp:${slug}`, JSON.stringify(comparisonData));

    // Update all-slugs index
    const allSlugs = JSON.parse(await env.COMPARISONS_KV.get('all-slugs') || '[]');
    if (!allSlugs.includes(slug)) {
        allSlugs.push(slug);
        await env.COMPARISONS_KV.put('all-slugs', JSON.stringify(allSlugs));
    }

    return Response.json(
        { status: 'ok', slug, data: comparisonData, cached: false },
        { headers: corsHeaders }
    );
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}

function makeSlug(query) {
    const match = query.toLowerCase().match(/(.+?)\s+vs\.?\s+(.+)/);
    if (!match) return null;
    let a = match[1].trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let b = match[2].trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (a > b) [a, b] = [b, a];
    return `${a}-vs-${b}`;
}

function isBlocked(query) {
    const lower = query.toLowerCase();
    const blocked = [
        'kill', 'murder', 'suicide', 'porn', 'xxx', 'racist', 'hitler',
        'nazi', 'terrorism', 'bomb', 'drug', 'cocaine', 'heroin',
    ];
    return blocked.some(word => lower.includes(word));
}

async function generateComparison(query, slug, apiKey) {
    const today = new Date().toISOString().split('T')[0];

    const categories = [
        'blenders', 'smartphones', 'laptops', 'headphones', 'tvs', 'vacuums',
        'mattresses', 'grills', 'coffee-makers', 'air-fryers', 'streaming',
        'fitness-trackers', 'power-tools', 'lawn-mowers', 'cameras', 'tablets',
        'gaming-consoles', 'routers', 'car-seats', 'strollers'
    ];

    const prompt = `You are a product comparison expert writing for VersusThat.com. Generate a detailed, objective comparison for: "${query}".

Determine the most appropriate category from this list: ${categories.join(', ')}. If none fit well, use "general".

Return ONLY valid JSON matching this exact structure (no markdown, no code fences, just raw JSON):

{
  "slug": "${slug}",
  "item_a": {
    "name": "Full product name for the alphabetically-first item in the slug",
    "brand": "Brand name",
    "image_alt": "Descriptive alt text for product image",
    "pros": ["Pro 1", "Pro 2", "Pro 3", "Pro 4"],
    "cons": ["Con 1", "Con 2", "Con 3"],
    "price_range": "$XX-$XX",
    "best_for": "One sentence describing who this product is best for",
    "rating": 4.2,
    "affiliate_url": ""
  },
  "item_b": {
    "name": "Full product name for the second item in the slug",
    "brand": "Brand name",
    "image_alt": "Descriptive alt text for product image",
    "pros": ["Pro 1", "Pro 2", "Pro 3", "Pro 4"],
    "cons": ["Con 1", "Con 2", "Con 3"],
    "price_range": "$XX-$XX",
    "best_for": "One sentence describing who this product is best for",
    "rating": 4.5,
    "affiliate_url": ""
  },
  "category": "category-slug",
  "comparison_summary": "2-3 sentence summary of the comparison and recommendation.",
  "verdict": "a" or "b" or "tie",
  "verdict_text": "One-sentence verdict that includes both product names",
  "key_differences": [
    {"aspect": "Feature Name", "item_a": "Value for A", "item_b": "Value for B", "winner": "a" or "b" or "tie"}
  ],
  "seo_content": "300-500 words of editorial content about this comparison. Written in an authoritative but accessible tone. Naturally include both orderings of the comparison phrase.",
  "faq": [
    {"q": "Question?", "a": "Answer."}
  ],
  "related_comparisons": ["slug-1-vs-slug-2", "slug-3-vs-slug-4"],
  "meta_title": "Item A vs Item B (2026): Which Should You Buy?",
  "meta_description": "Detailed comparison of Item A vs Item B.",
  "date_published": "${today}",
  "date_updated": "${today}"
}

IMPORTANT GUIDELINES:
- Use REAL product specifications, prices, and data. Be accurate.
- The slug is "${slug}" — item_a is the first part, item_b is the second part.
- Include 6-8 key_differences with real specs (wattage, weight, battery life, etc.)
- Include 3-5 FAQs that people actually search for
- Ratings should be realistic (3.5-4.9 range)
- seo_content should be 300-500 words, substantial and unique
- related_comparisons should use alphabetically-ordered slugs
- Be objective and data-driven. Both products have merits.
- meta_title should include the year (2026)`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        console.error('Claude API error:', response.status, await response.text());
        return null;
    }

    const result = await response.json();
    let text = result.content?.[0]?.text?.trim();
    if (!text) return null;

    // Strip markdown fences if present
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
        const data = JSON.parse(text);
        data.slug = slug;
        data._generated = 'dynamic';
        return data;
    } catch (e) {
        console.error('Failed to parse Claude response:', e);
        return null;
    }
}
