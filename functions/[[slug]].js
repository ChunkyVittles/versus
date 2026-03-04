// Catch-all for dynamic comparison pages served from KV
// Only handles paths containing "-vs-" that don't have static pages

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

const EBAY_CAMPAIGN_ID = '5339144040';
const EBAY_SKIP_CATEGORIES = ['financial', 'education', 'services', 'streaming', 'cars'];

function ebayUrl(keyword) {
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&mkcid=1&mkrid=711-53200-19255-0&campid=${EBAY_CAMPAIGN_ID}&toolid=10001`;
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

    // Shop buttons in hero (skip non-physical categories)
    const showShop = !EBAY_SKIP_CATEGORIES.includes(comp.category);
    const shopBtnA = showShop
        ? `<a href="${ebayUrl(comp.item_a?.name)}" class="btn btn-a btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Shop on eBay</a>`
        : '';
    const shopBtnB = showShop
        ? `<a href="${ebayUrl(comp.item_b?.name)}" class="btn btn-b btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Shop on eBay</a>`
        : '';

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
    const shopCtaHtml = showShop ? `<section class="section shop-cta">
        <div class="container">
            <h2 class="section-title">Ready to Buy?</h2>
            <div class="shop-grid">
                <div class="shop-card shop-card-a ${comp.verdict === 'a' ? 'shop-card-winner' : ''}">
                    ${comp.verdict === 'a' ? '<span class="shop-winner-badge">&#x1F451; Our Pick</span>' : ''}
                    <h3>${esc(comp.item_a?.name)}</h3>
                    <p class="shop-price">${esc(comp.item_a?.price_range)}</p>
                    <div class="shop-links">
                        <a href="${ebayUrl(comp.item_a?.name)}" class="btn btn-a btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Shop on eBay</a>
                    </div>
                </div>
                <div class="shop-card shop-card-b ${comp.verdict === 'b' ? 'shop-card-winner' : ''}">
                    ${comp.verdict === 'b' ? '<span class="shop-winner-badge">&#x1F451; Our Pick</span>' : ''}
                    <h3>${esc(comp.item_b?.name)}</h3>
                    <p class="shop-price">${esc(comp.item_b?.price_range)}</p>
                    <div class="shop-links">
                        <a href="${ebayUrl(comp.item_b?.name)}" class="btn btn-b btn-shop" rel="nofollow sponsored" target="_blank">&#x1F6D2; Shop on eBay</a>
                    </div>
                </div>
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
    <link rel="preload" href="/fonts/figtree-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/bebas-neue-latin.woff2" as="font" type="font/woff2" crossorigin>
    <style>
    @font-face{font-family:'Bebas Neue';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/bebas-neue-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
    @font-face{font-family:'Bebas Neue';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/bebas-neue-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
    @font-face{font-family:'Figtree';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/figtree-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
    @font-face{font-family:'Figtree';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/figtree-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
    @font-face{font-family:'Figtree';font-style:normal;font-weight:500 800;font-display:swap;src:url(/fonts/figtree-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
    @font-face{font-family:'Figtree';font-style:normal;font-weight:500 800;font-display:swap;src:url(/fonts/figtree-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:'Figtree',sans-serif;color:#1e293b;background:#fff;line-height:1.6;-webkit-font-smoothing:antialiased}h1,h2,h3,h4{font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;line-height:1.1}a{color:inherit;text-decoration:none}.container{max-width:1200px;margin:0 auto;padding:0 1.5rem}.site-header{position:sticky;top:0;z-index:100;background:#111;border-bottom:none}.site-header .container{display:flex;align-items:center;justify-content:space-between;height:64px}.logo{font-family:'Bebas Neue',Impact,sans-serif;font-size:1.6rem;font-weight:400;letter-spacing:.04em;color:#fff;display:inline-flex;align-items:center}.logo-vs-mark{display:inline-block;background:#ffd60a;color:#111;padding:2px 8px;border-radius:4px;font-family:'Figtree',sans-serif;font-weight:800;font-size:.5em;vertical-align:middle;margin:0 2px;letter-spacing:0}.main-nav{display:flex;gap:2rem;align-items:center}.main-nav a{font-weight:600;color:rgba(255,255,255,.7);font-size:.95rem}.mobile-menu-btn{display:none;flex-direction:column;gap:5px;padding:4px;cursor:pointer;border:none;background:none}.mobile-menu-btn span{display:block;width:22px;height:2px;background:#fff;border-radius:2px}.mobile-nav{display:none;background:#111;border-bottom:1px solid rgba(255,255,255,.1);padding:1rem 1.5rem}.header-actions{display:flex;align-items:center;gap:.5rem}.site-search-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;background:none;color:rgba(255,255,255,.7);cursor:pointer;border-radius:50%}.site-search-panel{position:fixed;top:64px;left:0;right:0;z-index:99;background:#111;padding:1rem 0;box-shadow:0 8px 32px rgba(0,0,0,.3);transform:translateY(-100%);opacity:0;visibility:hidden;transition:transform .25s,opacity .25s,visibility .25s}.site-search-panel.active{transform:translateY(0);opacity:1;visibility:visible}
    </style>
    <link rel="preload" href="/css/style.css?v=5" as="style" onload="this.onload=null;this.rel='stylesheet'">
    <noscript><link rel="stylesheet" href="/css/style.css?v=4"></noscript>
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
            <a href="/" class="logo">VERSUS<span class="logo-vs-mark">THAT</span></a>
            <nav class="main-nav">
                <a href="/categories/">Categories</a>
                <a href="/about/">About</a>
            </nav>
            <div class="header-actions">
                <button class="site-search-btn" id="site-search-btn" aria-label="Search">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </button>
                <button class="mobile-menu-btn" aria-label="Toggle menu"><span></span><span></span><span></span></button>
            </div>
        </div>
    </header>
    <div class="site-search-panel" id="site-search-panel">
        <div class="container">
            <div class="site-search-input-wrap">
                <svg class="site-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input type="text" id="site-search-input" placeholder="Search for a product..." autocomplete="off">
                <button class="site-search-close" id="site-search-close" aria-label="Close search">&times;</button>
            </div>
            <div class="site-search-results" id="site-search-results"></div>
        </div>
    </div>
    <nav class="mobile-nav">
        <a href="/">Home</a>
        <a href="/categories/">Categories</a>
        <a href="/about/">About</a>
        <a href="#" id="mobile-search-link">Search</a>
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
    <script src="/js/main.js?v=5" defer></script>
    <script>
    (function(){
      const S='versusthat',C='https://bullbotics.com/api/analytics/collect';
      let Q=[],T=Date.now(),D={25:0,50:0,75:0,100:0},V={},sid=Math.random().toString(36).slice(2);
      function ts(){return Date.now()}
      function e(t,d){Q.push({type:t,data:d||{},timestamp:ts()})}
      function send(){if(!Q.length)return;const b=JSON.stringify({site_id:S,events:Q,session_id:sid});Q=[];if(navigator.sendBeacon){navigator.sendBeacon(C,new Blob([b],{type:'application/json'}))}else{fetch(C,{method:'POST',body:b,headers:{'Content-Type':'application/json'},keepalive:true}).catch(function(){})}}
      function pl(){const u=new URL(location.href),p=u.searchParams,r=document.referrer;e('page_load',{referrer:r,utm_source:p.get('utm_source'),utm_medium:p.get('utm_medium'),utm_campaign:p.get('utm_campaign'),device:window.innerWidth<768?'mobile':window.innerWidth<1024?'tablet':'desktop',screen:window.innerWidth+'x'+window.innerHeight,path:location.pathname})}
      function sd(){const h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)-window.innerHeight;if(h<=0)return;const p=Math.min(100,Math.round((window.scrollY/h)*100));[25,50,75,100].forEach(function(t){if(p>=t&&!D[t]){D[t]=1;e('scroll_depth',{threshold:t,time_to_reach:ts()-T})}})}
      function sv(){const obs=new IntersectionObserver(function(entries){entries.forEach(function(en){const id=en.target.id;if(!id)return;if(en.isIntersecting){if(!V[id])V[id]={start:ts(),total:0};else V[id].start=ts()}else if(V[id]&&V[id].start){V[id].total+=(ts()-V[id].start);V[id].start=0;e('section_visible',{section:id,duration:V[id].total})}})},{threshold:0.5});document.querySelectorAll('section[id]').forEach(function(s){obs.observe(s)})}
      function cl(){document.addEventListener('click',function(ev){const a=ev.target.closest('a[href]');if(!a)return;const h=a.href,r=a.getAttribute('rel')||'';if(r.indexOf('sponsored')>=0){e('affiliate_click',{url:h,text:(a.textContent||'').slice(0,50),product:a.getAttribute('aria-label')||''})}else if(h.indexOf('http')===0&&h.indexOf(location.hostname)<0){e('outbound_click',{url:h,text:(a.textContent||'').slice(0,50)})}})}
      function init(){pl();window.addEventListener('scroll',sd,{passive:true});sv();cl();setInterval(function(){e('time_on_page',{elapsed:ts()-T})},30000);setInterval(send,5000);window.addEventListener('beforeunload',function(){Object.keys(V).forEach(function(id){if(V[id].start){V[id].total+=(ts()-V[id].start);e('section_visible',{section:id,duration:V[id].total,final:true})}});send()});setTimeout(send,1000)}
      if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init)}else{init()}
    })();
    </script>
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
