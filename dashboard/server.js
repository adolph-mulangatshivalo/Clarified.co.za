const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT           = 3000;
const SITE_ROOT      = path.join(__dirname, '..');
const DASHBOARD_ROOT = __dirname;
const DB_PATH        = path.join(__dirname, 'db.json');

// ─── MCP Engine & SSE Client Tracking ─────────────────────────────────────────
let mcpEngine = null;
try {
    mcpEngine = require('../mcp/server.js');
} catch (e) {
    console.warn('Clarified MCP engine not loaded:', e.message);
}
const activeSseClients = new Map();

// ─── DB helpers ──────────────────────────────────────────────────────────────
function getDB() {
    if (!fs.existsSync(DB_PATH)) { const d = { articles: [] }; saveDB(d); return d; }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function readingTime(content) {
    if (!content) return 4;
    const words = content.replace(/<[^>]+>/g, '').split(/\s+/).length;
    return Math.max(1, Math.round(words / 200));
}

function shiftHomepageArticles(articles, currentArticleId, newPlacement) {
    if (!Array.isArray(articles)) return;

    if (newPlacement === 'top_story') {
        const previousTopStory = articles.find(a => String(a.id) !== String(currentArticleId) && a.homepagePlacement === 'top_story');
        const existingHeroSide = articles
            .filter(a => String(a.id) !== String(currentArticleId) && a.homepagePlacement === 'hero_side')
            .sort((a, b) => (b.date || 0) - (a.date || 0));
        const existingLatest = articles
            .filter(a => String(a.id) !== String(currentArticleId) && a.homepagePlacement === 'latest')
            .sort((a, b) => (b.date || 0) - (a.date || 0));

        if (previousTopStory) {
            previousTopStory.homepagePlacement = 'hero_side';
            existingHeroSide.unshift(previousTopStory);
        }

        if (existingHeroSide.length > 2) {
            const overflowHero = existingHeroSide.slice(2);
            overflowHero.forEach(a => {
                a.homepagePlacement = 'latest';
                existingLatest.unshift(a);
            });
            existingHeroSide.slice(0, 2).forEach(a => {
                a.homepagePlacement = 'hero_side';
            });
        }

        if (existingLatest.length > 4) {
            existingLatest.slice(4).forEach(a => {
                a.homepagePlacement = 'standard';
            });
        }
    } else if (['editors_pick', 'business', 'sport'].includes(newPlacement)) {
        articles.forEach(a => {
            if (String(a.id) !== String(currentArticleId) && a.homepagePlacement === newPlacement) {
                a.homepagePlacement = 'standard';
            }
        });
    }
}

// ─── Static site regeneration ─────────────────────────────────────────────────
function regenerateStaticSite() {
    if (mcpEngine && typeof mcpEngine.regenerateSite === 'function') {
        try {
            mcpEngine.regenerateSite();
            return;
        } catch (e) {
            console.warn('mcpEngine.regenerateSite failed, falling back to local:', e.message);
        }
    }
    const db = getDB();
    const published = db.articles
        .filter(a => a.status === 'published')
        .sort((a, b) => b.date - a.date);

    function resolveImgUrl(p) {
        if (!p) return '';
        let clean = p.startsWith('http://') || p.startsWith('https://') ? p : '/' + p.replace(/^\//, '');
        if (clean.endsWith('.png')) {
            const jpgCandidate = clean.replace(/\.png$/, '.jpg');
            const localJpg = path.join(SITE_ROOT, jpgCandidate.replace(/^\//, ''));
            if (fs.existsSync(localJpg)) {
                return jpgCandidate;
            }
        }
        return clean;
    }
    function resolveAbsoluteImgUrl(p) {
        if (!p) return '';
        const rel = resolveImgUrl(p);
        if (rel.startsWith('http://') || rel.startsWith('https://')) return rel;
        return 'https://clarified.co.za/' + rel.replace(/^\//, '');
    }

    function normalizeTables(html) {
        if (!html || !html.includes('<table')) return html;
        
        let result = html
            .replace(/<!--\s*\/?wp:[^\->]*-->/gi, '')
            .replace(/<p>\s*<!--\s*\/?wp:[^\->]*-->\s*<\/p>/gi, '');

        result = result
            .replace(/<div\s+class=["'][^"']*table-container[^"']*["'][^>]*>/gi, '<div class="table-responsive">')
            .replace(/<figure\s+class=["'][^"']*wp-block-table[^"']*["'][^>]*>/gi, '<div class="table-responsive">')
            .replace(/<\/figure>/gi, '</div>');

        result = result.replace(/(<div class="table-responsive"[^>]*>[\s\S]*?<\/div>)|(<table[\s\S]*?<\/table>)/gi, (m, wrapped, unwrapped) => {
            if (wrapped) return wrapped;
            return `<div class="table-responsive">${unwrapped}</div>`;
        });

        result = result.replace(/<table(?!\s+class=)([^>]*)>/gi, '<table class="clarified-table"$1>');
        result = result.replace(/<table\s+class=["']([^"']*)["']([^>]*)>/gi, (m, cls, rest) => {
            if (!cls.includes('clarified-table')) {
                cls = (cls + ' clarified-table').trim();
            }
            return `<table class="${cls}"${rest}>`;
        });

        return result;
    }

    function articleUrl(a) { 
        return '/articles/' + (a.slug || a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) + '.html'; 
    }

    function formatExcerpt(text, maxLength = 120) {
        if (!text) return '';
        const clean = String(text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (clean.length <= maxLength) return clean;
        let trimmed = clean.substring(0, maxLength);
        const lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace > maxLength * 0.6) {
            trimmed = trimmed.substring(0, lastSpace);
        }
        trimmed = trimmed.replace(/[,;:\-\.\s]+$/, '');
        return trimmed + '...';
    }

    function cardHTML(a) {
        const url = articleUrl(a);
        const imgSrc = resolveImgUrl(a.featuredImage);
        const img = imgSrc
            ? `<a href="${url}"><img src="${imgSrc}" alt="${a.imgAlt || a.title}" loading="lazy" decoding="async"></a>`
            : `<a href="${url}" style="display:block;aspect-ratio:16/9;border-radius:9px;background:var(--soft);"></a>`;
        return `<article class="card">
            ${img}
            <div class="eyebrow" style="margin-top:10px;">${(a.category || '').split(',')[0].trim()}</div>
            <h3><a href="${url}">${a.title}</a></h3>
            <p>${formatExcerpt(a.excerpt, 100)}</p>
            <a class="read-meta" href="${url}">Read story →</a>
        </article>`;
    }

    // Generate individual article pages from about.html template
    let template = fs.readFileSync(path.join(SITE_ROOT, 'about.html'), 'utf8');
    
    // Clean up template for article generation
    template = template.replace(/<a href="\/about\.html" class="active">About<\/a>/g, '<a href="/about.html">About</a>');
    
    // Populate brief ticker
    if (published.length) {
        const spans = published.slice(0, 8).map(a => `<span><a href="${articleUrl(a)}" style="color:inherit;text-decoration:none;">${a.title}</a></span>`).join('');
        template = template.replace(/<div class="brief-track"[^>]*>[\s\S]*?<\/div>/, `<div class="brief-track" id="brief-track">\n${spans}${spans}\n</div>`);
    }

    published.forEach(a => {
        const seoTitle = a.seoTitle || a.title;
        const metaDesc = a.metaDesc || a.excerpt || '';
        const date     = new Date(a.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        const readTime = readingTime(a.content);
        const tags = a.tags ? a.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const author = a.author || 'The Clarified Editorial Team';
        
        let contentHtml = a.content || '';
        
        // Strip out inline styles that break the layout when pasting from other sites
        contentHtml = contentHtml.replace(/ style="[^"]*"/gi, '');
        contentHtml = normalizeTables(contentHtml);
        
        const tocLinks = [];
        contentHtml = contentHtml.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, text) => {
            const innerText = text.replace(/<[^>]+>/g, '').trim();
            const slug = innerText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            tocLinks.push(`<li><a href="#${slug}">${innerText}</a></li>`);
            return `<h2 id="${slug}">${text}</h2>`;
        });
        
        let tocHtml = '';
        if (tocLinks.length > 0) {
            tocHtml = `\n      <div class="what-to-expect-box">\n        <h3>WHAT TO EXPECT</h3>\n        <ul>\n          ${tocLinks.join('\n          ')}\n        </ul>\n      </div>`;
        }
        
        const related = published.filter(p => p.id !== a.id).slice(0, 3);
        const relatedHtml = related.map(cardHTML).join('\n');

        const mainBlock = `<main>
  <article class="container article-page" id="article-view">
    <header class="article-header-text" style="text-align: center; margin-bottom: 24px;">
      <div class="article-kicker">${(a.category || 'Article').split(',')[0].trim()} &middot; ${date} &middot; ${readTime} min read</div>
      <h1 style="margin: 10px auto; text-align: center; max-width: 860px;">${a.title}</h1>
      <p class="article-dek" style="margin: 18px auto 25px; max-width: 800px; text-align: center;">${a.excerpt || ''}</p>
    </header>
    ${a.featuredImage ? `
    <div class="clarified-single-header">
      <img src="${resolveImgUrl(a.featuredImage)}" class="article-hero-image" alt="${a.imgAlt || a.title}" loading="eager" fetchpriority="high" decoding="async">
    </div>` : ''}
    <div class="article-body">${tocHtml}
      ${contentHtml}
    </div>
    
    <div class="article-author">
      <div class="author-mark">${author.charAt(0) || 'C'}</div>
      <div>
        <strong>By ${author}</strong>
        <div>Published ${date}</div>
      </div>
    </div>
    
    ${tags.length ? `
    <div class="article-tags">
      ${tags.map(t => `<span>${t}</span>`).join('')}
    </div>` : ''}
    
    <div class="article-share">
      <strong>Share this article</strong>
      <div class="share-buttons">
        <a class="share-btn share-whatsapp" href="https://api.whatsapp.com/send?text=${encodeURIComponent(a.title)}%20${encodeURIComponent('https://clarified.co.za/articles/' + a.slug + '.html')}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          <span>WhatsApp</span>
        </a>
        <a class="share-btn share-facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://clarified.co.za/articles/' + a.slug + '.html')}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M13.5 21v-7.5h2.5l.5-3h-3V8.5c0-.9.3-1.5 1.6-1.5H16.5V4.3c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10.5H7.5v3H10V21h3.5z"/></svg>
          <span>Facebook</span>
        </a>
        <a class="share-btn share-twitter" href="https://twitter.com/intent/tweet?url=${encodeURIComponent('https://clarified.co.za/articles/' + a.slug + '.html')}&text=${encodeURIComponent(a.title)}" target="_blank" rel="noopener noreferrer" aria-label="Share on Twitter">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          <span>Twitter</span>
        </a>
        <button type="button" class="share-btn share-instagram" aria-label="Share on Instagram">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1"/></svg>
          <span>Instagram</span>
        </button>
        <button type="button" class="share-btn share-tiktok" aria-label="Share on TikTok">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 2.25-1.15 4.39-2.9 5.8-1.75 1.39-4.04 2.15-6.28 1.96-2.21-.19-4.32-1.2-5.78-2.88-1.45-1.67-2.26-3.88-2.15-6.1.11-2.24 1.17-4.34 2.91-5.75 1.76-1.4 4.05-2.13 6.29-1.93h.05V12.1c-1.12-.13-2.26.07-3.21.6-1.07.57-1.87 1.56-2.17 2.73-.31 1.2.06 2.47.88 3.39.81.9 2.05 1.35 3.27 1.25 1.23-.1 2.37-.8 3.01-1.85.5-.83.74-1.81.7-2.78V.02h.01Z"/></svg>
          <span>TikTok</span>
        </button>
        <button type="button" class="share-btn share-copy" aria-label="Copy link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span>Copy link</span>
        </button>
      </div>
    </div>

    ${relatedHtml ? `
    <section class="container section" style="margin-top: 50px; padding: 0;">
      <div class="section-head"><div><span class="eyebrow">KEEP READING</span><h2>More from Clarified</h2></div></div>
      <div class="news-grid">${relatedHtml}</div>
    </section>` : ''}
  </article>
</main>`;

        let out = template.replace(/<main>[\s\S]*?<\/main>/, mainBlock);
        out = out.replace(/<title>.*?<\/title>/, `<title>${seoTitle} &mdash; Clarified</title>`);
        out = out.replace(/href="style\.css"/g, 'href="/style.css?v=2.3"');
        out = out.replace(/href="\/style\.css(?:\?v=[^"]*)?"/g, 'href="/style.css?v=2.3"');
        
        const isoDate = new Date(a.date).toISOString();
        const absoluteUrl = 'https://clarified.co.za/articles/' + a.slug + '.html';
        const absoluteImg = resolveAbsoluteImgUrl(a.featuredImage);
        const indexingContent = `${a.indexing || 'index'}, ${a.followLinks || 'follow'}`;
        const canonicalUrl = a.canonical || absoluteUrl;
        
        let seoMeta = `
<meta name="description" content="${metaDesc}">
<meta name="robots" content="${indexingContent}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:title" content="${seoTitle}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:url" content="${absoluteUrl}">
<meta property="og:type" content="article">
${absoluteImg ? `<meta property="og:image" content="${absoluteImg}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${seoTitle}">
<meta name="twitter:description" content="${metaDesc}">
${absoluteImg ? `<meta name="twitter:image" content="${absoluteImg}">` : ''}
`;
        
        const jsonLd = {
            "@context": "https://schema.org",
            "@type": a.articleType || "Article",
            "headline": seoTitle,
            "image": absoluteImg ? [absoluteImg] : [],
            "datePublished": isoDate,
            "dateModified": isoDate,
            "author": {
                "@type": "Person",
                "name": author,
                "url": "https://clarified.co.za/author/" + author.toLowerCase().replace(/[^a-z]+/g, '-')
            },
            "publisher": {
                "@type": "Organization",
                "name": "Clarified",
                "url": "https://clarified.co.za"
            }
        };
        seoMeta += `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>\n`;

        out = out.replace('</head>', seoMeta + '</head>');

        const dir = path.join(SITE_ROOT, 'articles');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${a.slug}.html`), out);
    });
    
    // Also generate category pages
    const catMap = {
        'south-africa': 'South Africa',
        'world': 'World',
        'technology': 'Technology',
        'business': 'Business',
        'sport': 'Sport',
        'education': 'Education',
        'genz-youth': 'GenZ & Youth',
        'africa-news': 'Africa',
        'lifestyle': 'Lifestyle',
        'automotive': 'Automotive'
    };
    const categories = Object.keys(catMap);

    categories.forEach(catSlug => {
        const catName = catMap[catSlug];
        const catMatches = published.filter(a => {
            if (!a.category) return false;
            return a.category.split(',').some(c => {
                const s = c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                return s === catSlug || (catSlug === 'genz-youth' && (s === 'gen-z-youth' || s === 'genz-youth'));
            });
        });

        const cardsHtml = catMatches.length > 0 
            ? catMatches.map(cardHTML).join('\n')
            : '<div class="empty-state" style="grid-column: 1 / -1;"><h2>No articles yet</h2><p>Check back soon for updates.</p></div>';

        const mainBlock = `<main>
  <section class="container page-head">
    <h1>${catName}</h1>
    <p>Latest articles in ${catName}</p>
  </section>
  <section class="container section">
    <div class="category-grid" id="cat-grid">
      ${cardsHtml}
    </div>
  </section>
</main>`;
        let out = template.replace(/<main>[\s\S]*?<\/main>/, mainBlock);
        out = out.replace(/<title>.*?<\/title>/, `<title>${catName} &mdash; Clarified</title>`);
        
        // Update active nav state
        out = out.replace(new RegExp(`<a href="/category-${catSlug}.html">`, 'g'), `<a href="/category-${catSlug}.html" class="active">`);
        
        fs.writeFileSync(path.join(SITE_ROOT, `category-${catSlug}.html`), out);
    });

    // ── Generate index.html statically ────────────────────────────────────────
    if (fs.existsSync(path.join(DASHBOARD_ROOT, 'index-template.html'))) {
        let idx = fs.readFileSync(path.join(DASHBOARD_ROOT, 'index-template.html'), 'utf8');
        
        const shown = new Set();

        // 1. Brief ticker
        if (published.length) {
            const spans = published.slice(0, 8).map(a => `<span><a href="${articleUrl(a)}" style="color:inherit;text-decoration:none;">${a.title}</a></span>`).join('');
            idx = idx.replace(/<div class="brief-track"[^>]*>[\s\S]*?<\/div>/, `<div class="brief-track" id="brief-track">\n${spans}${spans}\n</div>`);
        }

        if (published.length) {
            const hero = published[0];
            shown.add(hero.id);

            // Side stories: look for 'homepage-space' category first (matching WordPress)
            let sideArticles = published.filter(a => !shown.has(a.id) && a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'homepage-space')).slice(0, 2);
            if (sideArticles.length < 2) {
                const extra = published.filter(a => !shown.has(a.id) && !sideArticles.some(s => s.id === a.id)).slice(0, 2 - sideArticles.length);
                sideArticles = sideArticles.concat(extra);
            }
            sideArticles.forEach(a => shown.add(a.id));

            const heroSideHtml = sideArticles.map(a => `<div class="list-card">
              <a class="list-card-img" href="${articleUrl(a)}"><img src="${resolveImgUrl(a.featuredImage)}" alt="${a.imgAlt || a.title}"></a>
              <div>
                <div class="eyebrow">${(a.category || '').split(',')[0].trim()}</div>
                <h3><a href="${articleUrl(a)}">${a.title}</a></h3>
                <p>${formatExcerpt(a.excerpt, 80)}</p>
              </div>
            </div>`).join('');
            
            const heroHtml = `<article class="hero-story" id="hero-story">
              <img id="hero-img" src="${resolveImgUrl(hero.featuredImage)}" alt="${hero.title}">
              <div class="hero-content">
                <div class="meta" id="hero-meta"><span class="tag">TOP STORY</span> ${(hero.category || '').split(',')[0].trim()} &middot; ${readingTime(hero.content)} min read</div>
                <h2><a id="hero-link" href="${articleUrl(hero)}">${hero.title}</a></h2>
                <p id="hero-excerpt">${formatExcerpt(hero.excerpt, 160)}</p>
                <a class="read-link" id="hero-read" href="${articleUrl(hero)}">Read the story <span class="ui-arrow">→</span></a>
              </div>
            </article>
            <aside class="hero-side" id="hero-side">\n${heroSideHtml}\n</aside>`;
            
            idx = idx.replace(/<section class="container hero-grid"[^>]*>[\s\S]*?<\/section>/, `<section class="container hero-grid" id="hero-section">\n${heroHtml}\n</section>`);
            
            // Latest (4 articles)
            const latest = published.filter(a => !shown.has(a.id)).slice(0, 4);
            latest.forEach(a => shown.add(a.id));
            idx = idx.replace(/<div class="news-grid" id="latest-grid">[\s\S]*?<\/div>/, `<div class="news-grid" id="latest-grid">\n${latest.map(cardHTML).join('\n')}\n</div>`);

            // Featured / Must Read (3 articles: lifestyle/entertainment first)
            let featuredPosts = published.filter(a => !shown.has(a.id) && a.category && a.category.split(',').some(c => {
                const s = c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
                return s === 'lifestyle' || s === 'entertainment';
            })).slice(0, 3);
            if (featuredPosts.length < 3) {
                const fill = published.filter(a => !shown.has(a.id) && !featuredPosts.some(f => f.id === a.id)).slice(0, 3 - featuredPosts.length);
                featuredPosts = featuredPosts.concat(fill);
            }
            if (featuredPosts.length) {
                const large = featuredPosts[0];
                const compact = featuredPosts.slice(1);
                shown.add(large.id);
                compact.forEach(a => shown.add(a.id));
                const largeHtml = `<article class="large-story" id="featured">
                  <img src="${resolveImgUrl(large.featuredImage)}" alt="${large.title}">
                  <div class="story-overlay">
                    <div class="meta">${(large.category || '').split(',')[0].trim()} · ${readingTime(large.content)} min read</div>
                    <h3><a href="${articleUrl(large)}">${large.title}</a></h3>
                    <p>${formatExcerpt(large.excerpt, 130)}</p>
                    <a class="read-link" href="${articleUrl(large)}">Read story <span class="ui-arrow">→</span></a>
                  </div>
                </article>`;
                const compactHtml = compact.map(a => `<article class="compact-story">
                  <a href="${articleUrl(a)}"><img src="${resolveImgUrl(a.featuredImage)}" alt="${a.imgAlt || a.title}" style="height:145px;border-radius:9px;object-fit:cover;width:100%;"></a>
                  <div>
                    <div class="eyebrow">${(a.category || '').split(',')[0].trim()}</div>
                    <h3><a href="${articleUrl(a)}">${a.title}</a></h3>
                    <a class="read-meta" href="${articleUrl(a)}">Read story →</a>
                  </div>
                </article>`).join('');
                idx = idx.replace(/<div class="featured-grid" id="featured-grid">[\s\S]*?<\/div>/, `<div class="featured-grid" id="featured-grid">\n${largeHtml}\n<div class="two-stories" id="compact">\n${compactHtml}\n</div>\n</div>`);
            }

            // Editor's Pick
            let ep = published.find(a => !shown.has(a.id) && a.category && (a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'editors-pick') || (a.tags && a.tags.includes("Editor's Pick"))));
            if (!ep) ep = published.find(a => !shown.has(a.id));
            if (ep) {
                shown.add(ep.id);
                const epHtml = `<section class="container section" id="editors-pick-section">
                  <div class="section-head"><div><span class="eyebrow">EDITORIAL</span><h2>Editor's Pick</h2></div><a href="/category-editors-pick.html">View all <span class="ui-arrow">→</span></a></div>
                  <article class="editor-pick" id="editors-pick">
                    <img id="ep-img" src="${resolveImgUrl(ep.featuredImage)}" alt="${ep.title}">
                    <div class="editor-content">
                      <div class="meta" id="ep-meta">${(ep.category || '').split(',')[0].trim()} · ${readingTime(ep.content)} min read</div>
                      <h3><a id="ep-link" href="${articleUrl(ep)}">${ep.title}</a></h3>
                      <p id="ep-excerpt">${formatExcerpt(ep.excerpt, 150)}</p>
                      <a class="read-link" id="ep-read" href="${articleUrl(ep)}">Read story <span class="ui-arrow">→</span></a>
                    </div>
                  </article>
                </section>`;
                idx = idx.replace(/<section class="container section" id="editors-pick-section"[^>]*>[\s\S]*?<\/section>/, epHtml);
            }

            // Business & Sport (Populate 2 cards each to eliminate blank space)
            let busArticles = published.filter(a => !shown.has(a.id) && a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business')).slice(0, 2);
            if (busArticles.length < 2) {
                const extra = published.filter(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business') && !busArticles.some(b => b.id === a.id)).slice(0, 2 - busArticles.length);
                busArticles = busArticles.concat(extra);
            }
            if (busArticles.length) {
                busArticles.forEach(a => shown.add(a.id));
                idx = idx.replace(/<div class="small-grid" id="business-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="business-grid">\n${busArticles.map(cardHTML).join('\n')}\n</div>`);
            }

            let sportArticles = published.filter(a => !shown.has(a.id) && a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport')).slice(0, 2);
            if (sportArticles.length < 2) {
                const extra = published.filter(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport') && !sportArticles.some(s => s.id === a.id)).slice(0, 2 - sportArticles.length);
                sportArticles = sportArticles.concat(extra);
            }
            if (sportArticles.length) {
                sportArticles.forEach(a => shown.add(a.id));
                idx = idx.replace(/<div class="small-grid" id="sport-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="sport-grid">\n${sportArticles.map(cardHTML).join('\n')}\n</div>`);
            }
        }
        
        fs.writeFileSync(path.join(SITE_ROOT, 'index.html'), idx);

        // Update brief ticker in other static pages (about, contact, privacy, search)
        if (published.length) {
            const spans = published.slice(0, 8).map(a => `<span><a href="${articleUrl(a)}" style="color:inherit;text-decoration:none;">${a.title}</a></span>`).join('');
            const tickerBlock = `<div class="brief-strip">\n  <div class="container brief-inner">\n    <div class="brief-message" aria-label="Clarified Brief">\n      <div class="brief-track" id="brief-track">\n${spans}${spans}\n      </div>\n    </div>\n  </div>\n</div>`;
            const staticPages = ['about.html', 'contact.html', 'privacy.html', 'search.html'];
            staticPages.forEach(p => {
                const filePath = path.join(SITE_ROOT, p);
                if (fs.existsSync(filePath)) {
                    let pageHtml = fs.readFileSync(filePath, 'utf8');
                    if (pageHtml.includes('class="brief-strip"')) {
                        pageHtml = pageHtml.replace(/<div class="brief-strip"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/, tickerBlock);
                    } else if (pageHtml.includes('</header>')) {
                        pageHtml = pageHtml.replace('</header>', '</header>\n\n' + tickerBlock);
                    }
                    fs.writeFileSync(filePath, pageHtml, 'utf8');
                }
            });
        }
    }
    // Generate robots.txt
    const robotsTxt = `User-agent: *
Allow: /
Allow: /articles/
Allow: /images/
Allow: /category-*.html
Disallow: /dashboard/
Disallow: /api/

User-agent: Googlebot
Allow: /
Allow: /articles/
Allow: /images/
Allow: /category-*.html
Disallow: /dashboard/
Disallow: /api/

User-agent: Googlebot-Image
Allow: /images/

Sitemap: https://clarified.co.za/sitemap.xml`;
    fs.writeFileSync(path.join(SITE_ROOT, 'robots.txt'), robotsTxt);
    
    // Generate sitemap.xml
    function escapeXml(str) {
        if (!str) return '';
        return String(str).replace(/[<>&'"]/g, c => {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
        });
    }

    const todayDate = new Date().toISOString().split('T')[0];
    const categorySlugs = [
        'category-south-africa.html',
        'category-africa-news.html',
        'category-business.html',
        'category-technology.html',
        'category-sport.html',
        'category-education.html',
        'category-genz-youth.html',
        'category-lifestyle.html',
        'category-automotive.html',
        'category-world.html'
    ];

    const sitemapEntries = [
        `  <url>\n    <loc>https://clarified.co.za/</loc>\n    <lastmod>${todayDate}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`
    ];

    categorySlugs.forEach(cat => {
        sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/${cat}</loc>\n    <lastmod>${todayDate}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`);
    });

    published.forEach(a => {
        const slug = a.slug || a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const aDate = new Date(a.updatedAt || a.date || Date.now()).toISOString().split('T')[0];
        const priority = (a.homepagePlacement === 'top_story' || a.homepagePlacement === 'editors_pick') ? '0.9' : '0.8';
        let imgXml = '';
        if (a.featuredImage) {
            const imgUrl = a.featuredImage.startsWith('http') ? a.featuredImage : `https://clarified.co.za/${a.featuredImage.replace(/^\//, '')}`;
            imgXml = `\n    <image:image>\n      <image:loc>${escapeXml(imgUrl)}</image:loc>\n      <image:title>${escapeXml(a.title)}</image:title>\n    </image:image>`;
        }
        sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/articles/${slug}.html</loc>\n    <lastmod>${aDate}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>${imgXml}\n  </url>`);
    });

    ['about.html', 'contact.html', 'privacy.html'].forEach(page => {
        sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/${page}</loc>\n    <lastmod>${todayDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`);
    });

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${sitemapEntries.join('\n')}
</urlset>`;
    fs.writeFileSync(path.join(SITE_ROOT, 'sitemap.xml'), sitemapXml);

}

// ─── Body parser helper ───────────────────────────────────────────────────────
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => body += c.toString());
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        req.on('error', reject);
    });
}

function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// ─── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {

    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url    = req.url.split('?')[0];
    const method = req.method;

    // ── GET /api/stats ──────────────────────────────────────────────────────
    if (method === 'GET' && url === '/api/stats') {
        const db = getDB();
        return json(res, {
            total:     db.articles.length,
            published: db.articles.filter(a => a.status === 'published').length,
            drafts:    db.articles.filter(a => a.status === 'draft').length
        });
    }

    // ── GET /api/articles ───────────────────────────────────────────────────
    if (method === 'GET' && url === '/api/articles') {
        const db = getDB();
        return json(res, db.articles.sort((a, b) => b.date - a.date));
    }

    // ── GET /api/articles/:id ───────────────────────────────────────────────
    if (method === 'GET' && url.startsWith('/api/articles/')) {
        const id = url.replace('/api/articles/', '');
        const db = getDB();
        const article = db.articles.find(a => String(a.id) === String(id));
        if (!article) return json(res, { error: 'Not found' }, 404);
        return json(res, article);
    }

    // ── POST /api/upload ────────────────────────────────────────────────────
    if (method === 'POST' && url === '/api/upload') {
        try {
            const data = await readBody(req);
            if (!data.image) return json(res, { error: 'No image provided' }, 400);
            
            // image is base64 string "data:image/png;base64,iVBORw0KGgo..."
            const matches = data.image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) return json(res, { error: 'Invalid base64 string' }, 400);
            
            let ext = (matches[1].split('/')[1] || 'png').toLowerCase();
            if (ext === 'jpeg') ext = 'jpg';
            if (ext.includes('+')) ext = ext.split('+')[0];
            
            const buffer = Buffer.from(matches[2], 'base64');
            const filename = `upload_${Date.now()}.${ext}`;
            const imagesDir = path.join(SITE_ROOT, 'images');
            if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
            
            fs.writeFileSync(path.join(imagesDir, filename), buffer);
            
            return json(res, { url: `images/${filename}` });
        } catch (err) {
            console.error(err);
            return json(res, { error: err.message }, 500);
        }
    }

    // ── POST /api/save ──────────────────────────────────────────────────────
    if (method === 'POST' && url === '/api/save') {
        try {
            const data = await readBody(req);
            if (!data.title || !data.title.trim()) return json(res, { error: 'Title is required' }, 400);

            const db   = getDB();
            const slug = (data.slug || data.title)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '');
            const normalizedContent = normalizeTables(data.content || '');

            let article = data.id ? db.articles.find(a => String(a.id) === String(data.id)) : null;

            if (article) {
                // If slug changed, remove old static html file
                if (article.slug && article.slug !== slug) {
                    const oldHtmlFile = path.join(SITE_ROOT, 'articles', `${article.slug}.html`);
                    if (fs.existsSync(oldHtmlFile)) fs.unlinkSync(oldHtmlFile);
                }
                
                // Update existing
                Object.assign(article, {
                    title:    data.title,
                    content:  normalizedContent,
                    excerpt:  data.excerpt  || '',
                    category: data.category || '',
                    author:   data.author   || 'Admin',
                    tags:     data.tags     || '',
                    slug:     slug,
                    status:   data.status   || 'draft',
                    homepagePlacement: data.homepagePlacement || article.homepagePlacement || 'standard',
                    seoTitle: data.seoTitle || '',
                    metaDesc: data.metaDesc || '',
                    focusKw:  data.focusKw  || '',
                    secondaryKw: data.secondaryKw || '',
                    imgAlt: data.imgAlt || '',
                    indexing: data.indexing || 'index',
                    followLinks: data.followLinks || 'follow',
                    articleType: data.articleType || 'Article',
                    canonical: data.canonical || '',
                    featuredImage: data.featuredImage || '',
                    date:     article.date || Date.now(),
                    updatedAt: Date.now()
                });

                if (article.status === 'published') {
                    if (!article.homepagePlacement || article.homepagePlacement === 'standard') {
                        article.homepagePlacement = 'top_story';
                    }
                    shiftHomepageArticles(db.articles, article.id, article.homepagePlacement);
                }
            } else {
                // Create new
                const placement = (data.status === 'published' && (!data.homepagePlacement || data.homepagePlacement === 'standard'))
                    ? 'top_story'
                    : (data.homepagePlacement || 'standard');

                article = {
                    id:       Date.now().toString(),
                    title:    data.title,
                    content:  normalizedContent,
                    excerpt:  data.excerpt  || '',
                    category: data.category || '',
                    author:   data.author   || 'Admin',
                    tags:     data.tags     || '',
                    slug:     slug,
                    status:   data.status   || 'draft',
                    homepagePlacement: placement,
                    seoTitle: data.seoTitle || '',
                    metaDesc: data.metaDesc || '',
                    focusKw:  data.focusKw  || '',
                    secondaryKw: data.secondaryKw || '',
                    imgAlt: data.imgAlt || '',
                    indexing: data.indexing || 'index',
                    followLinks: data.followLinks || 'follow',
                    articleType: data.articleType || 'Article',
                    canonical: data.canonical || '',
                    featuredImage: data.featuredImage || '',
                    date:     Date.now(),
                    updatedAt: Date.now()
                };

                if (article.status === 'published') {
                    shiftHomepageArticles(db.articles, article.id, article.homepagePlacement);
                }

                db.articles.push(article);
            }

            saveDB(db);
            regenerateStaticSite();
            return json(res, { success: true, id: article.id, slug: article.slug });
        } catch (err) {
            console.error(err);
            return json(res, { error: err.message }, 500);
        }
    }

    // ── POST /api/delete ────────────────────────────────────────────────────
    if (method === 'POST' && url === '/api/delete') {
        try {
            const data    = await readBody(req);
            const db      = getDB();
            const article = db.articles.find(a => String(a.id) === String(data.id));
            if (article) {
                db.articles = db.articles.filter(a => String(a.id) !== String(data.id));
                saveDB(db);
                const htmlFile = path.join(SITE_ROOT, 'articles', `${article.slug}.html`);
                if (fs.existsSync(htmlFile)) fs.unlinkSync(htmlFile);
                regenerateStaticSite();
            }
            return json(res, { success: true });
        } catch (err) {
            console.error(err);
            return json(res, { error: err.message }, 500);
        }
    }

    // ── MCP Helpers & Status ────────────────────────────────────────────────
    const MCP_SECRET = process.env.MCP_AUTH_SECRET || "clarified-mcp-editorial-v2-secure-key";

    function generateMcpToken(serverName) {
        const timestamp = Date.now();
        const payload = `${serverName || 'clarified'}:${timestamp}`;
        const sig = crypto.createHmac('sha256', MCP_SECRET).update(payload).digest('hex').substring(0, 32);
        return `mcp_${timestamp}_${sig}`;
    }

    function verifyMcpToken(token, serverName) {
        if (!token || typeof token !== 'string' || !token.startsWith('mcp_')) return false;
        const parts = token.split('_');
        if (parts.length < 3) return false;
        const timestamp = parseInt(parts[1], 10);
        const sig = parts[2];
        if (isNaN(timestamp)) return false;
        if (Date.now() - timestamp > 30 * 24 * 60 * 60 * 1000) return false;

        const namesToCheck = [serverName, 'clarified', 'novamira-clarified-co-za'].filter(Boolean);
        for (const name of namesToCheck) {
            const expectedSig = crypto.createHmac('sha256', MCP_SECRET).update(`${name}:${timestamp}`).digest('hex').substring(0, 32);
            if (sig === expectedSig) return true;
        }
        return false;
    }

    function findMcpConfig() {
        const primaryPath = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\adolp', '.gemini', 'config', 'mcp_config.json');
        const candidatePaths = [
            primaryPath,
            path.join(SITE_ROOT, 'mcp_config.json'),
            path.join(SITE_ROOT, 'config.json'),
            path.join(SITE_ROOT, '.agents', 'mcp_config.json'),
            path.join(DASHBOARD_ROOT, 'mcp_config.json')
        ];

        for (const candidate of candidatePaths) {
            try {
                if (fs.existsSync(candidate)) {
                    const stat = fs.statSync(candidate);
                    if (stat.size > 0) {
                        const raw = fs.readFileSync(candidate, 'utf8').trim();
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            const servers = parsed.mcpServers || {};
                            const serverKeys = Object.keys(servers);
                            if (serverKeys.length > 0) {
                                return {
                                    path: candidate,
                                    hasServers: true,
                                    serverName: serverKeys[0],
                                    serverNames: serverKeys,
                                    servers
                                };
                            }
                        }
                    }
                }
            } catch (e) {}
        }

        // Fallback: check if built-in MCP server exists
        const builtInServer = path.join(SITE_ROOT, 'mcp', 'server.js');
        if (fs.existsSync(builtInServer)) {
            const defaultName = process.env.MCP_SERVER_NAME || 'clarified';
            return {
                path: path.join(SITE_ROOT, 'mcp_config.json'),
                hasServers: true,
                serverName: defaultName,
                serverNames: [defaultName],
                servers: {
                    [defaultName]: {
                        command: 'node',
                        args: ['mcp/server.js'],
                        description: 'Clarified Editorial AI & Publishing Engine'
                    }
                }
            };
        }

        return {
            path: candidatePaths[1],
            hasServers: false,
            serverName: null,
            serverNames: [],
            servers: {}
        };
    }

    function checkLiveMcpProcess() {
        // 1. Check for live SSE clients connected directly to the dashboard
        if (activeSseClients.size > 0) {
            const firstClient = activeSseClients.values().next().value;
            return {
                isLive: true,
                data: {
                    connected: true,
                    client: (firstClient && firstClient.clientName) || 'Web AI (SSE)',
                    transport: 'sse',
                    pid: process.pid,
                    startedAt: (firstClient && firstClient.connectedAt) || Date.now(),
                    lastHeartbeat: Date.now(),
                    toolCount: (mcpEngine && mcpEngine.TOOLS) ? mcpEngine.TOOLS.length : 10
                }
            };
        }

        // 2. Check candidate status files written by Stdio or standalone MCP processes
        const candidatePaths = [
            path.join(DASHBOARD_ROOT, '.mcp-active.json'),
            path.join(SITE_ROOT, 'dashboard', '.mcp-active.json'),
            path.join(SITE_ROOT, 'Clarified Dashboard', '.mcp-active.json'),
            path.join(process.cwd(), 'dashboard', '.mcp-active.json'),
            path.join(process.cwd(), 'Clarified Dashboard', '.mcp-active.json'),
            path.join(process.cwd(), '.mcp-active.json')
        ].filter((p, i, arr) => arr.indexOf(p) === i);

        for (const p of candidatePaths) {
            try {
                if (fs.existsSync(p)) {
                    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                    if (data && data.connected) {
                        const age = Date.now() - (data.lastHeartbeat || 0);
                        // 1. Freshness check: if no heartbeat for > 4s, it's stale
                        if (age > 4000) {
                            try { fs.unlinkSync(p); } catch (e) {}
                            continue;
                        }

                        // 2. Is the MCP node server process still running?
                        if (data.pid) {
                            try {
                                process.kill(data.pid, 0);
                            } catch (err) {
                                try { fs.unlinkSync(p); } catch (e) {}
                                continue;
                            }
                        }

                        // 3. Is the root IDE process (Antigravity, Cursor, Claude Desktop, etc.) still alive?
                        if (data.rootPid) {
                            try {
                                process.kill(data.rootPid, 0);
                            } catch (err) {
                                if (data.pid && data.pid !== process.pid) {
                                    try { process.kill(data.pid, 'SIGKILL'); } catch (k) {}
                                }
                                try { fs.unlinkSync(p); } catch (e) {}
                                continue;
                            }
                        }

                        // 4. Is the parent process still alive?
                        if (data.parentPid) {
                            try {
                                process.kill(data.parentPid, 0);
                            } catch (err) {
                                if (data.pid && data.pid !== process.pid) {
                                    try { process.kill(data.pid, 'SIGKILL'); } catch (k) {}
                                }
                                try { fs.unlinkSync(p); } catch (e) {}
                                continue;
                            }
                        }

                        return { isLive: true, data };
                    }
                }
            } catch (e) {}
        }
        return { isLive: false, data: null };
    }

    function checkMcpAuth(req, serverName) {
        const live = checkLiveMcpProcess();
        if (live.isLive) {
            return {
                authenticated: true,
                session: {
                    live: true,
                    client: 'Antigravity',
                    pid: live.data.pid,
                    transport: live.data.transport || 'stdio'
                }
            };
        }

        const sessionPaths = [
            path.join(DASHBOARD_ROOT, '.mcp-session.json'),
            path.join(SITE_ROOT, 'dashboard', '.mcp-session.json'),
            path.join(SITE_ROOT, 'Clarified Dashboard', '.mcp-session.json'),
            path.join(process.cwd(), '.mcp-session.json')
        ];
        for (const sp of sessionPaths) {
            try {
                if (fs.existsSync(sp)) {
                    const sData = JSON.parse(fs.readFileSync(sp, 'utf8'));
                    if (sData && sData.connected && sData.token && verifyMcpToken(sData.token, serverName)) {
                        return {
                            authenticated: true,
                            session: {
                                live: true,
                                client: 'Antigravity',
                                transport: 'stdio'
                            }
                        };
                    }
                }
            } catch(e) {}
        }

        const authHeader = (req.headers && (req.headers['authorization'] || req.headers['x-mcp-auth'])) || '';
        let token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!token && req.url) {
            try {
                const parsedUrl = new URL(req.url, 'http://localhost');
                token = parsedUrl.searchParams.get('token') || '';
            } catch(e) {}
        }

        if (token && verifyMcpToken(token, serverName)) {
            return {
                authenticated: true,
                session: {
                    live: true,
                    client: 'Antigravity',
                    transport: 'stdio'
                }
            };
        }

        return { authenticated: false, session: null };
    }

    const mcpToolsCatalog = [
        {
            name: "validate_article_quality",
            category: "Editorial Standards",
            summary: "Automated editorial quality gate checking word count, readability, keyword density, structure, and meta tags.",
            parameters: ["title", "content", "focusKeyword", "metaDescription", "readingTime"],
            qualityChecks: [
                "Word count >= 600 words",
                "Focus keyword in title & first 100 words",
                "Keyword density between 0.5% and 2.5%",
                "Meta description between 120 and 160 characters",
                "Heading structure (H2, H3 hierarchy)",
                "Flesch Reading Ease score"
            ],
            examplePrompt: "Validate the quality of this draft article before publishing."
        },
        {
            name: "detect_duplicates",
            category: "Content Integrity",
            summary: "Checks article title, slug, and text against all existing articles to prevent duplicate coverage and cannibalization.",
            parameters: ["title", "slug", "content"],
            qualityChecks: ["Title similarity scoring", "Slug collision prevention", "Topical overlap scan"],
            examplePrompt: "Check if we already published an article covering this topic."
        },
        {
            name: "suggest_internal_links",
            category: "SEO & Linking",
            summary: "Analyzes draft content and suggests contextual internal links to published Clarified articles with anchor tags.",
            parameters: ["content", "category", "maxSuggestions"],
            qualityChecks: ["Contextual relevance", "Ready-to-paste HTML anchor snippets"],
            examplePrompt: "Suggest 3 relevant internal links to existing Clarified articles for this draft."
        },
        {
            name: "publish_article",
            category: "Deployment & Publishing",
            summary: "Enforces quality gates, updates database, regenerates sitemap.xml & RSS, and commits directly to GitHub for live Vercel deployment.",
            parameters: ["title", "content", "category", "author", "excerpt", "image", "focusKeyword", "metaDescription"],
            qualityChecks: ["Auto quality validation", "Auto sitemap update", "Auto RSS feed update", "Live GitHub commit"],
            examplePrompt: "Publish this article to Clarified.co.za and deploy live."
        },
        {
            name: "edit_article",
            category: "Article Management",
            summary: "Updates existing article content, metadata, or status and triggers automatic deployment.",
            parameters: ["id", "slug", "title", "content", "category", "author", "status"],
            qualityChecks: ["Selective field updates", "Live sync with GitHub repository"],
            examplePrompt: "Update article #5 with a refreshed conclusion and save."
        },
        {
            name: "list_articles",
            category: "Search & Retrieval",
            summary: "Searches, filters by category or status, and paginates through all articles in the repository.",
            parameters: ["status", "category", "query", "limit", "offset"],
            qualityChecks: ["Instant full-text query", "Category filtering"],
            examplePrompt: "List the 5 most recent published articles in Technology."
        },
        {
            name: "get_article",
            category: "Search & Retrieval",
            summary: "Retrieves complete article data, HTML content, SEO metadata, and publication date by ID or slug.",
            parameters: ["id", "slug"],
            qualityChecks: ["Full HTML body retrieval", "Editorial metadata inspection"],
            examplePrompt: "Fetch the full HTML content and details for article with slug 'south-africa-energy'."
        },
        {
            name: "delete_article",
            category: "Article Management",
            summary: "Safely deletes an article, removes its generated HTML page, and updates sitemaps on GitHub.",
            parameters: ["id", "slug"],
            qualityChecks: ["Database removal", "GitHub file cleanup", "Sitemap sync"],
            examplePrompt: "Delete draft article with ID '1728394012'."
        },
        {
            name: "get_search_analytics",
            category: "Search Performance",
            summary: "Queries Google Search Console API for real-time clicks, impressions, average CTR, average position, and top queries.",
            parameters: ["startDate", "endDate", "dimensions", "rowLimit"],
            qualityChecks: ["Google Search Console API", "Top query breakdown", "Top page performance"],
            examplePrompt: "Show me Google Search Console clicks and top search queries for the past 28 days."
        },
        {
            name: "get_content_opportunities",
            category: "Search Performance",
            summary: "Finds high-potential keywords: queries ranking on page 2 (positions 8-20) and high-impression queries with low CTR.",
            parameters: ["days", "opportunityType"],
            qualityChecks: ["Striking distance keyword identification", "Low-CTR opportunity detection"],
            examplePrompt: "Find high-impression keywords ranking on page 2 of Google that we can write new articles about."
        }
    ];

    // ── GET /api/mcp-status ─────────────────────────────────────────────────
    if (method === 'GET' && url === '/api/mcp-status') {
        try {
            const configInfo = findMcpConfig();
            const authInfo = checkMcpAuth(req, configInfo.serverName);
            const db = getDB();
            const articles = db.articles || [];
            const totalArticles = articles.length;
            const publishedArticles = articles.filter(a => a.status === 'published').length;
            const draftArticles = articles.filter(a => a.status === 'draft').length;
            const toolsCatalog = (mcpEngine && mcpEngine.TOOLS) ? mcpEngine.TOOLS : mcpToolsCatalog;
            const sseUrl = `http://localhost:${PORT}/api/mcp/sse`;

            if (!configInfo.hasServers) {
                return json(res, {
                    connected: false,
                    configured: false,
                    status: "no_config",
                    configPath: configInfo.path,
                    serverName: null,
                    serverNames: [],
                    message: `No MCP server configured in config.json. Add your clarified server configuration to connect Antigravity.`,
                    protocol: "Model Context Protocol (MCP) v2024-11-05",
                    sseUrl,
                    toolCount: 0,
                    tools: [],
                    allTools: toolsCatalog
                });
            }

            if (!authInfo.authenticated) {
                return json(res, {
                    connected: false,
                    configured: true,
                    status: "standby",
                    client: "Antigravity",
                    configPath: configInfo.path,
                    serverName: configInfo.serverName,
                    serverNames: configInfo.serverNames,
                    message: `Server "${configInfo.serverName}" is ready for Antigravity.`,
                    protocol: "Model Context Protocol (MCP) v2024-11-05",
                    sseUrl,
                    toolCount: toolsCatalog.length,
                    tools: [],
                    allTools: toolsCatalog
                });
            }

            const clientName = (authInfo.session && authInfo.session.client) || 'Antigravity';
            const pid = authInfo.session && authInfo.session.pid;
            const transport = (authInfo.session && authInfo.session.transport) || 'stdio';

            return json(res, {
                connected: true,
                configured: true,
                status: "ready",
                client: clientName,
                transport,
                pid,
                live: true,
                configPath: configInfo.path,
                serverName: configInfo.serverName,
                serverNames: configInfo.serverNames,
                message: `Connected: Antigravity Active (10 Tools Loaded)`,
                protocol: "Model Context Protocol (MCP) v2024-11-05",
                serverScript: "mcp/server.js",
                sseUrl,
                environment: {
                    githubOwner: 'adolph-mulangatshivalo',
                    githubRepo: 'Clarified.co.za',
                    githubBranch: 'main',
                    githubSyncEnabled: false,
                    searchConsoleProperty: "https://clarified.co.za/",
                    searchConsoleConfigured: true,
                    totalArticles,
                    publishedArticles,
                    draftArticles
                },
                toolCount: toolsCatalog.length,
                tools: toolsCatalog,
                allTools: toolsCatalog
            });
        } catch(e) {
            return json(res, { connected: false, configured: false, status: "error", error: e.message }, 500);
        }
    }

    // ── MCP SSE Transport Stream (GET /api/mcp/sse) ───────────────────────────
    if (method === 'GET' && url === '/api/mcp/sse') {
        const sessionId = crypto.randomBytes(16).toString('hex');
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        activeSseClients.set(sessionId, {
            res,
            clientName: 'Web AI (SSE)',
            connectedAt: Date.now()
        });

        // Send official MCP endpoint event declaring POST URL for JSON-RPC messages
        res.write(`event: endpoint\ndata: /api/mcp/messages?sessionId=${sessionId}\n\n`);

        req.on('close', () => {
            activeSseClients.delete(sessionId);
        });
        return;
    }

    // ── MCP SSE Messages (POST /api/mcp/messages) ─────────────────────────────
    if (method === 'POST' && url.startsWith('/api/mcp/messages')) {
        try {
            const parsedUrl = new URL(url, `http://localhost:${PORT}`);
            const sessionId = parsedUrl.searchParams.get('sessionId');
            const client = activeSseClients.get(sessionId);

            const rpcReq = await readBody(req);
            let rpcRes = null;

            if (mcpEngine && mcpEngine.executeRpc) {
                rpcRes = await mcpEngine.executeRpc(rpcReq, { transport: 'sse' });
                if (rpcReq.params && rpcReq.params.clientInfo && client) {
                    client.clientName = rpcReq.params.clientInfo.name || 'Web AI (SSE)';
                }
            } else {
                rpcRes = { jsonrpc: '2.0', id: rpcReq.id, error: { code: -32603, message: 'MCP engine unavailable' } };
            }

            if (client && !rpcRes.notification) {
                client.res.write(`event: message\ndata: ${JSON.stringify(rpcRes)}\n\n`);
            }

            return json(res, { accepted: true }, 202);
        } catch (e) {
            return json(res, { error: e.message }, 400);
        }
    }

    // ── Interactive Tool Test Endpoint (POST /api/mcp/test-tool) ──────────────
    if (method === 'POST' && url === '/api/mcp/test-tool') {
        try {
            const data = await readBody(req);
            const toolName = data.tool;
            const toolArgs = data.args || {};

            if (!toolName) {
                return json(res, { success: false, error: 'Missing "tool" name parameter.' }, 400);
            }

            if (!mcpEngine || !mcpEngine.executeTool) {
                return json(res, { success: false, error: 'MCP Engine is not available.' }, 500);
            }

            const result = await mcpEngine.executeTool(toolName, toolArgs);
            return json(res, { success: true, tool: toolName, result });
        } catch (err) {
            return json(res, { success: false, error: err.message }, 500);
        }
    }

    // ── MCP Disconnect & Force Kill (POST /api/mcp-disconnect & /api/mcp-kill) ─
    if (method === 'POST' && (url === '/api/mcp-disconnect' || url === '/api/mcp-kill')) {
        try {
            const candidatePaths = [
                path.join(DASHBOARD_ROOT, '.mcp-active.json'),
                path.join(SITE_ROOT, 'dashboard', '.mcp-active.json'),
                path.join(SITE_ROOT, 'Clarified Dashboard', '.mcp-active.json'),
                path.join(process.cwd(), 'dashboard', '.mcp-active.json'),
                path.join(process.cwd(), 'Clarified Dashboard', '.mcp-active.json'),
                path.join(process.cwd(), '.mcp-active.json')
            ].filter((p, i, arr) => arr.indexOf(p) === i);

            // 1. Terminate any active background MCP child process if found
            for (const p of candidatePaths) {
                try {
                    if (fs.existsSync(p)) {
                        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                        if (data && data.pid && data.pid !== process.pid) {
                            try { process.kill(data.pid, 'SIGTERM'); } catch (e) {}
                            setTimeout(() => {
                                try { process.kill(data.pid, 'SIGKILL'); } catch (e) {}
                            }, 300);
                        }
                        fs.unlinkSync(p);
                    }
                } catch (e) {}
            }

            // Also forcefully stop any orphaned node processes running mcp/server.js
            try {
                if (process.platform === 'win32') {
                    const killCmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*mcp/server.js*\' -and $_.ProcessId -ne ' + process.pid + ' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"';
                    require('child_process').execSync(killCmd, { timeout: 3000, stdio: 'ignore' });
                }
            } catch(e) {}

            // 2. Remove session cache
            const sessionPath = path.join(DASHBOARD_ROOT, '.mcp-session.json');
            if (fs.existsSync(sessionPath)) {
                try { fs.unlinkSync(sessionPath); } catch (e) {}
            }

            // 3. Close any active SSE streams
            for (const [id, client] of activeSseClients.entries()) {
                try {
                    client.res.end();
                } catch (e) {}
            }
            activeSseClients.clear();

            if (mcpEngine && mcpEngine.cleanupLiveStatus) {
                mcpEngine.cleanupLiveStatus();
            }

            return json(res, {
                success: true,
                connected: false,
                message: 'MCP server disconnected cleanly. All background processes and sessions terminated.'
            });
        } catch (e) {
            return json(res, { success: false, error: e.message }, 500);
        }
    }

    // ── POST /api/mcp-auth (Compatibility) ───────────────────────────────────
    if (method === 'POST' && url === '/api/mcp-auth') {
        try {
            const data = await readBody(req);
            const action = data.action || 'authenticate';

            if (action === 'disconnect') {
                const candidatePaths = [
                    path.join(DASHBOARD_ROOT, '.mcp-active.json'),
                    path.join(SITE_ROOT, 'dashboard', '.mcp-active.json'),
                    path.join(SITE_ROOT, 'Clarified Dashboard', '.mcp-active.json')
                ];
                for (const p of candidatePaths) {
                    try {
                        if (fs.existsSync(p)) {
                            const d = JSON.parse(fs.readFileSync(p, 'utf8'));
                            if (d && d.pid && d.pid !== process.pid) {
                                try { process.kill(d.pid, 'SIGTERM'); } catch(e) {}
                            }
                            fs.unlinkSync(p);
                        }
                    } catch(e) {}
                }
                const sessionPath = path.join(DASHBOARD_ROOT, '.mcp-session.json');
                if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
                return json(res, { success: true, connected: false, message: 'MCP disconnected successfully.' });
            }

            const configInfo = findMcpConfig();
            if (!configInfo.hasServers) {
                return json(res, {
                    success: false,
                    connected: false,
                    error: 'No MCP server configured in config.json. Please add your server configuration to config.json first before authenticating.',
                    configPath: configInfo.path
                }, 400);
            }

            const token = generateMcpToken(configInfo.serverName);
            const sessionData = {
                connected: true,
                serverName: configInfo.serverName,
                configPath: configInfo.path,
                authenticatedAt: Date.now(),
                token
            };
            const sessionPath = path.join(DASHBOARD_ROOT, '.mcp-session.json');
            fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf8');

            return json(res, {
                success: true,
                connected: true,
                serverName: configInfo.serverName,
                token,
                message: `Successfully authenticated and connected to ${configInfo.serverName}.`
            });
        } catch(e) {
            return json(res, { success: false, connected: false, error: e.message }, 500);
        }
    }

    // ── Static file server ──────────────────────────────────────────────────
    let filePath;
    if (url.startsWith('/dashboard')) {
        const sub = url.replace('/dashboard', '') || '/index.html';
        filePath = path.join(DASHBOARD_ROOT, sub);
        if (filePath.endsWith('\\') || filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
    } else {
        filePath = path.join(SITE_ROOT, url === '/' ? 'index.html' : url);
    }

    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js':   'text/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg':  'image/svg+xml',
        '.woff2':'font/woff2',
        '.woff': 'font/woff',
        '.ttf':  'font/ttf'
    };
    const ext         = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); }
            else                       { res.writeHead(500); res.end('Server error'); }
            return;
        }
        res.writeHead(200, {
            'Content-Type':  contentType,
            'Cache-Control': 'no-store'
        });
        res.end(content);
    });
});

server.listen(PORT, () => {
    try {
        regenerateStaticSite();
    } catch(e) {
        console.error('Error during initial static site regeneration:', e);
    }
    console.log('\n==========================================');
    console.log('  Clarified CMS running');
    console.log('==========================================');
    console.log(`  Site:      http://localhost:${PORT}`);
    console.log(`  Dashboard: http://localhost:${PORT}/dashboard/`);
    console.log('==========================================\n');
});

module.exports = { regenerateStaticSite, getDB, saveDB };
