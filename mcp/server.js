#!/usr/bin/env node
/**
 * Clarified.co.za Model Context Protocol (MCP) Server
 * Enables AI assistants (Antigravity, Claude, etc.) to publish, edit, SEO-optimize,
 * and manage articles directly from chat.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Determine root paths
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'Clarified Dashboard', 'db.json');
const ARTICLES_DIR = path.join(PROJECT_ROOT, 'articles');
const ABOUT_TEMPLATE = path.join(PROJECT_ROOT, 'about.html');

// ── Database Helpers ────────────────────────────────────────────────────────
function getDB() {
    if (!fs.existsSync(DB_PATH)) {
        const initial = { articles: [] };
        fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
        return initial;
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function readingTime(content) {
    if (!content) return 3;
    const words = content.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
}

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

function generateSlug(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

// ── Static Site Regeneration ─────────────────────────────────────────────────
function cardHTML(a) {
    const slug = a.slug || generateSlug(a.title);
    const url = `/articles/${slug}.html`;
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

function regenerateSite() {
    const db = getDB();
    const published = (db.articles || [])
        .filter(a => a.status === 'published')
        .sort((a, b) => (b.date || 0) - (a.date || 0));

    if (!fs.existsSync(ARTICLES_DIR)) {
        fs.mkdirSync(ARTICLES_DIR, { recursive: true });
    }

    if (!fs.existsSync(ABOUT_TEMPLATE)) return;
    let template = fs.readFileSync(ABOUT_TEMPLATE, 'utf8');
    template = template.replace(/<a href="\/about\.html" class="active">About<\/a>/g, '<a href="/about.html">About</a>');

    // Populate brief ticker
    if (published.length) {
        const spans = published.slice(0, 8).map(a => {
            const slug = a.slug || generateSlug(a.title);
            return `<span><a href="/articles/${slug}.html" style="color:inherit;text-decoration:none;">${a.title}</a></span>`;
        }).join('');
        template = template.replace(/<div class="brief-track"[^>]*>[\s\S]*?<\/div>/, `<div class="brief-track" id="brief-track">\n${spans}${spans}\n</div>`);
    }

    // Generate individual article pages
    published.forEach(a => {
        const slug = a.slug || generateSlug(a.title);
        const seoTitle = a.seoTitle || a.title;
        const metaDesc = (a.metaDesc || a.excerpt || '').replace(/"/g, '&quot;');
        const dateStr = new Date(a.date || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const readTime = readingTime(a.content);
        const tags = a.tags ? a.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const author = a.author || 'The Clarified Editorial Team';

        let contentHtml = (a.content || '').replace(/ style="[^"]*"/gi, '');

        const tocLinks = [];
        contentHtml = contentHtml.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, text) => {
            const innerText = text.replace(/<[^>]+>/g, '').trim();
            const hSlug = generateSlug(innerText);
            tocLinks.push(`<li><a href="#${hSlug}">${innerText}</a></li>`);
            return `<h2 id="${hSlug}">${text}</h2>`;
        });

        let tocHtml = '';
        if (tocLinks.length > 0) {
            tocHtml = `\n      <div class="what-to-expect-box">\n        <h3>WHAT TO EXPECT</h3>\n        <ul>\n          ${tocLinks.join('\n          ')}\n        </ul>\n      </div>`;
        }

        const related = published.filter(p => p.id !== a.id).slice(0, 3);
        const relatedHtml = related.map(cardHTML).join('\n');

        const mainBlock = `<main>
  <article class="container article-page" id="article-view">
    <header class="article-header-text" style="text-align: center; margin-bottom: 20px;">
      <div class="article-kicker">${(a.category || 'Article').split(',')[0].trim()} &middot; ${dateStr} &middot; ${readTime} min read</div>
      <h1 style="margin: 10px 0;">${a.title}</h1>
      <p class="article-dek" style="margin: 0 auto; max-width: 800px;">${a.excerpt || ''}</p>
    </header>
    ${a.featuredImage ? `
    <div class="clarified-single-header" style="margin: 30px 0;">
      <img src="${resolveImgUrl(a.featuredImage)}" style="width: 100%; max-width: 600px; height: auto; border-radius: 8px; margin: 0 auto; display: block;" alt="${a.imgAlt || a.title}">
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

        const isoDate = new Date(a.date || Date.now()).toISOString();
        const absoluteUrl = `https://clarified.co.za/articles/${slug}.html`;
        const absoluteImg = resolveAbsoluteImgUrl(a.featuredImage);

        const seoMeta = `
<meta name="description" content="${metaDesc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${absoluteUrl}">
<meta property="og:title" content="${seoTitle}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:url" content="${absoluteUrl}">
<meta property="og:type" content="article">
${absoluteImg ? `<meta property="og:image" content="${absoluteImg}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${seoTitle}">
<meta name="twitter:description" content="${metaDesc}">
${absoluteImg ? `<meta name="twitter:image" content="${absoluteImg}">` : ''}`;

        out = out.replace('</head>', `${seoMeta}\n</head>`);
        fs.writeFileSync(path.join(ARTICLES_DIR, `${slug}.html`), out, 'utf8');
    });

    // Generate sitemap.xml
    const sitemapUrls = [
        'https://clarified.co.za/',
        'https://clarified.co.za/about.html',
        'https://clarified.co.za/contact.html',
        'https://clarified.co.za/privacy.html'
    ];
    published.forEach(a => {
        const slug = a.slug || generateSlug(a.title);
        sitemapUrls.push(`https://clarified.co.za/articles/${slug}.html`);
    });

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url>\n    <loc>${u}</loc>\n    <changefreq>daily</changefreq>\n  </url>`).join('\n')}
</urlset>`;
    fs.writeFileSync(path.join(PROJECT_ROOT, 'sitemap.xml'), sitemapXml, 'utf8');
}

// ── Git & GitHub Synchronization ─────────────────────────────────────────────
function syncToGit(commitMessage) {
    try {
        execSync('git add .', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
        execSync('git push origin main', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        return { synced: true, message: 'Changes pushed to GitHub and deployed to Vercel.' };
    } catch (err) {
        return { synced: false, warning: `Local changes saved, but git sync skipped or failed: ${err.message}` };
    }
}

// ── Tool Handlers ────────────────────────────────────────────────────────────
function handlePublishArticle(params) {
    const {
        title,
        content,
        excerpt,
        category = 'South Africa',
        tags = '',
        author = 'Clarified Editorial',
        featuredImage = '',
        imgAlt = '',
        status = 'published',
        seoTitle = '',
        metaDesc = '',
        focusKw = '',
        slug: userSlug
    } = params;

    if (!title || !content) {
        throw new Error('Both "title" and "content" are required.');
    }

    const db = getDB();
    const finalSlug = userSlug ? generateSlug(userSlug) : generateSlug(title);
    const id = Date.now();
    const cleanExcerpt = excerpt || content.replace(/<[^>]+>/g, '').substring(0, 150) + '…';
    const finalSeoTitle = seoTitle || (title.length > 60 ? title.substring(0, 57) + '…' : title);
    const finalMetaDesc = metaDesc || (cleanExcerpt.length > 160 ? cleanExcerpt.substring(0, 157) + '…' : cleanExcerpt);

    const article = {
        id,
        title,
        content,
        excerpt: cleanExcerpt,
        author,
        category,
        tags,
        slug: finalSlug,
        seoTitle: finalSeoTitle,
        metaDesc: finalMetaDesc,
        focusKw,
        imgAlt: imgAlt || title,
        featuredImage,
        status,
        date: id
    };

    const existingIdx = db.articles.findIndex(a => a.slug === finalSlug);
    if (existingIdx >= 0) {
        db.articles[existingIdx] = { ...db.articles[existingIdx], ...article, id: db.articles[existingIdx].id };
    } else {
        db.articles.unshift(article);
    }

    saveDB(db);
    regenerateSite();

    const gitResult = syncToGit(`Publish article: ${title}`);

    return {
        success: true,
        id: article.id,
        title: article.title,
        slug: article.slug,
        status: article.status,
        url: `https://clarified.co.za/articles/${article.slug}.html`,
        localPath: `articles/${article.slug}.html`,
        seo: {
            titleLength: finalSeoTitle.length,
            metaDescLength: finalMetaDesc.length,
            focusKw: focusKw || 'None specified'
        },
        deployment: gitResult
    };
}

function handleEditArticle(params) {
    const { id, slug, ...updates } = params;
    if (!id && !slug) {
        throw new Error('Please specify an "id" or "slug" to locate the article to edit.');
    }

    const db = getDB();
    const idx = db.articles.findIndex(a => (id && String(a.id) === String(id)) || (slug && a.slug === slug));

    if (idx === -1) {
        throw new Error(`Article not found with ${id ? `id ${id}` : `slug "${slug}"`}.`);
    }

    const current = db.articles[idx];
    if (updates.title && !updates.slug && !current.slug) {
        updates.slug = generateSlug(updates.title);
    }

    db.articles[idx] = { ...current, ...updates };
    saveDB(db);
    regenerateSite();

    const gitResult = syncToGit(`Update article: ${db.articles[idx].title}`);

    return {
        success: true,
        article: db.articles[idx],
        url: `https://clarified.co.za/articles/${db.articles[idx].slug}.html`,
        deployment: gitResult
    };
}

function handleListArticles(params = {}) {
    const { status = 'all', limit = 20, category } = params;
    const db = getDB();
    let articles = db.articles || [];

    if (status !== 'all') {
        articles = articles.filter(a => a.status === status);
    }
    if (category) {
        const catNorm = category.toLowerCase();
        articles = articles.filter(a => (a.category || '').toLowerCase().includes(catNorm));
    }

    return articles.slice(0, limit).map(a => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        status: a.status,
        category: a.category,
        date: new Date(a.date).toLocaleDateString(),
        url: `https://clarified.co.za/articles/${a.slug}.html`
    }));
}

function handleGetArticle(params) {
    const { id, slug } = params;
    const db = getDB();
    const article = db.articles.find(a => (id && String(a.id) === String(id)) || (slug && a.slug === slug));
    if (!article) {
        throw new Error(`Article not found matching ID "${id}" or slug "${slug}".`);
    }
    return article;
}

function handleDeleteArticle(params) {
    const { id } = params;
    if (!id) throw new Error('Article ID is required to delete.');

    const db = getDB();
    const idx = db.articles.findIndex(a => String(a.id) === String(id));
    if (idx === -1) throw new Error(`Article with ID ${id} not found.`);

    const removed = db.articles.splice(idx, 1)[0];
    saveDB(db);

    const articleHtmlPath = path.join(ARTICLES_DIR, `${removed.slug}.html`);
    if (fs.existsSync(articleHtmlPath)) {
        fs.unlinkSync(articleHtmlPath);
    }

    regenerateSite();
    const gitResult = syncToGit(`Delete article: ${removed.title}`);

    return {
        success: true,
        deleted: removed.title,
        deployment: gitResult
    };
}

function handleCheckSEO(params) {
    const { title = '', content = '', focusKw = '', seoTitle = '', metaDesc = '' } = params;
    const textOnly = content.replace(/<[^>]+>/g, ' ').toLowerCase();
    const kw = (focusKw || '').toLowerCase().trim();

    const checks = [
        { name: 'Title presence', pass: title.length > 5, message: title.length > 5 ? 'Title is descriptive.' : 'Title is too short.' },
        { name: 'SEO Title length (<60 chars)', pass: (seoTitle || title).length <= 60, message: `Length: ${(seoTitle || title).length}/60 chars.` },
        { name: 'Meta Description length (<160 chars)', pass: metaDesc.length > 0 && metaDesc.length <= 160, message: `Length: ${metaDesc.length}/160 chars.` },
        { name: 'Content depth (>300 words)', pass: textOnly.split(/\s+/).length >= 300, message: `Word count: ${textOnly.split(/\s+/).length} words.` },
        { name: 'Subheadings (H2/H3)', pass: /<h2|<h3/i.test(content), message: /<h2|<h3/i.test(content) ? 'Subheadings found.' : 'Add <h2> subheadings to structure your article.' }
    ];

    if (kw) {
        const kwInTitle = (seoTitle || title).toLowerCase().includes(kw);
        const kwInMeta = metaDesc.toLowerCase().includes(kw);
        const kwCount = (textOnly.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        checks.push({ name: 'Focus keyword in title', pass: kwInTitle, message: kwInTitle ? 'Keyword present in title.' : 'Include keyword in the title.' });
        checks.push({ name: 'Focus keyword in meta description', pass: kwInMeta, message: kwInMeta ? 'Keyword present in meta description.' : 'Include keyword in meta description.' });
        checks.push({ name: 'Keyword density', pass: kwCount >= 2, message: `Keyword appears ${kwCount} time(s) in content.` });
    }

    const passed = checks.filter(c => c.pass).length;
    const score = Math.round((passed / checks.length) * 100);

    return {
        seoScore: `${score}/100`,
        passed: `${passed} of ${checks.length} criteria met`,
        details: checks
    };
}

// ── MCP Server Protocol (JSON-RPC stdio) ─────────────────────────────────────
const TOOLS = [
    {
        name: 'publish_article',
        description: 'Publish a new article or save a draft on Clarified.co.za. Automatically calculates SEO, generates static HTML page, updates categories, and syncs to GitHub & Vercel.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'The title of the article' },
                content: { type: 'string', description: 'HTML body content with <h2> headings, <p> paragraphs, lists, etc.' },
                excerpt: { type: 'string', description: 'Short summary (1-2 sentences)' },
                category: { type: 'string', description: 'Category: South Africa, World, Technology, Business, Sport, Education, GenZ & Youth, Africa News, Lifestyle, Automotive' },
                tags: { type: 'string', description: 'Comma-separated tags (e.g. "Careers, Universities, 2026")' },
                author: { type: 'string', description: 'Author name (defaults to Clarified Editorial)' },
                featuredImage: { type: 'string', description: 'Image URL (e.g. from Cloudinary)' },
                imgAlt: { type: 'string', description: 'Alt text for the featured image' },
                status: { type: 'string', enum: ['published', 'draft'], default: 'published' },
                seoTitle: { type: 'string', description: 'SEO title under 60 characters' },
                metaDesc: { type: 'string', description: 'Meta description under 160 characters' },
                focusKw: { type: 'string', description: 'Target focus keyword phrase' },
                slug: { type: 'string', description: 'URL slug (auto-generated if omitted)' }
            },
            required: ['title', 'content']
        }
    },
    {
        name: 'edit_article',
        description: 'Edit or update an existing article on Clarified.co.za by ID or slug. Rebuilds HTML and pushes to GitHub.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'number', description: 'Article ID' },
                slug: { type: 'string', description: 'Article slug' },
                title: { type: 'string' },
                content: { type: 'string' },
                excerpt: { type: 'string' },
                category: { type: 'string' },
                tags: { type: 'string' },
                status: { type: 'string', enum: ['published', 'draft'] },
                featuredImage: { type: 'string' },
                seoTitle: { type: 'string' },
                metaDesc: { type: 'string' },
                focusKw: { type: 'string' }
            }
        }
    },
    {
        name: 'list_articles',
        description: 'List recent articles on Clarified.co.za with status, categories, and live links.',
        inputSchema: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['all', 'published', 'draft'], default: 'all' },
                limit: { type: 'number', default: 20 },
                category: { type: 'string' }
            }
        }
    },
    {
        name: 'get_article',
        description: 'Get the full details and HTML content of a specific Clarified article.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'number' },
                slug: { type: 'string' }
            }
        }
    },
    {
        name: 'delete_article',
        description: 'Permanently remove an article from Clarified.co.za and GitHub.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'number', description: 'ID of the article to delete' }
            },
            required: ['id']
        }
    },
    {
        name: 'check_seo',
        description: 'Analyze an article draft against Clarified SEO guidelines (character limits, keyword density, headings).',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                content: { type: 'string' },
                focusKw: { type: 'string' },
                seoTitle: { type: 'string' },
                metaDesc: { type: 'string' }
            },
            required: ['title', 'content']
        }
    }
];

function sendResponse(id, result) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(msg, 'utf8')}\r\n\r\n${msg}`);
}

function sendError(id, code, message) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(msg, 'utf8')}\r\n\r\n${msg}`);
}

// Stdio Message Parser
let buffer = Buffer.alloc(0);

process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const headerStr = buffer.slice(0, headerEnd).toString('utf8');
        const match = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
            buffer = buffer.slice(headerEnd + 4);
            continue;
        }

        const contentLength = parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;

        if (buffer.length < bodyEnd) break; // Incomplete message

        const bodyStr = buffer.slice(bodyStart, bodyEnd).toString('utf8');
        buffer = buffer.slice(bodyEnd);

        try {
            const req = JSON.parse(bodyStr);
            handleRpc(req);
        } catch (e) {
            console.error('Failed to parse RPC request:', e);
        }
    }
});

function handleRpc(req) {
    const { id, method, params } = req;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'clarified-mcp', version: '1.0.0' }
        });
        return;
    }

    if (method === 'notifications/initialized') {
        // Notification - no response needed
        return;
    }

    if (method === 'ping') {
        sendResponse(id, {});
        return;
    }

    if (method === 'tools/list') {
        sendResponse(id, { tools: TOOLS });
        return;
    }

    if (method === 'tools/call') {
        const { name, arguments: args = {} } = params || {};
        try {
            let resultData;
            switch (name) {
                case 'publish_article':
                    resultData = handlePublishArticle(args);
                    break;
                case 'edit_article':
                    resultData = handleEditArticle(args);
                    break;
                case 'list_articles':
                    resultData = handleListArticles(args);
                    break;
                case 'get_article':
                    resultData = handleGetArticle(args);
                    break;
                case 'delete_article':
                    resultData = handleDeleteArticle(args);
                    break;
                case 'check_seo':
                    resultData = handleCheckSEO(args);
                    break;
                default:
                    sendError(id, -32601, `Tool not found: ${name}`);
                    return;
            }

            sendResponse(id, {
                content: [{ type: 'text', text: JSON.stringify(resultData, null, 2) }]
            });
        } catch (err) {
            sendResponse(id, {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true
            });
        }
        return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
}
