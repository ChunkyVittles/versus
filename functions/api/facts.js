// Route: POST /api/facts
// Body: { "item_a": "GoCollect.com", "item_b": "HobbyDB.com" }
// Returns: { "facts": ["fact 1", "fact 2", ...] }

export async function onRequestPost(context) {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        const body = await request.json();
        const itemA = body.item_a?.trim();
        const itemB = body.item_b?.trim();

        if (!itemA || !itemB) {
            return Response.json(
                { facts: [] },
                { headers: corsHeaders }
            );
        }

        const prompt = `Generate 6 short, interesting facts or bits of history about these two subjects: "${itemA}" and "${itemB}".

Rules:
- Alternate between the two subjects (fact about A, fact about B, fact about A, etc.)
- Each fact should be 1 sentence, max 20 words
- Focus on surprising, fun, or historical details people might not know
- If these are products, mention founding year, origin country, interesting design decisions, sales milestones
- If these are websites/services, mention when they launched, who founded them, interesting stats
- If these are concepts or generic things, find the most interesting angles
- No filler phrases like "Did you know" or "Interestingly" — just state the fact directly
- Return ONLY a JSON array of 12 strings, nothing else

Example: ["The Vitamix company was founded in 1921.", "Ninja's parent company SharkNinja started as a vacuum company.", ...]`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) {
            return Response.json({ facts: [] }, { headers: corsHeaders });
        }

        const result = await response.json();
        let text = (result.content || [])
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('')
            .trim();

        if (text.startsWith('```')) {
            text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const facts = JSON.parse(text);
        if (!Array.isArray(facts)) {
            return Response.json({ facts: [] }, { headers: corsHeaders });
        }

        return Response.json(
            { facts: facts.slice(0, 12) },
            { headers: corsHeaders }
        );
    } catch (e) {
        return Response.json({ facts: [] }, { headers: corsHeaders });
    }
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
