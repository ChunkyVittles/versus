// Catch-all for dynamic comparison pages served from KV
// Only handles paths containing "-vs-" that don't have static pages

const AFFILIATE_TAG = 'versusthat-20';

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '').replace(/^\/+/, '');

    // Only handle paths that look like comparison slugs
    if (!path.includes('-vs-') || path.includes('/') || path.includes('.')) {
        return next();
    }

    // Check KV for this comparison
    let data;
    try {
        data = await env.COMPARISONS_KV.get(`comp:${path}`, 'json');
    } catch (e) {
        return next();
    }

    if (!data) {
        return next();
    }

    const html = renderComparisonPage(data);
    return new Response(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    });
}

function amazonUrl(keyword) {
    return `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&tag=${AFFILIATE_TAG}`;
}

function renderComparisonPage(comp) {
    const categoryName = comp.category?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'General';

    const starsHtml = (rating) => {
        let html = '';
        for (let i = 0; i < 5; i++) {
            const cls = rating >= i + 1 ? 'star-full' : (rating >= i + 0.5 ? 'star-half' : '');
            html += `<svg class="star ${cls}" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
        }
        return html + `<span>${rating}</span>`;
    };

    // Scoreboard counts
    const diffs = comp.key_differences || [];
    const aWins = diffs.filter(d => d.winner === 'a').length;
    const bWins = diffs.filter(d => d.winner === 'b').length;
    const ties = diffs.filter(d => d.winner === 'tie').length;
    const total = diffs.length;

    const diffRows = diffs.map(diff => {
        const aWin = diff.winner === 'a';
        const bWin = diff.winner === 'b';
        const checkSvg = '<svg class="winner-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
        return `<tr>
            <td class="diff-aspect">${esc(diff.aspect)}</td>
            <td class="diff-val ${aWin ? 'diff-winner' : ''}">${esc(diff.item_a)}${aWin ? checkSvg : ''}</td>
            <td class="diff-val ${bWin ? 'diff-winner' : ''}">${esc(diff.item_b)}${bWin ? checkSvg : ''}</td>
        </tr>`;
    }).join('\n');

    const prosConsCard = (item, side) => {
        const pros = (item.pros || []).map(p =>
            `<li><svg class="icon-pro" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>${esc(p)}</li>`
        ).join('');
        const cons = (item.cons || []).map(c =>
            `<li><svg class="icon-con" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>${esc(c)}</li>`
        ).join('');
        return `<div class="proscons-card proscons-${side}">
            <h3 class="proscons-title">${esc(item.name)}</h3>
            <div class="pros-list"><h4>Pros</h4><ul>${pros}</ul></div>
            <div class="cons-list"><h4>Cons</h4><ul>${cons}</ul></div>
        </div>`;
    };

    const faqHtml = (comp.faq || []).map(item =>
        `<div class="faq-item">
            <button class="faq-question" aria-expanded="false">
                <span>${esc(item.q)}</span>
                <svg class="faq-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="faq-answer"><p>${esc(item.a)}</p></div>
        </div>`
    ).join('\n');

    const faqSchema = comp.faq?.length ? `<script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [${comp.faq.map(item => `
        {"@type": "Question", "name": ${JSON.stringify(item.q)}, "acceptedAnswer": {"@type": "Answer", "text": ${JSON.stringify(item.a)}}}`).join(',')}
    ]
}</script>` : '';

    const verdictClass = comp.verdict === 'a' ? 'verdict-a' : (comp.verdict === 'b' ? 'verdict-b' : 'verdict-tie');

    const seoContentHtml = (comp.seo_content || '').split('\n\n').map(p => `<p>${esc(p)}</p>`).join('\n');

    // Hero winner/loser classes
    const heroAClass = comp.verdict === 'a' ? 'vs-hero-winner' : (comp.verdict === 'b' ? 'vs-hero-loser' : '');
    const heroBClass = comp.verdict === 'b' ? 'vs-hero-winner' : (comp.verdict === 'a' ? 'vs-hero-loser' : '');

    // Hero labels
    const heroALabel = comp.verdict === 'a'
        ? '<span class="winner-sash">&#x1F451; WINNER</span>'
        : (comp.verdict === 'b' ? '<span class="vs-hero-label">Runner-Up</span>' : '<span class="vs-hero-label">Option A</span>');
    const heroBLabel = comp.verdict === 'b'
        ? '<span class="winner-sash">&#x1F451; WINNER</span>'
        : (comp.verdict === 'a' ? '<span class="vs-hero-label">Runner-Up</span>' : '<span class="vs-hero-label">Option B</span>');

    // VS badge
    const vsBadge = comp.verdict === 'tie'
        ? '<div class="vs-badge">VS</div>'
        : '<div class="vs-badge vs-badge-decided">&#x1F3C6;</div>';

    // Shop buttons in hero
    const shopBtnA = comp.item_a?.shop_keywords?.length
        ? `<a href="${amazonUrl(comp.item_a.shop_keywords[0])}" class="btn btn-a btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Shop on Amazon</a>`
        : (comp.item_a?.affiliate_url ? `<a href="${esc(comp.item_a.affiliate_url)}" class="btn btn-a btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Check Price</a>` : '');
    const shopBtnB = comp.item_b?.shop_keywords?.length
        ? `<a href="${amazonUrl(comp.item_b.shop_keywords[0])}" class="btn btn-b btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Shop on Amazon</a>`
        : (comp.item_b?.affiliate_url ? `<a href="${esc(comp.item_b.affiliate_url)}" class="btn btn-b btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Check Price</a>` : '');

    // Scoreboard section
    const scoreboardHtml = `<section class="scoreboard-section">
        <div class="container">
            <div class="scoreboard">
                <div class="scoreboard-side scoreboard-a ${aWins > bWins ? 'scoreboard-leading' : ''}">
                    <span class="scoreboard-name">${esc(comp.item_a?.name)}</span>
                    <span class="scoreboard-score">${aWins}</span>
                </div>
                <div class="scoreboard-center">
                    <span class="scoreboard-vs">WINS</span>
                    ${ties > 0 ? `<span class="scoreboard-ties">${ties} tied</span>` : ''}
                </div>
                <div class="scoreboard-side scoreboard-b ${bWins > aWins ? 'scoreboard-leading' : ''}">
                    <span class="scoreboard-score">${bWins}</span>
                    <span class="scoreboard-name">${esc(comp.item_b?.name)}</span>
                </div>
            </div>
            <div class="scoreboard-bar">
                <div class="scoreboard-bar-a" style="width: ${total ? (aWins / total * 100) : 50}%"></div>
                <div class="scoreboard-bar-b" style="width: ${total ? (bWins / total * 100) : 50}%"></div>
            </div>
        </div>
    </section>`;

    // Shop CTA section
    const hasShopKeywords = comp.item_a?.shop_keywords?.length || comp.item_b?.shop_keywords?.length;
    const shopCtaHtml = hasShopKeywords ? `<section class="section shop-cta">
        <div class="container">
            <h2 class="section-title">Ready to Buy?</h2>
            <div class="shop-grid">
                ${comp.item_a?.shop_keywords?.length ? `<div class="shop-card shop-card-a ${comp.verdict === 'a' ? 'shop-card-winner' : ''}">
                    ${comp.verdict === 'a' ? '<span class="shop-winner-badge">&#x1F451; Our Pick</span>' : ''}
                    <h3>${esc(comp.item_a.name)}</h3>
                    <p class="shop-price">${esc(comp.item_a.price_range)}</p>
                    <div class="shop-links">
                        ${comp.item_a.shop_keywords.map(kw => `<a href="${amazonUrl(kw)}" class="btn btn-a btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; ${esc(kw)}</a>`).join('\n')}
                    </div>
                </div>` : ''}
                ${comp.item_b?.shop_keywords?.length ? `<div class="shop-card shop-card-b ${comp.verdict === 'b' ? 'shop-card-winner' : ''}">
                    ${comp.verdict === 'b' ? '<span class="shop-winner-badge">&#x1F451; Our Pick</span>' : ''}
                    <h3>${esc(comp.item_b.name)}</h3>
                    <p class="shop-price">${esc(comp.item_b.price_range)}</p>
                    <div class="shop-links">
                        ${comp.item_b.shop_keywords.map(kw => `<a href="${amazonUrl(kw)}" class="btn btn-b btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; ${esc(kw)}</a>`).join('\n')}
                    </div>
                </div>` : ''}
            </div>
        </div>
    </section>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(comp.meta_title || `${comp.item_a?.name} vs ${comp.item_b?.name}`)}</title>
    <meta name="description" content="${esc(comp.meta_description || '')}">
    <link rel="canonical" href="https://versusthat.com/${comp.slug}/">
    <meta property="og:site_name" content="VersusThat">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${esc(comp.meta_title || '')}">
    <meta property="og:description" content="${esc(comp.meta_description || '')}">
    <meta property="og:url" content="https://versusthat.com/${comp.slug}/">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/style.css?v=3">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"WebPage","name":${JSON.stringify(comp.meta_title)},"url":"https://versusthat.com/${comp.slug}/","datePublished":"${comp.date_published}","dateModified":"${comp.date_updated}","breadcrumb":{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://versusthat.com/"},{"@type":"ListItem","position":2,"name":"${esc(categoryName)}","item":"https://versusthat.com/categories/${comp.category}/"},{"@type":"ListItem","position":3,"name":"${esc(comp.item_a?.name)} vs ${esc(comp.item_b?.name)}"}]}}
    </script>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":${JSON.stringify(comp.item_a?.name)},"brand":{"@type":"Brand","name":${JSON.stringify(comp.item_a?.brand)}},"aggregateRating":{"@type":"AggregateRating","ratingValue":"${comp.item_a?.rating}","bestRating":"5","worstRating":"1","ratingCount":"1"}}
    </script>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":${JSON.stringify(comp.item_b?.name)},"brand":{"@type":"Brand","name":${JSON.stringify(comp.item_b?.brand)}},"aggregateRating":{"@type":"AggregateRating","ratingValue":"${comp.item_b?.rating}","bestRating":"5","worstRating":"1","ratingCount":"1"}}
    </script>
    ${faqSchema}
</head>
<body>
    <header class="site-header">
        <div class="container">
            <a href="/" class="logo">VERSUS<span class="logo-vs-mark">VS</span>THAT</a>
            <nav class="main-nav">
                <a href="/categories/">Categories</a>
                <a href="/about/">About</a>
            </nav>
            <button class="mobile-menu-btn" aria-label="Toggle menu"><span></span><span></span><span></span></button>
        </div>
    </header>
    <nav class="mobile-nav">
        <a href="/">Home</a>
        <a href="/categories/">Categories</a>
        <a href="/about/">About</a>
    </nav>
    <main>
        <nav class="breadcrumb">
            <div class="container">
                <a href="/">Home</a><span class="breadcrumb-sep">/</span>
                <a href="/categories/${comp.category}/">${esc(categoryName)}</a><span class="breadcrumb-sep">/</span>
                <span>${esc(comp.item_a?.name)} vs ${esc(comp.item_b?.name)}</span>
            </div>
        </nav>
        <section class="vs-hero">
            <div class="vs-hero-split">
                <div class="vs-hero-side vs-hero-a ${heroAClass}">
                    <div class="vs-hero-content">
                        ${heroALabel}
                        <h2 class="vs-hero-name">${esc(comp.item_a?.name)}</h2>
                        <div class="vs-hero-rating">
                            <div class="stars">${starsHtml(comp.item_a?.rating || 0)}</div>
                            <div class="vs-hero-price">${esc(comp.item_a?.price_range)}</div>
                            <p class="vs-hero-best-for">${esc(comp.item_a?.best_for)}</p>
                            ${shopBtnA}
                        </div>
                    </div>
                </div>
                <div class="vs-badge-wrapper">${vsBadge}</div>
                <div class="vs-hero-side vs-hero-b ${heroBClass}">
                    <div class="vs-hero-content">
                        ${heroBLabel}
                        <h2 class="vs-hero-name">${esc(comp.item_b?.name)}</h2>
                        <div class="vs-hero-rating">
                            <div class="stars">${starsHtml(comp.item_b?.rating || 0)}</div>
                            <div class="vs-hero-price">${esc(comp.item_b?.price_range)}</div>
                            <p class="vs-hero-best-for">${esc(comp.item_b?.best_for)}</p>
                            ${shopBtnB}
                        </div>
                    </div>
                </div>
            </div>
            <h1 class="vs-hero-title container">${esc(comp.item_a?.name)} vs ${esc(comp.item_b?.name)}</h1>
        </section>
        <section class="verdict-banner ${verdictClass}">
            <div class="container">
                <div class="verdict-content">
                    <span class="verdict-label">Our Verdict</span>
                    <h2 class="verdict-text">${esc(comp.verdict_text)}</h2>
                    <p class="verdict-summary">${esc(comp.comparison_summary)}</p>
                </div>
            </div>
        </section>
        ${scoreboardHtml}
        <section class="section">
            <div class="container">
                <h2 class="section-title">Key Differences</h2>
                <div class="diff-table-wrapper">
                    <table class="diff-table">
                        <thead><tr>
                            <th>Aspect</th>
                            <th class="col-a">${esc(comp.item_a?.name)}</th>
                            <th class="col-b">${esc(comp.item_b?.name)}</th>
                        </tr></thead>
                        <tbody>${diffRows}</tbody>
                    </table>
                </div>
            </div>
        </section>
        <section class="section section-alt">
            <div class="container">
                <h2 class="section-title">Pros &amp; Cons</h2>
                <div class="proscons-grid">
                    ${prosConsCard(comp.item_a || {}, 'a')}
                    ${prosConsCard(comp.item_b || {}, 'b')}
                </div>
            </div>
        </section>
        <section class="section">
            <div class="container">
                <div class="analysis-content">
                    <h2 class="section-title">Detailed Analysis</h2>
                    <div class="seo-content">${seoContentHtml}</div>
                </div>
            </div>
        </section>
        ${comp.faq?.length ? `<section class="section section-alt">
            <div class="container">
                <h2 class="section-title">Frequently Asked Questions</h2>
                <div class="faq-list">${faqHtml}</div>
            </div>
        </section>` : ''}
        ${shopCtaHtml}
    </main>
    <footer class="site-footer">
        <div class="container">
            <div class="footer-bottom">
                <p>&copy; ${new Date().getFullYear()} VersusThat. All rights reserved.</p>
                <p class="footer-disclaimer">We may earn a commission from affiliate links. This does not influence our comparisons.</p>
            </div>
        </div>
    </footer>
    <script src="/js/main.js?v=3"></script>
</body>
</html>`;
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
