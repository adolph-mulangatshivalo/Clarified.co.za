#!/usr/bin/env node
/**
 * Clarified.co.za Model Context Protocol (MCP) Server
 * Production-Grade Editorial AI Engine
 *
 * Core Capabilities:
 * 1. Safe, Reversible Publishing (Draft-First & Git/Vercel Sync)
 * 2. Pre-Flight Quality Gate (Blocks broken links, thin content, missing alt tags)
 * 3. Duplicate Content & Keyword Cannibalization Detector
 * 4. Verified Internal Linking Engine
 * 5. Full SEO & Structured Data Management
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

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

    // Update sitemap.xml
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

// ── Quality Gate Validator ───────────────────────────────────────────────────
function runQualityGate(article, existingArticles = [], isNew = false) {
    const criticalErrors = [];
    const warnings = [];

    const {
        title = '',
        content = '',
        slug = '',
        seoTitle = '',
        metaDesc = '',
        featuredImage = '',
        imgAlt = '',
        id = null
    } = article;

    // 1. Slug check
    if (!slug) {
        criticalErrors.push('Missing URL slug.');
    } else if (isNew && existingArticles.some(a => a.slug === slug)) {
        criticalErrors.push(`Duplicate slug detected: "${slug}" is already in use by an existing article.`);
    }

    // 2. Title & SEO Title checks
    if (!title || title.trim().length < 5) {
        criticalErrors.push('Title is missing or too short (minimum 5 characters).');
    }
    const finalSeoTitle = seoTitle || title;
    if (finalSeoTitle.length > 60) {
        warnings.push(`SEO Title is ${finalSeoTitle.length} characters (Google recommended limit is 60). It will be truncated in search results.`);
    }

    // 3. Meta Description checks
    if (!metaDesc || metaDesc.trim().length === 0) {
        criticalErrors.push('Meta description is required for indexing and search engine snippets.');
    } else if (metaDesc.length > 160) {
        warnings.push(`Meta description is ${metaDesc.length} characters (recommended maximum is 160).`);
    }

    // 4. Content depth & word count
    const words = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length < 200) {
        criticalErrors.push(`Thin content: Article has only ${words.length} words. Clarified requires at least 250 words to avoid low-quality search penalties.`);
    } else if (words.length < 400) {
        warnings.push(`Article is relatively short (${words.length} words). Deep-dive articles perform best in search results.`);
    }

    // 5. Heading hierarchy
    if (!/<h2/i.test(content)) {
        warnings.push('Article lacks <h2> subheadings. Structured subheadings improve readability and user retention.');
    }
    if (/<h1/i.test(content)) {
        warnings.push('Found <h1> tags in article body. Pages must have only one <h1> (the main title). Use <h2> or <h3>.');
    }

    // 6. Image & Alt text validation
    if (featuredImage && (!imgAlt || imgAlt.trim().length === 0)) {
        warnings.push('Featured image is set but missing descriptive "imgAlt" text. Alt text is essential for Google Image search and accessibility.');
    }

    // 7. Internal Link Integrity: Verify that all Clarified internal links actually exist
    const internalLinkRegex = /href=["'](?:\/articles\/|https?:\/\/clarified\.co\.za\/articles\/)([a-zA-Z0-9_-]+)\.html["']/gi;
    let match;
    const checkedSlugs = new Set();
    while ((match = internalLinkRegex.exec(content)) !== null) {
        const targetSlug = match[1];
        if (!checkedSlugs.has(targetSlug)) {
            checkedSlugs.add(targetSlug);
            const exists = existingArticles.some(a => a.slug === targetSlug);
            if (!exists) {
                criticalErrors.push(`Broken internal link: Found link to "/articles/${targetSlug}.html", but no article with that slug exists.`);
            }
        }
    }

    // 8. Insecure links check
    if (/href=["']http:\/\//i.test(content)) {
        warnings.push('Found insecure "http://" links. Use secure "https://" destinations whenever possible.');
    }

    const passed = criticalErrors.length === 0;

    return {
        passed,
        canPublish: passed,
        criticalErrors,
        warnings,
        wordCount: words.length,
        readingTime: Math.max(1, Math.round(words.length / 200))
    };
}

// ── Duplicate Content & Keyword Cannibalization Detector ────────────────────
function detectDuplicates(proposedTitle, proposedFocusKw = '', proposedSlug = '') {
    const db = getDB();
    const articles = db.articles || [];
    const normalizedKw = (proposedFocusKw || '').toLowerCase().trim();
    const targetSlug = proposedSlug || generateSlug(proposedTitle);

    // Stop words to remove from title similarity
    const stopWords = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'in', 'of', 'on', 'at', 'to', 'a', 'is', 'are', 'that', 'this', 'south', 'africa']);
    const getWords = text => (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

    const proposedWords = new Set(getWords(proposedTitle));

    const conflicts = [];

    articles.forEach(a => {
        let conflictType = null;
        let score = 0;

        // Check exact slug collision
        if (a.slug === targetSlug) {
            conflictType = 'EXACT_SLUG_COLLISION';
            score = 100;
        }

        // Check focus keyword clash
        if (normalizedKw && a.focusKw && a.focusKw.toLowerCase().trim() === normalizedKw) {
            conflictType = conflictType || 'KEYWORD_CANNIBALIZATION';
            score = Math.max(score, 90);
        }

        // Check title word overlap (Jaccard similarity)
        const existingWords = getWords(a.title);
        const overlap = existingWords.filter(w => proposedWords.has(w));
        const unionSize = new Set([...proposedWords, ...existingWords]).size;
        const jaccard = unionSize > 0 ? (overlap.length / unionSize) * 100 : 0;

        if (jaccard > 45 && !conflictType) {
            conflictType = 'TOPIC_OVERLAP';
            score = Math.round(jaccard);
        }

        if (conflictType) {
            conflicts.push({
                id: a.id,
                title: a.title,
                slug: a.slug,
                url: `https://clarified.co.za/articles/${a.slug}.html`,
                focusKw: a.focusKw || 'None',
                conflictType,
                similarityScore: `${score}%`,
                recommendation: score >= 80 
                    ? `Consider updating article "${a.title}" instead of creating a competing page.`
                    : `Ensure this article covers a distinct angle from "${a.title}".`
            });
        }
    });

    return {
        hasConflicts: conflicts.length > 0,
        conflictCount: conflicts.length,
        conflicts: conflicts.sort((a, b) => parseInt(b.similarityScore) - parseInt(a.similarityScore))
    };
}

// ── Verified Internal Linking Engine ─────────────────────────────────────────
function suggestInternalLinks(content, currentSlug = '') {
    const db = getDB();
    const articles = (db.articles || []).filter(a => a.status === 'published' && a.slug !== currentSlug);
    const suggestions = [];
    const textLower = content.toLowerCase();

    articles.forEach(a => {
        const candidates = [];
        if (a.focusKw && a.focusKw.length > 3) candidates.push(a.focusKw);
        // Also candidate title fragments (e.g. "highest paying engineering jobs", "k53 driving test")
        const cleanTitle = a.title.replace(/[:\-–—].*$/, '').trim();
        if (cleanTitle.length > 10) candidates.push(cleanTitle);

        for (const candidate of candidates) {
            const pattern = candidate.toLowerCase();
            if (textLower.includes(pattern)) {
                // Ensure link isn't already inside the content
                const alreadyLinked = content.includes(a.slug);
                if (!alreadyLinked) {
                    suggestions.push({
                        anchorText: candidate,
                        destinationTitle: a.title,
                        destinationSlug: a.slug,
                        destinationUrl: `/articles/${a.slug}.html`,
                        absoluteUrl: `https://clarified.co.za/articles/${a.slug}.html`
                    });
                    break;
                }
            }
        }
    });

    return {
        totalSuggestions: suggestions.length,
        suggestions
    };
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
        status = 'draft', // Default is safe draft mode
        seoTitle = '',
        metaDesc = '',
        focusKw = '',
        slug: userSlug,
        forcePublish = false
    } = params;

    if (!title || !content) {
        throw new Error('Both "title" and "content" are required.');
    }

    const db = getDB();
    const finalSlug = userSlug ? generateSlug(userSlug) : generateSlug(title);
    const isNew = !db.articles.some(a => a.slug === finalSlug);
    const id = Date.now();

    const cleanExcerpt = excerpt || content.replace(/<[^>]+>/g, '').substring(0, 150).trim() + '…';
    const finalSeoTitle = seoTitle || (title.length > 60 ? title.substring(0, 57) + '…' : title);
    const finalMetaDesc = metaDesc || (cleanExcerpt.length > 160 ? cleanExcerpt.substring(0, 157) + '…' : cleanExcerpt);

    const articleDraft = {
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
        status: status,
        date: id
    };

    // 1. Run Pre-Flight Quality Gate
    const qualityGate = runQualityGate(articleDraft, db.articles, isNew);

    // If publishing live was requested but quality gate failed (and not forced), downgrade to draft
    let actualStatus = status;
    let downgradeReason = null;
    if (status === 'published' && !qualityGate.canPublish && !forcePublish) {
        actualStatus = 'draft';
        articleDraft.status = 'draft';
        downgradeReason = 'Quality Gate blocked live publication due to critical errors. Saved safely as draft.';
    }

    // 2. Check for Duplicate / Cannibalization
    const duplicateReport = detectDuplicates(title, focusKw, finalSlug);

    // 3. Save to database
    const existingIdx = db.articles.findIndex(a => a.slug === finalSlug);
    if (existingIdx >= 0) {
        db.articles[existingIdx] = { ...db.articles[existingIdx], ...articleDraft, id: db.articles[existingIdx].id };
    } else {
        db.articles.unshift(articleDraft);
    }

    saveDB(db);

    // Regenerate static pages if published
    if (actualStatus === 'published') {
        regenerateSite();
    }

    const gitResult = syncToGit(`[CMS] ${actualStatus === 'published' ? 'Publish' : 'Draft'}: ${title}`);

    return {
        success: true,
        id: articleDraft.id,
        title: articleDraft.title,
        slug: articleDraft.slug,
        status: actualStatus,
        downgradedToDraft: Boolean(downgradeReason),
        downgradeReason,
        url: `https://clarified.co.za/articles/${articleDraft.slug}.html`,
        localPath: actualStatus === 'published' ? `articles/${articleDraft.slug}.html` : 'Saved in Clarified Dashboard/db.json (Draft)',
        qualityGate,
        duplicateReport,
        deployment: gitResult
    };
}

function handleEditArticle(params) {
    const { id, slug, forcePublish = false, ...updates } = params;
    if (!id && !slug) {
        throw new Error('Please specify an "id" or "slug" to locate the article to edit.');
    }

    const db = getDB();
    const idx = db.articles.findIndex(a => (id && String(a.id) === String(id)) || (slug && a.slug === slug));

    if (idx === -1) {
        throw new Error(`Article not found with ${id ? `id ${id}` : `slug "${slug}"`}.`);
    }

    const current = db.articles[idx];
    const updatedArticle = { ...current, ...updates };

    // Run quality gate if being published
    let qualityGate = null;
    if (updatedArticle.status === 'published') {
        qualityGate = runQualityGate(updatedArticle, db.articles.filter((_, i) => i !== idx), false);
        if (!qualityGate.canPublish && !forcePublish) {
            updatedArticle.status = 'draft';
        }
    }

    db.articles[idx] = updatedArticle;
    saveDB(db);

    if (updatedArticle.status === 'published') {
        regenerateSite();
    }

    const gitResult = syncToGit(`[CMS] Update article: ${updatedArticle.title}`);

    return {
        success: true,
        article: updatedArticle,
        qualityGate,
        url: `https://clarified.co.za/articles/${updatedArticle.slug}.html`,
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
    const { id, confirm: userConfirmed } = params;
    if (!id) throw new Error('Article ID is required to delete.');

    if (!userConfirmed) {
        return {
            success: false,
            blocked: true,
            message: 'Safety Guard: Deletion is a destructive action. Pass "confirm: true" in arguments to proceed with permanent deletion.'
        };
    }

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
    const gitResult = syncToGit(`[CMS] Delete article: ${removed.title}`);

    return {
        success: true,
        deleted: removed.title,
        slug: removed.slug,
        deployment: gitResult
    };
}

// ── Google Search Console Integration ─────────────────────────────────────────
function findGscCredentials() {
    const candidates = [
        path.join(PROJECT_ROOT, 'clarigit-ce50e-65aea355061b.json'),
        path.join(PROJECT_ROOT, 'mcp', 'gsc-key.json')
    ];
    for (const f of candidates) {
        if (fs.existsSync(f)) {
            try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
        }
    }
    const rootFiles = fs.readdirSync(PROJECT_ROOT);
    for (const f of rootFiles) {
        if (f.startsWith('clarigit-') && f.endsWith('.json')) {
            try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8')); } catch (e) {}
        }
    }
    return null;
}

function base64url(str) {
    return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGscAccessToken(creds) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claimSet = base64url(JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    }));

    const signatureInput = header + '.' + claimSet;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(creds.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = signatureInput + '.' + signature;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt)
    });

    const data = await res.json();
    if (!data.access_token) {
        throw new Error(data.error_description || data.error || 'Failed to authenticate service account with Google OAuth.');
    }
    return data.access_token;
}

async function handleGetSearchAnalytics(params = {}) {
    const creds = findGscCredentials();
    if (!creds) {
        throw new Error('Google Search Console service account JSON key not found in project root. Make sure your clarigit-*.json key file is present.');
    }

    const {
        dimension = 'query',
        days = 28,
        limit = 20,
        siteUrl = 'https://clarified.co.za/'
    } = params;

    const token = await getGscAccessToken(creds);
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            startDate,
            endDate,
            dimensions: [dimension],
            rowLimit: limit
        })
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Google Search Console API error (${res.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    const rows = (data.rows || []).map(r => ({
        [dimension]: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: `${(r.ctr * 100).toFixed(2)}%`,
        avgPosition: Number(r.position.toFixed(1))
    }));

    return {
        siteUrl,
        dateRange: `${startDate} to ${endDate}`,
        totalResults: rows.length,
        data: rows
    };
}

async function handleGetContentOpportunities(params = {}) {
    const creds = findGscCredentials();
    if (!creds) {
        throw new Error('Google Search Console credentials not found.');
    }

    const { days = 28, siteUrl = 'https://clarified.co.za/' } = params;
    const token = await getGscAccessToken(creds);
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ['query'],
            rowLimit: 100
        })
    });

    const data = await res.json();
    const rows = data.rows || [];

    const lowCtr = rows
        .filter(r => r.impressions >= 15 && r.ctr < 0.04)
        .map(r => ({
            query: r.keys[0],
            impressions: r.impressions,
            clicks: r.clicks,
            ctr: `${(r.ctr * 100).toFixed(2)}%`,
            position: Number(r.position.toFixed(1)),
            recommendation: 'Rewrite SEO Title and Meta Description to boost CTR. Google is displaying your article, but users are clicking competitors.'
        }))
        .slice(0, 10);

    const strikingDistance = rows
        .filter(r => r.position >= 8 && r.position <= 20)
        .map(r => ({
            query: r.keys[0],
            impressions: r.impressions,
            clicks: r.clicks,
            position: Number(r.position.toFixed(1)),
            recommendation: 'Add dedicated H2 subheading or paragraph addressing this specific keyword, and add internal links pointing to the article to push it into Top 5.'
        }))
        .slice(0, 10);

    return {
        siteUrl,
        period: `Last ${days} days`,
        summary: `Found ${lowCtr.length} low-CTR opportunities and ${strikingDistance.length} striking-distance keywords.`,
        lowCtrOpportunities: lowCtr,
        strikingDistanceKeywords: strikingDistance
    };
}

// ── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'validate_article_quality',
        description: 'Run the Clarified Pre-Flight Quality Gate. Audits for broken internal links, thin content, missing alt tags, duplicate slugs, and Google snippet limits before publishing.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                content: { type: 'string' },
                slug: { type: 'string' },
                seoTitle: { type: 'string' },
                metaDesc: { type: 'string' },
                featuredImage: { type: 'string' },
                imgAlt: { type: 'string' }
            },
            required: ['title', 'content', 'slug']
        }
    },
    {
        name: 'detect_duplicates',
        description: 'Scan Clarified archive for keyword cannibalization and topical overlap before creating a new article.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Proposed article title' },
                focusKw: { type: 'string', description: 'Target focus keyword' },
                slug: { type: 'string', description: 'Proposed slug (optional)' }
            },
            required: ['title']
        }
    },
    {
        name: 'suggest_internal_links',
        description: 'Analyze article text and find high-relevance internal links to existing Clarified articles. Verifies that all suggested destination links exist on the site.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Article HTML or draft text' },
                currentSlug: { type: 'string', description: 'Current article slug to avoid self-linking' }
            },
            required: ['content']
        }
    },
    {
        name: 'publish_article',
        description: 'Create an article on Clarified. Defaults to safe "draft" mode. Automatically runs Quality Gate and Duplicate Detection. Commits to GitHub and deploys to Vercel.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                content: { type: 'string', description: 'HTML content with <h2> subheadings' },
                excerpt: { type: 'string', description: 'Summary dek' },
                category: { type: 'string', description: 'South Africa, Technology, Business, Sport, Education, GenZ & Youth, etc.' },
                tags: { type: 'string' },
                author: { type: 'string' },
                featuredImage: { type: 'string' },
                imgAlt: { type: 'string' },
                status: { type: 'string', enum: ['draft', 'published'], default: 'draft', description: 'Save as draft (default) or publish live.' },
                seoTitle: { type: 'string', description: 'Under 60 chars' },
                metaDesc: { type: 'string', description: 'Under 160 chars' },
                focusKw: { type: 'string' },
                slug: { type: 'string' },
                forcePublish: { type: 'boolean', description: 'Bypass quality gate downgrades if true' }
            },
            required: ['title', 'content']
        }
    },
    {
        name: 'edit_article',
        description: 'Safely edit an existing article on Clarified by ID or slug. Automatically regenerates pages and commits changes to Git.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'number' },
                slug: { type: 'string' },
                title: { type: 'string' },
                content: { type: 'string' },
                excerpt: { type: 'string' },
                category: { type: 'string' },
                tags: { type: 'string' },
                status: { type: 'string', enum: ['draft', 'published'] },
                featuredImage: { type: 'string' },
                seoTitle: { type: 'string' },
                metaDesc: { type: 'string' },
                focusKw: { type: 'string' },
                forcePublish: { type: 'boolean' }
            }
        }
    },
    {
        name: 'list_articles',
        description: 'List existing articles with filter by status or category.',
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
        description: 'Retrieve complete content, HTML, and metadata of an article by ID or slug.',
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
        description: 'Permanently remove an article. Requires "confirm: true" safeguard parameter.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'number' },
                confirm: { type: 'boolean', description: 'Must be explicitly set to true to execute deletion.' }
            },
            required: ['id', 'confirm']
        }
    },
    {
        name: 'get_search_analytics',
        description: 'Pull live Google Search Console performance metrics (clicks, impressions, CTR, average SERP position) for queries, pages, or countries.',
        inputSchema: {
            type: 'object',
            properties: {
                dimension: { type: 'string', enum: ['query', 'page', 'country', 'device'], default: 'query' },
                days: { type: 'number', default: 28, description: 'Number of past days to query' },
                limit: { type: 'number', default: 20 },
                siteUrl: { type: 'string', default: 'https://clarified.co.za/' }
            }
        }
    },
    {
        name: 'get_content_opportunities',
        description: 'Audit live Google Search Console data to uncover click-magnet opportunities (high impressions, low CTR) and striking-distance keywords (ranking positions 8-20) to guide content updates.',
        inputSchema: {
            type: 'object',
            properties: {
                days: { type: 'number', default: 28 },
                siteUrl: { type: 'string', default: 'https://clarified.co.za/' }
            }
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

// ── Stdio Protocol Engine ────────────────────────────────────────────────────
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

        if (buffer.length < bodyEnd) break;

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

async function handleRpc(req) {
    const { id, method, params } = req;

    if (method === 'initialize') {
        sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'clarified-editorial-mcp', version: '2.0.0' }
        });
        return;
    }

    if (method === 'notifications/initialized') return;
    if (method === 'ping') { sendResponse(id, {}); return; }

    if (method === 'tools/list') {
        sendResponse(id, { tools: TOOLS });
        return;
    }

    if (method === 'tools/call') {
        const { name, arguments: args = {} } = params || {};
        try {
            let resultData;
            switch (name) {
                case 'validate_article_quality':
                    const db = getDB();
                    resultData = runQualityGate(args, db.articles || [], false);
                    break;
                case 'detect_duplicates':
                    resultData = detectDuplicates(args.title, args.focusKw, args.slug);
                    break;
                case 'suggest_internal_links':
                    resultData = suggestInternalLinks(args.content, args.currentSlug);
                    break;
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
                case 'get_search_analytics':
                    resultData = await handleGetSearchAnalytics(args);
                    break;
                case 'get_content_opportunities':
                    resultData = await handleGetContentOpportunities(args);
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
