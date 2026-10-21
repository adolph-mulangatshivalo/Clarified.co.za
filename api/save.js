import { getFileContent, createBlob, createCommitAndPush } from './github-helper.js';
import { verifyAdminAuth } from './auth-verify.js';

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

        // 3. Update or create article record
        let article = data.id ? db.articles.find(a => String(a.id) === String(data.id)) : null;
        if (article) {
            Object.assign(article, {
                title:         data.title,
                content:       data.content  || '',
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
                articleType:   data.articleType || 'NewsArticle',
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
                content:       data.content  || '',
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
                articleType:   data.articleType || 'NewsArticle',
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
            return '/articles/' + (a.slug || a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) + '.html';
        }

        function readingTime(content) {
            if (!content) return 4;
            const words = content.replace(/<[^>]+>/g, '').split(/\s+/).length;
            return Math.max(1, Math.round(words / 200));
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
                <p>${(a.excerpt || '').substring(0, 100)}${(a.excerpt || '').length > 100 ? '…' : ''}</p>
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
    <div class="clarified-single-header" style="margin: 30px 0;">
      <img src="${resolveImgUrl(article.featuredImage)}" style="width: 100%; max-width: 600px; height: auto; border-radius: 8px; margin: 0 auto; display: block;" alt="${article.imgAlt || article.title}">
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
      <button id="copy-link" type="button" onclick="navigator.clipboard.writeText(window.location.href)">Copy link</button>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://clarified.co.za/articles/' + article.slug + '.html')}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" style="margin-left: 10px; color: inherit; display: inline-block; vertical-align: middle;"><svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;"><path d="M13.5 21v-7.5h2.5l.5-3h-3V8.5c0-.9.3-1.5 1.6-1.5H16.5V4.3c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10.5H7.5v3H10V21h3.5z"/></svg></a>
      <a href="https://x.com/intent/tweet?url=${encodeURIComponent('https://clarified.co.za/articles/' + article.slug + '.html')}&text=${encodeURIComponent(article.title)}" target="_blank" rel="noopener noreferrer" aria-label="Share on X" style="margin-left: 10px; color: inherit; display: inline-block; vertical-align: middle;"><svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://clarified.co.za/articles/' + article.slug + '.html')}" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn" style="margin-left: 10px; color: inherit; display: inline-block; vertical-align: middle;"><svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;"><rect x="3" y="9" width="4" height="12"/><circle cx="5" cy="4" r="2.4"/><path d="M10 9h3.8v1.9h.05c.53-1 1.83-2.1 3.77-2.1 4.03 0 4.78 2.5 4.78 5.8V21h-4v-5.7c0-1.36-.02-3.1-1.9-3.1-1.9 0-2.2 1.48-2.2 3v5.8H10V9z"/></svg></a>
      <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(article.title)}%20${encodeURIComponent('https://clarified.co.za/articles/' + article.slug + '.html')}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" style="margin-left: 10px; color: inherit; display: inline-block; vertical-align: middle;"><svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></a>
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

            const absoluteUrl = 'https://clarified.co.za/articles/' + article.slug + '.html';
            const absoluteImg = resolveAbsoluteImgUrl(article.featuredImage);
            const indexingContent = `${article.indexing || 'index'}, ${article.followLinks || 'follow'}`;
            const canonicalUrl = article.canonical || absoluteUrl;

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
            out = out.replace('</head>', seoMeta + '</head>');
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

            // Top story
            let hero = published.find(a => a.homepagePlacement === 'top_story') || published[0];
            shown.add(hero.id);

            // Hero side
            let sideArticles = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'hero_side').slice(0, 2);
            if (sideArticles.length < 2) {
                const spaceCategory = published.filter(a => !shown.has(a.id) && !sideArticles.some(s => s.id === a.id) && a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'homepage-space')).slice(0, 2 - sideArticles.length);
                sideArticles = sideArticles.concat(spaceCategory);
            }
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
                <p>${(a.excerpt || '').substring(0, 80)}…</p>
              </div>
            </div>`).join('');

            const heroHtml = `<article class="hero-story" id="hero-story">
              <img id="hero-img" src="${resolveImgUrl(hero.featuredImage)}" alt="${hero.title}">
              <div class="hero-content">
                <div class="meta" id="hero-meta"><span class="tag">TOP STORY</span> ${(hero.category || '').split(',')[0].trim()} &middot; ${readingTime(hero.content)} min read</div>
                <h2><a id="hero-link" href="${articleUrl(hero)}">${hero.title}</a></h2>
                <p id="hero-excerpt">${(hero.excerpt || '').substring(0, 160)}</p>
                <a class="read-link" id="hero-read" href="${articleUrl(hero)}">Read the story <span class="ui-arrow">→</span></a>
              </div>
            </article>
            <aside class="hero-side" id="hero-side">\n${heroSideHtml}\n</aside>`;
            idx = idx.replace(/<section class="container hero-grid"[^>]*>[\s\S]*?<\/section>/, `<section class="container hero-grid" id="hero-section">\n${heroHtml}\n</section>`);

            // Latest articles
            let latest = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'latest').slice(0, 4);
            if (latest.length < 4) {
                const fillLatest = published.filter(a => !shown.has(a.id) && !latest.some(l => l.id === a.id)).slice(0, 4 - latest.length);
                latest = latest.concat(fillLatest);
            }
            latest.forEach(a => shown.add(a.id));
            idx = idx.replace(/<div class="news-grid" id="latest-grid">[\s\S]*?<\/div>/, `<div class="news-grid" id="latest-grid">\n${latest.map(cardHTML).join('\n')}\n</div>`);

            // Must Read / Featured (3 articles)
            let featuredPosts = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'must_read').slice(0, 3);
            if (featuredPosts.length < 3) {
                const fill = published.filter(a => !shown.has(a.id) && !featuredPosts.some(f => f.id === a.id) && a.category && a.category.split(',').some(c => {
                    const s = c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    return s === 'lifestyle' || s === 'entertainment' || s === 'education' || s === 'genz-youth';
                })).slice(0, 3 - featuredPosts.length);
                featuredPosts = featuredPosts.concat(fill);
            }
            if (featuredPosts.length < 3) {
                const extra = published.filter(a => !shown.has(a.id) && !featuredPosts.some(f => f.id === a.id)).slice(0, 3 - featuredPosts.length);
                featuredPosts = featuredPosts.concat(extra);
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
                    <p>${(large.excerpt || '').substring(0, 130)}…</p>
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
            let ep = published.find(a => !shown.has(a.id) && a.homepagePlacement === 'editors_pick');
            if (!ep) ep = published.find(a => !shown.has(a.id) && a.category && (a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'editors-pick') || (a.tags && a.tags.includes("Editor's Pick"))));
            if (!ep) ep = published.find(a => !shown.has(a.id));
            if (ep) {
                shown.add(ep.id);
                const epHtml = `<section class="container section" id="editors-pick-section">
                  <div class="section-head"><div><span class="eyebrow">EDITORIAL</span><h2>Editor's Pick</h2></div><a href="/category-south-africa.html">View all <span class="ui-arrow">→</span></a></div>
                  <article class="editor-pick" id="editors-pick">
                    <img id="ep-img" src="${resolveImgUrl(ep.featuredImage)}" alt="${ep.title}">
                    <div class="editor-content">
                      <div class="meta" id="ep-meta">${(ep.category || '').split(',')[0].trim()} · ${readingTime(ep.content)} min read</div>
                      <h3><a id="ep-link" href="${articleUrl(ep)}">${ep.title}</a></h3>
                      <p id="ep-excerpt">${(ep.excerpt || '').substring(0, 150)}</p>
                      <a class="read-link" id="ep-read" href="${articleUrl(ep)}">Read story <span class="ui-arrow">→</span></a>
                    </div>
                  </article>
                </section>`;
                idx = idx.replace(/<section class="container section" id="editors-pick-section"[^>]*>[\s\S]*?<\/section>/, epHtml);
            }

            // Business & Sport
            let business = published.find(a => !shown.has(a.id) && (a.homepagePlacement === 'business' || (a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business'))));
            if (!business) business = published.find(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business'));

            let sport = published.find(a => !shown.has(a.id) && (a.homepagePlacement === 'sport' || (a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport'))));
            if (!sport) sport = published.find(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport'));

            if (business) {
                shown.add(business.id);
                idx = idx.replace(/<div class="small-grid" id="business-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="business-grid">\n${cardHTML(business)}\n</div>`);
            }
            if (sport) {
                shown.add(sport.id);
                idx = idx.replace(/<div class="small-grid" id="sport-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="sport-grid">\n${cardHTML(sport)}\n</div>`);
            }

            filesToCommit.push({
                path: 'index.html',
                content: idx
            });
        }

        // 7. Commit changes to GitHub (triggers automated Vercel deployment)
        const commitMsg = article.status === 'published'
            ? `Publish: ${article.title}`
            : `Update draft: ${article.title}`;

        const commit = await createCommitAndPush(GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, commitMsg, filesToCommit, GITHUB_TOKEN);

        return res.status(200).json({
            success: true,
            id: article.id,
            slug: article.slug,
            commitSha: commit.sha,
            message: 'Successfully committed to GitHub. Vercel will automatically deploy your updates in seconds!'
        });

    } catch (err) {
        console.error('Error in /api/save:', err);
        return res.status(500).json({ error: err.message });
    }
}
