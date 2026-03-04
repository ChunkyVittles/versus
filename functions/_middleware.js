export async function onRequest(context) {
    const response = await context.next();
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return newResponse;
}
