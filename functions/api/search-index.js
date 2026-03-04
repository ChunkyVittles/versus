// Route: GET /api/search-index
// Returns KV-only search entries (to be merged with static /search-index.json)

export async function onRequest(context) {
    const { env } = context;

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://versusthat.com',
        'Cache-Control': 'public, max-age=60',
    };

    try {
        const index = await env.COMPARISONS_KV.get('kv-search-index');
        return new Response(index || '[]', { headers });
    } catch (e) {
        return new Response('[]', { headers });
    }
}
