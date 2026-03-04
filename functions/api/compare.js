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

    // Soft rate tracking (no user-facing errors — just log for monitoring)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `rate:${ip}`;
    const rateCount = parseInt(await env.COMPARISONS_KV.get(rateKey) || '0');
    await env.COMPARISONS_KV.put(rateKey, String(rateCount + 1), { expirationTtl: 3600 });

    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `daily:${today}`;
    const dailyCount = parseInt(await env.COMPARISONS_KV.get(dailyKey) || '0');
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

    // Update KV search index so new comparisons are immediately searchable
    const kvSearchIndex = JSON.parse(await env.COMPARISONS_KV.get('kv-search-index') || '[]');
    if (!kvSearchIndex.some(e => e.s === slug)) {
        kvSearchIndex.push({
            s: slug,
            a: comparisonData.item_a?.name || '',
            b: comparisonData.item_b?.name || '',
            c: comparisonData.category || 'general',
        });
        await env.COMPARISONS_KV.put('kv-search-index', JSON.stringify(kvSearchIndex));
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
    const lower = query.toLowerCase().replace(/[^a-z0-9\s]/g, '');

    const blockedSubstring = [
        'porn', 'xxx', 'hentai', 'nsfw', 'nazi', 'cocaine', 'heroin',
        'fentanyl', 'meth ', 'hitler',
    ];

    for (const word of blockedSubstring) {
        if (lower.includes(word)) return true;
    }

    const blockedExact = [
        'porn', 'xxx', 'hentai', 'onlyfans', 'chaturbate', 'pornhub',
        'xvideos', 'xhamster', 'brazzers', 'nsfw',
        'dildo', 'vibrator', 'fleshlight', 'buttplug', 'cockring',
        'escort', 'hooker', 'prostitute',
        'cocaine', 'heroin', 'meth', 'fentanyl', 'crack pipe', 'bong',
        'weed', 'marijuana', 'cannabis', 'lsd', 'mdma', 'ecstasy',
        'hitler', 'nazi', 'kkk', 'white supremacy',
        'ar15', 'ar 15', 'ak47', 'ak 47', 'assault rifle', 'machine gun',
        'handgun', 'shotgun', 'rifle', 'pistol', 'ammo', 'ammunition',
        'bomb', 'explosive', 'grenade',
        'suicide', 'self harm', 'kill myself',
        'murder', 'terrorism', 'terrorist',
        'slave', 'slavery',
    ];

    const words = lower.split(/\s+/);
    for (const blocked of blockedExact) {
        if (blocked.includes(' ')) {
            if (lower.includes(blocked)) return true;
        } else {
            if (words.includes(blocked)) return true;
        }
    }

    return false;
}

