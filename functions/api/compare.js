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

    if (!query || !/\s+(?:vs\.?|versus)\s+/i.test(query)) {
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
    const match = query.toLowerCase().match(/(.+?)\s+(?:vs\.?|versus|v\.?\s*s\.?)\s+(.+)/);
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
    "affiliate_url": "",
    "shop_keywords": ["search term 1 for buying this product", "search term 2"]
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
    "affiliate_url": "",
    "shop_keywords": ["search term 1 for buying this product", "search term 2"]
  },
  "category": "category-slug",
  "comparison_summary": "2-3 sentence summary of the comparison and recommendation.",
  "comparison_intro": "A 2-3 sentence opening paragraph for the page. MUST naturally include ALL of these phrasings woven into real sentences (not a keyword-stuffed list): '[A] vs [B]', '[A] or [B]', 'should you buy [A] or [B]', 'which is better [A] or [B]', 'difference between [A] and [B]', '[A] compared to [B]'. Write it as a helpful, natural-sounding intro that a real person would want to read. Example: 'Trying to decide between the AirPods Pro and Sony WF-1000XM5? Whether you're wondering which is better for your commute or just trying to figure out the difference between Apple's and Sony's flagship earbuds, this comparison breaks down everything you need to know. We've compared the AirPods Pro to the Sony XM5 across sound quality, noise cancellation, battery life, and price so you can decide which to buy.'",
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
- meta_title should include the year (2026)
- shop_keywords: 2-3 Amazon search terms that would help someone BUY this product. For products: "Brand Model name", "Brand Model accessories". For people/non-products: related purchasable items like "Bob Hope DVD collection", "Fred Astaire movies Blu-ray". For services: related physical products. ALWAYS include at least 2 shop_keywords per item.
- comparison_intro MUST contain these exact phrasings naturally: "[A] vs [B]", "[A] or [B]", "which is better", "difference between [A] and [B]", and "[A] compared to [B]". This is critical for SEO — the page needs to match how people actually search.
- meta_description MUST include both "vs" and "or" phrasings of the comparison. Example: "AirPods Pro vs Sony WF-1000XM5 compared. Wondering which is better — AirPods Pro or Sony XM5? We break down sound, ANC, battery, and price."
- faq MUST always include these three questions (plus 2-3 more topic-specific ones):
  1. "Is [A] better than [B]?" — answer should directly state which is better and why in 2-3 sentences.
  2. "Should I buy [A] or [B]?" — answer should give a clear recommendation based on use case.
  3. "What is the difference between [A] and [B]?" — answer should summarize the 3-4 biggest differences.
- seo_content must naturally include both orderings: "[A] vs [B]" AND "[B] vs [A]", plus "[A] or [B]", plus "compared to". Don't force them — weave them into the analysis naturally.

WRITING STYLE — CRITICAL:
- BANNED WORDS — never use any of these: ultimately, comprehensive, robust, seamless, intuitive, significant, substantial, crucial, essential, notably, remarkably, conversely, furthermore, moreover, game-changer, stands out, remains one of, dive into, let's explore, delve, navigate the, elevate, testament to, it's worth noting, whether you're looking, in today's, in the world of, at the end of the day, boils down to, when it comes to, the bottom line
- Do NOT end meta_title with "Which Should You Buy?" — vary the endings. Use specific angles like "Head-to-Head Specs Breakdown", "The Key Differences Explained", "Worth the Upgrade?", "Compared for [specific use case]", "What $X Gets You", or ask a specific question relevant to the comparison.
- seo_content length MUST vary naturally: 250-350 words for simple product comparisons, 400-550 for technical topics, 550-700 for complex financial/educational topics. Do NOT always write exactly 400 words.
- Write with a confident editorial voice. Use occasional first person ("I'd pick", "in my testing", "from what I've seen"). Have strong opinions. Sound like one knowledgeable person, not a committee.
- Vary paragraph structure. Not every paragraph should be the same length. Use some short punchy sentences. Mix in longer explanatory ones.
- Start the seo_content differently every time. Do NOT open with "The [X] vs [Y] comparison..." or "The decision between..." — jump straight into a specific insight, opinion, or surprising fact.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250514',
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        }),
    });

    if (!response.ok) {
        console.error('Claude API error:', response.status, await response.text());
        return null;
    }

    const result = await response.json();
    let text = (result.content || [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim();
    if (!text) return null;

    // Strip markdown fences if present
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
        const data = JSON.parse(text);
        data.slug = slug;

        return data;
    } catch (e) {
        console.error('Failed to parse Claude response:', e);
        return null;
    }
}
