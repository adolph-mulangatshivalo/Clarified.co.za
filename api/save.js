import { getFileContent, createBlob, createCommitAndPush } from './github-helper.js';
import { verifyAdminAuth } from './auth-verify.js';
import { submitToSearchEngines } from './search-indexing.js';

export default async function handler(req, res) {
    // Security: Restrict CORS
    const origin = req.headers.origin || '';
    if (origin.includes('clarified.co.za') || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('vercel.app')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://clarified.co.za');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Security: Verify Admin Authentication
    const authResult = await verifyAdminAuth(req);
    if (!authResult.authorized) {
        return res.status(authResult.status || 401).json({ error: authResult.error });
    }

    const {
        GITHUB_TOKEN,
        GITHUB_OWNER,
        GITHUB_REPO,
        GITHUB_BRANCH = 'main'
    } = process.env;

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        return res.status(500).json({
            error: 'Missing GitHub configuration. Please set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in your Vercel Project Environment Variables.'
        });
    }

    try {
        const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!data.title || !data.title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const slug = (data.slug || data.title)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

        // 1. Fetch current db.json from GitHub
        const dbFile = await getFileContent(GITHUB_OWNER, GITHUB_REPO, 'dashboard/db.json', GITHUB_BRANCH, GITHUB_TOKEN);
        if (!dbFile) {
            return res.status(500).json({ error: 'Could not find dashboard/db.json in the GitHub repository.' });
        }

        const db = JSON.parse(dbFile.content);
        if (!Array.isArray(db.articles)) db.articles = [];

        // 2. Handle base64 image upload if provided
        const filesToCommit = [];
        let featuredImageUrl = data.featuredImage || '';

        if (data.imageUploadBase64) {
            const matches = data.imageUploadBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                let ext = (matches[1].split('/')[1] || 'png').toLowerCase();
                if (ext === 'jpeg') ext = 'jpg';
                if (ext.includes('+')) ext = ext.split('+')[0];
                const filename = `upload_${Date.now()}.${ext}`;
                const blobSha = await createBlob(GITHUB_OWNER, GITHUB_REPO, matches[2], GITHUB_TOKEN);
                filesToCommit.push({
                    path: `images/${filename}`,
                    sha: blobSha
                });
                featuredImageUrl = `images/${filename}`;
            }
        }

        // 3. Update or create article record (Sanitize preview URLs to clean relative paths)
        const sanitizedContent = (data.content || '')
            .replace(/https?:\/\/clarified-co-za\.vercel\.app\/articles\//g, '/articles/')
            .replace(/https?:\/\/clarified\.co\.za\/articles\//g, '/articles/');

        let article = data.id ? db.articles.find(a => String(a.id) === String(data.id)) : null;
        if (article) {
            Object.assign(article, {
                title:         data.title,
                content:       sanitizedContent,
                excerpt:       data.excerpt  || '',
                category:      data.category || '',
                author:        data.author   || 'The Clarified Editorial Team',
                tags:          data.tags     || '',
                slug:          slug,
                status:        data.status   || 'draft',
                homepagePlacement: data.homepagePlacement || article.homepagePlacement || 'standard',
                seoTitle:      data.seoTitle || '',
                metaDesc:      data.metaDesc || '',
                focusKw:       data.focusKw  || '',
                secondaryKw:   data.secondaryKw || '',
                imgAlt:        data.imgAlt   || '',
                indexing:      data.indexing || 'index',
                followLinks:   data.followLinks || 'follow',
                articleType:   data.articleType || 'Article',
                canonical:     data.canonical || '',
                featuredImage: featuredImageUrl,
                date:          article.date || Date.now(),
                updatedAt:     Date.now()
            });

            if (['top_story', 'editors_pick', 'business', 'sport'].includes(article.homepagePlacement)) {
                db.articles.forEach(a => {
                    if (String(a.id) !== String(article.id) && a.homepagePlacement === article.homepagePlacement) {
                        a.homepagePlacement = 'standard';
                    }
                });
            }
        } else {
            article = {
                id:            Date.now().toString(),
                title:         data.title,
                content:       sanitizedContent,
                excerpt:       data.excerpt  || '',
                category:      data.category || '',
                author:        data.author   || 'The Clarified Editorial Team',
                tags:          data.tags     || '',
                slug:          slug,
                status:        data.status   || 'draft',
                homepagePlacement: data.homepagePlacement || 'standard',
                seoTitle:      data.seoTitle || '',
                metaDesc:      data.metaDesc || '',
                focusKw:       data.focusKw  || '',
                secondaryKw:   data.secondaryKw || '',
                imgAlt:        data.imgAlt   || '',
                indexing:      data.indexing || 'index',
                followLinks:   data.followLinks || 'follow',
                articleType:   data.articleType || 'Article',
                canonical:     data.canonical || '',
                featuredImage: featuredImageUrl,
                date:          Date.now(),
                updatedAt:     Date.now()
            };

            if (['top_story', 'editors_pick', 'business', 'sport'].includes(article.homepagePlacement)) {
                db.articles.forEach(a => {
                    if (a.homepagePlacement === article.homepagePlacement) {
                        a.homepagePlacement = 'standard';
                    }
                });
            }

            db.articles.push(article);
        }

        // Add updated db.json to commit
        filesToCommit.push({
            path: 'dashboard/db.json',
            content: JSON.stringify(db, null, 2)
        });

        // 4. Fetch templates to regenerate HTML files
        const aboutFile = await getFileContent(GITHUB_OWNER, GITHUB_REPO, 'about.html', GITHUB_BRANCH, GITHUB_TOKEN);
        const indexTplFile = await getFileContent(GITHUB_OWNER, GITHUB_REPO, 'dashboard/index-template.html', GITHUB_BRANCH, GITHUB_TOKEN);

        const published = db.articles
            .filter(a => a.status === 'published')
            .sort((a, b) => b.date - a.date);

        function resolveImgUrl(p) {
            if (!p) return '';
            if (p.startsWith('http://') || p.startsWith('https://')) return p;
            return '/' + p.replace(/^\//, '');
        }
        function resolveAbsoluteImgUrl(p) {
            if (!p) return '';
            if (p.startsWith('http://') || p.startsWith('https://')) return p;
            return 'https://clarified.co.za/' + p.replace(/^\//, '');
        }

        function articleUrl(a) {
            return '/articles/' + (a.slug || a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
        }

        function readingTime(content) {
            if (!content) return 4;
            const words = content.replace(/<[^>]+>/g, '').split(/\s+/).length;
            return Math.max(1, Math.round(words / 200));
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
                ? `<a href="${url}"><img src="${imgSrc}" alt="${a.imgAlt || a.title}" style="height:190px;border-radius:9px;object-fit:cover;width:100%;"></a>`
                : `<a href="${url}" style="display:block;height:190px;border-radius:9px;background:var(--soft);"></a>`;
            return `<article class="card">
                ${img}
                <div class="eyebrow" style="margin-top:10px;">${(a.category || '').split(',')[0].trim()}</div>
                <h3><a href="${url}">${a.title}</a></h3>
                <p>${formatExcerpt(a.excerpt, 100)}</p>
                <a class="read-meta" href="${url}">Read story →</a>
            </article>`;
        }

        // 5. Generate published article HTML
        if (aboutFile && article.status === 'published') {
            let template = aboutFile.content.replace(/<a href="\/about\.html" class="active">About<\/a>/g, '<a href="/about.html">About</a>');
            if (published.length) {
                const spans = published.slice(0, 8).map(a => `<span><a href="${articleUrl(a)}" style="color:inherit;text-decoration:none;">${a.title}</a></span>`).join('');
                template = template.replace(/<div class="brief-track"[^>]*>[\s\S]*?<\/div>/, `<div class="brief-track" id="brief-track">\n${spans}${spans}\n</div>`);
            }

            const seoTitle = article.seoTitle || article.title;
            const metaDesc = article.metaDesc || article.excerpt || '';
            const dateStr  = new Date(article.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const readTime = readingTime(article.content);
            const tags = article.tags ? article.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            const author = article.author || 'The Clarified Editorial Team';

            let contentHtml = (article.content || '').replace(/ style="[^"]*"/gi, '');
            const tocLinks = [];
            contentHtml = contentHtml.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, text) => {
                const innerText = text.replace(/<[^>]+>/g, '').trim();
                const hSlug = innerText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                tocLinks.push(`<li><a href="#${hSlug}">${innerText}</a></li>`);
                return `<h2 id="${hSlug}">${text}</h2>`;
            });
            const tocHtml = tocLinks.length > 0 ? `\n      <div class="what-to-expect-box">\n        <h3>WHAT TO EXPECT</h3>\n        <ul>\n          ${tocLinks.join('\n          ')}\n        </ul>\n      </div>` : '';

            const related = published.filter(p => p.id !== article.id).slice(0, 3);
            const relatedHtml = related.map(cardHTML).join('\n');

            const mainBlock = `<main>
  <article class="container article-page" id="article-view">
    <header class="article-header-text" style="text-align: center; margin-bottom: 20px;">
      <div class="article-kicker">${(article.category || 'Article').split(',')[0].trim()} &middot; ${dateStr} &middot; ${readTime} min read</div>
      <h1 style="margin: 10px 0;">${article.title}</h1>
      <p class="article-dek" style="margin: 0 auto; max-width: 800px;">${article.excerpt || ''}</p>
    </header>
    ${article.featuredImage ? `
    <div class="clarified-single-header">
      <img src="${resolveImgUrl(article.featuredImage)}" class="article-hero-image" alt="${article.imgAlt || article.title}">
    </div>` : ''}
    <div class="article-body">${tocHtml}
      ${contentHtml}
    </div>
    <div class="article-author">
      <div class="author-mark">${author.charAt(0) || 'C'}</div>
      <div>
        <strong>By ${author}</strong>
        <div>Published ${dateStr}</div>
      </div>
    </div>
    ${tags.length ? `
    <div class="article-tags">
      ${tags.map(t => `<span>${t}</span>`).join('')}
    </div>` : ''}
    <div class="article-share">
      <strong>Share this article</strong>
      <div class="share-buttons">
        <a class="share-btn share-whatsapp" href="https://api.whatsapp.com/send?text=${encodeURIComponent(article.title)}%20${encodeURIComponent('https://clarified.co.za/articles/' + article.slug + '.html')}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          <span>WhatsApp</span>
        </a>
        <a class="share-btn share-facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://clarified.co.za/articles/' + article.slug + '.html')}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M13.5 21v-7.5h2.5l.5-3h-3V8.5c0-.9.3-1.5 1.6-1.5H16.5V4.3c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10.5H7.5v3H10V21h3.5z"/></svg>
          <span>Facebook</span>
        </a>
        <a class="share-btn share-twitter" href="https://twitter.com/intent/tweet?url=${encodeURIComponent('https://clarified.co.za/articles/' + article.slug + '.html')}&text=${encodeURIComponent(article.title)}" target="_blank" rel="noopener noreferrer" aria-label="Share on Twitter">
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
            out = out.replace(/href="style\.css"/g, 'href="/style.css"');

            const absoluteUrl = 'https://clarified.co.za/articles/' + article.slug;
            const absoluteImg = resolveAbsoluteImgUrl(article.featuredImage);
            const indexingContent = `${article.indexing || 'index'}, ${article.followLinks || 'follow'}`;
            const canonicalUrl = article.canonical || absoluteUrl;

            const dateIso = new Date(article.date || Date.now()).toISOString();
            const dateModifiedIso = new Date(article.updatedAt || article.date || Date.now()).toISOString();

            const jsonLd = {
                "@context": "https://schema.org",
                "@type": article.articleType || "Article",
                "mainEntityOfPage": {
                    "@type": "WebPage",
                    "@id": absoluteUrl
                },
                "headline": article.title,
                "description": (article.metaDesc || article.excerpt || '').slice(0, 160),
                "image": absoluteImg ? [absoluteImg] : [],
                "datePublished": dateIso,
                "dateModified": dateModifiedIso,
                "author": {
                    "@type": "Person",
                    "name": author,
                    "url": "https://clarified.co.za/about.html"
                },
                "publisher": {
                    "@type": "Organization",
                    "name": "Clarified",
                    "url": "https://clarified.co.za",
                    "logo": {
                        "@type": "ImageObject",
                        "url": "https://clarified.co.za/images/whatsapp-image-2026-08-17-at-12.53.05.jpeg"
                    }
                }
            };

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
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
`;
            out = out.replace('</head>', seoMeta + '</head>');
            if (!out.includes('/js/article.js')) {
                out = out.replace('</body>', '<script src="/js/article.js" defer></script>\n</body>');
            }
            filesToCommit.push({
                path: `articles/${article.slug}.html`,
                content: out
            });
        }

        // 6. Regenerate index.html
        if (indexTplFile && published.length) {
            let idx = indexTplFile.content;
            const shown = new Set();
            const spans = published.slice(0, 8).map(a => `<span><a href="${articleUrl(a)}" style="color:inherit;text-decoration:none;">${a.title}</a></span>`).join('');
            idx = idx.replace(/<div class="brief-track"[^>]*>[\s\S]*?<\/div>/, `<div class="brief-track" id="brief-track">\n${spans}${spans}\n</div>`);

            // Two-phase homepage slot resolution
            const slots = {
                topStory: null,
                heroSide: [],
                latest: [],
                mustRead: [],
                editorsPick: null,
                business: null,
                sport: null
            };

            // Phase 1: Lock in explicit placements first
            const explicitHero = published.find(a => a.homepagePlacement === 'top_story');
            if (explicitHero) {
                slots.topStory = explicitHero;
                shown.add(explicitHero.id);
            }

            const explicitEp = published.find(a => !shown.has(a.id) && a.homepagePlacement === 'editors_pick');
            if (explicitEp) {
                slots.editorsPick = explicitEp;
                shown.add(explicitEp.id);
            }

            const explicitHeroSide = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'hero_side').slice(0, 2);
            explicitHeroSide.forEach(a => {
                slots.heroSide.push(a);
                shown.add(a.id);
            });

            const explicitMustRead = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'must_read').slice(0, 3);
            explicitMustRead.forEach(a => {
                slots.mustRead.push(a);
                shown.add(a.id);
            });

            const explicitLatest = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'latest').slice(0, 4);
            explicitLatest.forEach(a => {
                slots.latest.push(a);
                shown.add(a.id);
            });

            const explicitBusiness = published.find(a => !shown.has(a.id) && a.homepagePlacement === 'business');
            if (explicitBusiness) {
                slots.business = explicitBusiness;
                shown.add(explicitBusiness.id);
            }

            const explicitSport = published.find(a => !shown.has(a.id) && a.homepagePlacement === 'sport');
            if (explicitSport) {
                slots.sport = explicitSport;
                shown.add(explicitSport.id);
            }

            // Phase 2: Fallback filling for unassigned slots
            function getAvailable() {
                return published.filter(a => !shown.has(a.id));
            }

            if (!slots.topStory) {
                const heroFallback = getAvailable()[0] || published[0];
                if (heroFallback) {
                    slots.topStory = heroFallback;
                    shown.add(heroFallback.id);
                }
            }

            if (slots.heroSide.length < 2) {
                const needed = 2 - slots.heroSide.length;
                let sideFill = getAvailable().filter(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'homepage-space')).slice(0, needed);
                if (sideFill.length < needed) {
                    const extra = getAvailable().filter(a => !sideFill.some(s => s.id === a.id)).slice(0, needed - sideFill.length);
                    sideFill = sideFill.concat(extra);
                }
                sideFill.forEach(a => {
                    slots.heroSide.push(a);
                    shown.add(a.id);
                });
            }

            if (slots.latest.length < 4) {
                const needed = 4 - slots.latest.length;
                const fillLatest = getAvailable().slice(0, needed);
                fillLatest.forEach(a => {
                    slots.latest.push(a);
                    shown.add(a.id);
                });
            }

            if (slots.mustRead.length < 3) {
                const needed = 3 - slots.mustRead.length;
                let fill = getAvailable().filter(a => a.category && a.category.split(',').some(c => {
                    const s = c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    return s === 'lifestyle' || s === 'entertainment' || s === 'education' || s === 'genz-youth';
                })).slice(0, needed);
                if (fill.length < needed) {
                    const extra = getAvailable().filter(a => !fill.some(f => f.id === a.id)).slice(0, needed - fill.length);
                    fill = fill.concat(extra);
                }
                fill.forEach(a => {
                    slots.mustRead.push(a);
                    shown.add(a.id);
                });
            }

            if (!slots.editorsPick) {
                let ep = getAvailable().find(a => a.category && (a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'editors-pick') || (a.tags && a.tags.includes("Editor's Pick"))));
                if (!ep) ep = getAvailable()[0];
                if (ep) {
                    slots.editorsPick = ep;
                    shown.add(ep.id);
                }
            }

            if (!slots.business) {
                let bus = getAvailable().find(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business'));
                if (!bus) bus = published.find(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business'));
                if (bus) {
                    slots.business = bus;
                    shown.add(bus.id);
                }
            }

            if (!slots.sport) {
                let sp = getAvailable().find(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport'));
                if (!sp) sp = published.find(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport'));
                if (sp) {
                    slots.sport = sp;
                    shown.add(sp.id);
                }
            }

            // Render Hero section
            const hero = slots.topStory;
            const heroSideHtml = slots.heroSide.map(a => `<div class="list-card">
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

            // Render Latest section
            idx = idx.replace(/<div class="news-grid" id="latest-grid">[\s\S]*?<\/div>/, `<div class="news-grid" id="latest-grid">\n${slots.latest.map(cardHTML).join('\n')}\n</div>`);

            // Render Must Read / Featured section
            if (slots.mustRead.length) {
                const large = slots.mustRead[0];
                const compact = slots.mustRead.slice(1);
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

            // Render Editor's Pick
            if (slots.editorsPick) {
                const ep = slots.editorsPick;
                const epHtml = `<section class="container section" id="editors-pick-section">
                  <div class="section-head"><div><span class="eyebrow">EDITORIAL</span><h2>Editor's Pick</h2></div><a href="/category-south-africa.html">View all <span class="ui-arrow">→</span></a></div>
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

            // Render Business & Sport
            if (slots.business) {
                idx = idx.replace(/<div class="small-grid" id="business-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="business-grid">\n${cardHTML(slots.business)}\n</div>`);
            }
            if (slots.sport) {
                idx = idx.replace(/<div class="small-grid" id="sport-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="sport-grid">\n${cardHTML(slots.sport)}\n</div>`);
            }

            filesToCommit.push({
                path: 'index.html',
                content: idx
            });

            // 7. Regenerate sitemap.xml
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
                'category-south-africa',
                'category-africa-news',
                'category-business',
                'category-technology',
                'category-sport',
                'category-education',
                'category-genz-youth',
                'category-lifestyle',
                'category-automotive',
                'category-world'
            ];

            const sitemapEntries = [
                `  <url>\n    <loc>https://clarified.co.za/</loc>\n    <lastmod>${todayDate}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`
            ];

            categorySlugs.forEach(cat => {
                sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/${cat}</loc>\n    <lastmod>${todayDate}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`);
            });

            published.forEach(a => {
                const aSlug = a.slug || a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                const aDate = new Date(a.updatedAt || a.date || Date.now()).toISOString().split('T')[0];
                const priority = (a.homepagePlacement === 'top_story' || a.homepagePlacement === 'editors_pick') ? '0.9' : '0.8';
                const absoluteImg = resolveAbsoluteImgUrl(a.featuredImage);
                let imgXml = '';
                if (absoluteImg) {
                    imgXml = `\n    <image:image>\n      <image:loc>${escapeXml(absoluteImg)}</image:loc>\n      <image:title>${escapeXml(a.title)}</image:title>\n    </image:image>`;
                }
                sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/articles/${aSlug}</loc>\n    <lastmod>${aDate}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>${imgXml}\n  </url>`);
            });

            ['about', 'contact', 'privacy', 'terms', 'disclaimer'].forEach(page => {
                sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/${page}</loc>\n    <lastmod>${todayDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`);
            });

            const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${sitemapEntries.join('\n')}\n</urlset>`;

            filesToCommit.push({
                path: 'sitemap.xml',
                content: sitemapXml
            });
        }

        // 8. Commit changes to GitHub (triggers automated Vercel deployment)
        const commitMsg = article.status === 'published'
            ? `Publish: ${article.title}`
            : `Update draft: ${article.title}`;

        const commit = await createCommitAndPush(GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, commitMsg, filesToCommit, GITHUB_TOKEN);

        // 9. Automated Search Engine Instant Submission (Google Search Console & IndexNow)
        let searchIndexingReport = null;
        if (article.status === 'published') {
            try {
                searchIndexingReport = await submitToSearchEngines({ slug: article.slug });
            } catch (indexingErr) {
                console.warn('Background search engine submission note:', indexingErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            id: article.id,
            slug: article.slug,
            commitSha: commit.sha,
            searchIndexing: searchIndexingReport,
            message: 'Successfully committed to GitHub. Vercel will automatically deploy your updates and search engines have been notified!'
        });

    } catch (err) {
        console.error('Error in /api/save:', err);
        return res.status(500).json({ error: err.message });
    }
}