async function generateComparison(query, slug, apiKey) {
    const today = new Date().toISOString().split('T')[0];

    const categories = [
        'blenders', 'smartphones', 'laptops', 'headphones', 'tvs', 'vacuums',
        'mattresses', 'grills', 'coffee-makers', 'air-fryers', 'streaming',
        'fitness-trackers', 'power-tools', 'lawn-mowers', 'cameras', 'tablets',
        'gaming-consoles', 'routers', 'car-seats', 'strollers',
        'software', 'websites', 'apps', 'people', 'sports', 'entertainment',
        'cars', 'food', 'travel', 'education', 'financial', 'services',
        'programming', 'games', 'music', 'movies', 'books', 'fashion',
        'kitchen-appliances', 'home-security', 'baby-products', 'insurance',
        'credit-cards', 'vpn', 'web-hosting', 'email-marketing',
        'project-management', 'crm', 'cloud-storage', 'password-managers',
        'home-appliances', 'outdoor-gear', 'speakers'
    ];

    const prompt = `You are a comparison expert writing for VersusThat.com — a site that compares ANYTHING, not just products. People compare products, websites, services, celebrities, sports teams, programming languages, cities, foods, concepts, and more. Generate a detailed, engaging comparison for: "${query}".

Determine the most appropriate category from this list: ${categories.join(', ')}. If none fit well, use "general".

CRITICAL: Adapt your response to what's being compared:
- PRODUCTS: Use price ranges, specs, shop keywords for purchasing
- WEBSITES/SERVICES (names ending in .com, .org, .net, .io, etc.): Use subscription pricing for price_range (e.g., "Free / $9.99/mo"), set affiliate_url to the site's URL (e.g., "https://example.com"), use the domain name as the item name (e.g., "GoCollect.com")
- PEOPLE (athletes, celebrities, historical figures): Use "N/A" for price_range, focus on achievements/stats/legacy in key_differences
- CONCEPTS/LANGUAGES/FRAMEWORKS: Use "N/A" or "Free / Open Source" for price_range, compare features/ecosystems/community
- ANYTHING ELSE: Adapt fields sensibly. Every comparison should feel natural and well-written for its topic.

Return ONLY valid JSON matching this exact structure (no markdown, no code fences, just raw JSON):

{
  "slug": "${slug}",
  "item_a": {
    "name": "Full name for the alphabetically-first item in the slug",
    "brand": "Brand, creator, organization, or relevant entity",
    "image_alt": "Descriptive alt text",
    "pros": ["Pro 1", "Pro 2", "Pro 3", "Pro 4"],
    "cons": ["Con 1", "Con 2", "Con 3"],
    "price_range": "$XX-$XX or N/A or Free",
    "best_for": "One sentence describing who/what this is best for",
    "rating": 4.2,
    "affiliate_url": "",
    "shop_on_ebay": true,
    "shop_keywords": ["related search term 1", "related search term 2"]
  },
  "item_b": {
    "name": "Full name for the second item in the slug",
    "brand": "Brand, creator, organization, or relevant entity",
    "image_alt": "Descriptive alt text",
    "pros": ["Pro 1", "Pro 2", "Pro 3", "Pro 4"],
    "cons": ["Con 1", "Con 2", "Con 3"],
    "price_range": "$XX-$XX or N/A or Free",
    "best_for": "One sentence describing who/what this is best for",
    "rating": 4.5,
    "affiliate_url": "",
    "shop_on_ebay": true,
    "shop_keywords": ["related search term 1", "related search term 2"]
  },
  "category": "category-slug",
  "comparison_summary": "2-3 sentence summary of the comparison and recommendation.",
  "comparison_intro": "A 2-3 sentence opening paragraph for the page. MUST naturally include ALL of these phrasings woven into real sentences (not a keyword-stuffed list): '[A] vs [B]', '[A] or [B]', 'should you choose [A] or [B]', 'which is better [A] or [B]', 'difference between [A] and [B]', '[A] compared to [B]'. Write it as a helpful, natural-sounding intro that a real person would want to read.",
  "verdict": "a" or "b" or "tie",
  "verdict_text": "One-sentence verdict that includes both names",
  "key_differences": [
    {"aspect": "Feature/Attribute Name", "item_a": "Value for A", "item_b": "Value for B", "winner": "a" or "b" or "tie"}
  ],
  "seo_content": "300-500 words of editorial content about this comparison. Written in an authoritative but accessible tone. Naturally include both orderings of the comparison phrase.",
  "faq": [
    {"q": "Question?", "a": "Answer."}
  ],
  "related_comparisons": ["slug-1-vs-slug-2", "slug-3-vs-slug-4"],
  "meta_title": "Item A vs Item B (2026): Engaging Subtitle Here",
  "meta_description": "Detailed comparison of Item A vs Item B.",
  "date_published": "${today}",
  "date_updated": "${today}"
}

IMPORTANT GUIDELINES:
- Use REAL data, facts, and specifications. Be accurate.
- The slug is "${slug}" — item_a is the first part, item_b is the second part.
- Include 6-8 key_differences with real, specific data points appropriate to the topic
- Include 3-5 FAQs that people actually search for
- Ratings should be realistic (3.5-4.9 range)
- seo_content should be 300-500 words, substantial and unique
- related_comparisons should use alphabetically-ordered slugs
- Be objective and data-driven. Both items have merits.
- meta_title should include the year (2026)
- shop_keywords: 2-3 search terms for related purchasable items. For products: "Brand Model name". For people: related merchandise like "Messi jersey", "Bob Hope DVD collection". For services/websites: related physical products. For concepts/languages: related books or courses. ALWAYS include at least 2 shop_keywords per item.
- affiliate_url: For ANY service, app, SaaS product, financial product, streaming service, or website being compared, set affiliate_url to the item's official homepage or signup URL (e.g., "https://acorns.com", "https://robinhood.com", "https://netflix.com", "https://notion.so"). For physical products sold by retailers, leave affiliate_url as empty string. The rendering system uses these URLs for "Visit" / "Sign Up" buttons.
- shop_on_ebay: Set to true if this item is a physical product, game, toy, book, or anything people commonly buy on eBay. Set to false for software, SaaS, online services, streaming platforms, concepts, people, or anything that isn't a purchasable physical item. Examples: Chess sets = true, Rubik's Cube = true, mattresses = true, headphones = true, NordVPN = false, Netflix = false, "The Beatles" = false, "Roth IRA" = false.
- comparison_intro MUST contain these exact phrasings naturally: "[A] vs [B]", "[A] or [B]", "which is better", "difference between [A] and [B]", and "[A] compared to [B]". This is critical for SEO.
- meta_description MUST include both "vs" and "or" phrasings of the comparison.
- faq MUST always include these three questions (plus 2-3 more topic-specific ones):
  1. "Is [A] better than [B]?" — answer should directly state which is better and why in 2-3 sentences.
  2. "Should I choose [A] or [B]?" — answer should give a clear recommendation based on use case. Use "choose" instead of "buy" for non-products.
  3. "What is the difference between [A] and [B]?" — answer should summarize the 3-4 biggest differences.
- seo_content must naturally include both orderings: "[A] vs [B]" AND "[B] vs [A]", plus "[A] or [B]", plus "compared to". Don't force them — weave them into the analysis naturally.
- If the comparison involves adult/sexual products, recreational drugs, weapons/firearms, or illegal activities, return ONLY this JSON: {"blocked": true}

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
            model: 'claude-sonnet-4-6',
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

    // Strip markdown fences if present — handle text before/after fences too
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
        text = fenceMatch[1].trim();
    }

    try {
        const data = JSON.parse(text);
        if (data.blocked) return null;
        data.slug = slug;

        return data;
    } catch (e) {
        console.error('Failed to parse Claude response:', e);
        return null;
    }
}
