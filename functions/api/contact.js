// Route: POST /api/contact
// Body: { "name": "...", "email": "...", "message": "..." }
// Stores contact submissions in KV.
// TODO: Add email sending via Mailchannels or Resend when CONTACT_EMAIL env var is configured

export async function onRequestPost(context) {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json(
            { error: 'Invalid request body.' },
            { status: 400, headers: corsHeaders }
        );
    }

    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const message = (body.message || '').trim();

    // Validation
    if (!name || !email || !message) {
        return Response.json(
            { error: 'All fields are required.' },
            { status: 400, headers: corsHeaders }
        );
    }

    if (!email.includes('@') || !email.includes('.')) {
        return Response.json(
            { error: 'Please enter a valid email address.' },
            { status: 400, headers: corsHeaders }
        );
    }

    if (message.length < 10) {
        return Response.json(
            { error: 'Message must be at least 10 characters.' },
            { status: 400, headers: corsHeaders }
        );
    }

    // Rate limiting: max 3 per IP per hour
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `contact-rate:${ip}`;
    const rateCount = parseInt(await env.COMPARISONS_KV.get(rateKey) || '0');
    if (rateCount >= 3) {
        return Response.json(
            { error: 'Too many messages. Please try again later.' },
            { status: 429, headers: corsHeaders }
        );
    }
    await env.COMPARISONS_KV.put(rateKey, String(rateCount + 1), { expirationTtl: 3600 });

    // Store submission
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const key = `contact:${timestamp}:${random}`;
    const value = JSON.stringify({
        name,
        email,
        message,
        ip,
        timestamp,
        read: false,
    });
    await env.COMPARISONS_KV.put(key, value, { expirationTtl: 7776000 }); // 90 days

    return Response.json(
        { status: 'ok', message: 'Message sent successfully.' },
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
