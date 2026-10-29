#!/usr/bin/env node
/**
 * Clarified.co.za Model Context Protocol (MCP) Server
 * Antigravity AI Editorial Engine (Stdio + SSE Transports)
 *
 * Fully compliant with Model Context Protocol specification.
 * Dedicated integration for Antigravity (Antigravity 2.0 & Antigravity IDE).
 *
 * Core Capabilities:
 * 1. Safe, Reversible Publishing (Draft-First & Git/Vercel Sync)
 * 2. Pre-Flight Quality Gate (Blocks broken links, thin content, missing alt tags)
 * 3. Duplicate Content & Keyword Cannibalization Detector
 * 4. Verified Internal Linking Engine
 * 5. Full SEO & Structured Data Management
 * 6. Live Google Search Console Integration
 * 7. Universal Transports: Stdio (NDJSON & LSP framing) + HTTP Server-Sent Events (SSE)
 * 8. Zero-Zombie Process Lifecycle: Auto-cleans on parent exit, pipe close, or disconnect
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = fs.existsSync(path.join(PROJECT_ROOT, 'dashboard', 'db.json'))
    ? path.join(PROJECT_ROOT, 'dashboard', 'db.json')
    : path.join(PROJECT_ROOT, 'Clarified Dashboard', 'db.json');
const ARTICLES_DIR = path.join(PROJECT_ROOT, 'articles');
const ABOUT_TEMPLATE = path.join(PROJECT_ROOT, 'about.html');
const INDEX_TEMPLATE = fs.existsSync(path.join(PROJECT_ROOT, 'dashboard', 'index-template.html'))
    ? path.join(PROJECT_ROOT, 'dashboard', 'index-template.html')
    : (fs.existsSync(path.join(PROJECT_ROOT, 'Clarified Dashboard', 'index-template.html'))
        ? path.join(PROJECT_ROOT, 'Clarified Dashboard', 'index-template.html')
        : path.join(PROJECT_ROOT, 'index-template.html'));

// ── Status Files Management & Process Lifecycle ──────────────────────────────
const LIVE_STATUS_PATHS = [
    path.join(PROJECT_ROOT, 'dashboard', '.mcp-active.json'),
    path.join(PROJECT_ROOT, 'Clarified Dashboard', '.mcp-active.json')
];

let isClientConnected = false;
let currentClient = null;
let activeTransport = 'stdio';
let sessionStartedAt = null;
let lastHeartbeatTime = null;
let heartbeatInterval = null;
let parentWatchTimer = null;
let parentPid = process.ppid;
let rootPid = null;
let rootName = null;

function resolveProcessAncestors() {
    parentPid = process.ppid;
    if (process.platform !== 'win32') {
        return;
    }
    try {
        const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json -Compress"';
        const raw = require('child_process').execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
        const list = JSON.parse(raw);
        const map = new Map(list.map(p => [p.ProcessId, p]));
        const chain = [];
        let curr = map.get(process.pid);
        while (curr && curr.ParentProcessId) {
            const parent = map.get(curr.ParentProcessId);
            if (parent) {
                chain.push(parent);
                curr = parent;
            } else {
                break;
            }
        }
        if (chain.length > 0) {
            parentPid = chain[0].ProcessId;
            const knownApps = ['antigravity', 'gemini', 'code', 'electron'];
            for (const p of chain) {
                const nameLower = (p.Name || '').toLowerCase();
                for (const app of knownApps) {
                    if (nameLower.includes(app)) {
                        rootPid = p.ProcessId;
                        rootName = p.Name;
                        currentClient = 'Antigravity';
                        return;
                    }
                }
            }
            const outer = chain[chain.length - 1];
            if (outer && !outer.Name.toLowerCase().includes('explorer')) {
                rootPid = outer.ProcessId;
                rootName = outer.Name;
            }
        }
    } catch (e) {
        parentPid = process.ppid;
    }
}

function checkLifecycle() {
    // 1. Is immediate parent alive?
    if (parentPid && parentPid > 1) {
        try {
            process.kill(parentPid, 0);
        } catch (e) {
            cleanupLiveStatus();
            process.exit(0);
            return false;
        }
    }
    // 2. Is root IDE process alive?
    if (rootPid && rootPid !== parentPid) {
        try {
            process.kill(rootPid, 0);
        } catch (e) {
            cleanupLiveStatus();
            process.exit(0);
            return false;
        }
    }
    // 3. Stdio pipe destroyed check
    if (activeTransport === 'stdio' && process.stdin.destroyed) {
        cleanupLiveStatus();
        process.exit(0);
        return false;
    }
    return true;
}

function formatClientName(raw) {
    return 'Antigravity';
}

function touchLiveStatus(clientInfo = null, transport = 'stdio') {
    if (clientInfo) {
        const clientName = clientInfo.name || clientInfo.title || (typeof clientInfo === 'string' ? clientInfo : null);
        if (clientName) {
            currentClient = formatClientName(clientName);
        }
    }

    if (!isClientConnected && clientInfo) {
        isClientConnected = true;
        sessionStartedAt = Date.now();
    }

    if (transport) {
        activeTransport = transport;
    }

    if (!isClientConnected) {
        return; // Don't falsely report connected before a client initializes
    }

    lastHeartbeatTime = Date.now();
    const statusData = {
        connected: true,
        pid: process.pid,
        parentPid: parentPid || process.ppid,
        rootPid: rootPid || null,
        rootName: rootName || null,
        serverName: 'clarified',
        client: currentClient || 'AI Assistant (MCP)',
        transport: activeTransport,
        startedAt: sessionStartedAt || Date.now(),
        lastHeartbeat: lastHeartbeatTime,
        toolCount: TOOLS.length
    };

    for (const sp of LIVE_STATUS_PATHS) {
        try {
            const dir = path.dirname(sp);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(sp, JSON.stringify(statusData, null, 2), 'utf8');
        } catch (e) { }
    }
}

function cleanupLiveStatus() {
    isClientConnected = false;
    currentClient = null;
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (parentWatchTimer) {
        clearInterval(parentWatchTimer);
        parentWatchTimer = null;
    }
    for (const sp of LIVE_STATUS_PATHS) {
        try {
            if (fs.existsSync(sp)) {
                // Only unlink if it was written by this process PID
                try {
                    const data = JSON.parse(fs.readFileSync(sp, 'utf8'));
                    if (data && data.pid && data.pid !== process.pid) {
                        continue;
                    }
                } catch (e) { }
                fs.unlinkSync(sp);
            }
        } catch (e) { }
    }
}

// Hook process exit at top level so that any termination immediately unlinks .mcp-active.json
process.on('exit', cleanupLiveStatus);
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
    process.on(sig, () => {
        cleanupLiveStatus();
        process.exit(0);
    });
});

function startHeartbeatEngine() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (!isClientConnected) return;
        if (!checkLifecycle()) return;
        touchLiveStatus();
    }, 1500);
    if (heartbeatInterval.unref) heartbeatInterval.unref();
}

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
    let clean = p.startsWith('http://') || p.startsWith('https://') ? p : '/' + p.replace(/^\//, '');
    if (clean.endsWith('.png')) {
        const jpgCandidate = clean.replace(/\.png$/, '.jpg');
        const localJpg = path.join(PROJECT_ROOT, jpgCandidate.replace(/^\//, ''));
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

function generateSlug(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function normalizeTables(html) {
    if (!html || !html.includes('<table')) return html;

    // 1. Remove WordPress comment wrappers around tables if present
    let result = html
        .replace(/<!--\s*\/?wp:[^\->]*-->/gi, '')
        .replace(/<p>\s*<!--\s*\/?wp:[^\->]*-->\s*<\/p>/gi, '');

    // 2. Convert <div class="table-container"> and <figure class="wp-block-table"> to standard <div class="table-responsive">
    result = result
        .replace(/<div\s+class=["'][^"']*table-container[^"']*["'][^>]*>/gi, '<div class="table-responsive">')
        .replace(/<figure\s+class=["'][^"']*wp-block-table[^"']*["'][^>]*>/gi, '<div class="table-responsive">')
        .replace(/<\/figure>/gi, '</div>');

    // 3. Ensure any <table> not already inside <div class="table-responsive"> gets wrapped
    result = result.replace(/(<div class="table-responsive"[^>]*>[\s\S]*?<\/div>)|(<table[\s\S]*?<\/table>)/gi, (m, wrapped, unwrapped) => {
        if (wrapped) return wrapped;
        return `<div class="table-responsive">${unwrapped}</div>`;
    });

    // 4. Ensure all tables have class="clarified-table"
    result = result.replace(/<table(?!\s+class=)([^>]*)>/gi, '<table class="clarified-table"$1>');
    result = result.replace(/<table\s+class=["']([^"']*)["']([^>]*)>/gi, (m, cls, rest) => {
        if (!cls.includes('clarified-table')) {
            cls = (cls + ' clarified-table').trim();
        }
        return `<table class="${cls}"${rest}>`;
    });

    return result;
}

// ── Static Site Regeneration ─────────────────────────────────────────────────
function articleUrl(a) {
    const slug = a.slug || generateSlug(a.title);
    return `/articles/${slug}`;
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
    const slug = a.slug || generateSlug(a.title);
    const url = `/articles/${slug}.html`;
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

function resolveHomepageSlots(published) {
    const shown = new Set();
    const slots = {
        topStory: null,
        heroSide: [],
        latest: [],
        mustRead: [],
        editorsPick: null,
        business: [],
        sport: [],
        briefTicker: (published || []).slice(0, 8)
    };

    if (!published || !published.length) return slots;

    // Phase 1: Lock in explicit placements first so fallback fillers cannot steal them
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

    const explicitBusiness = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'business').slice(0, 2);
    explicitBusiness.forEach(a => {
        slots.business.push(a);
        shown.add(a.id);
    });

    const explicitSport = published.filter(a => !shown.has(a.id) && a.homepagePlacement === 'sport').slice(0, 2);
    explicitSport.forEach(a => {
        slots.sport.push(a);
        shown.add(a.id);
    });

    // Helper to find available unassigned articles
    function getAvailable() {
        return published.filter(a => !shown.has(a.id));
    }

    // Phase 2: Fallback filling for unassigned slots
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

    if (slots.business.length < 2) {
        const needed = 2 - slots.business.length;
        let bus = getAvailable().filter(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business')).slice(0, needed);
        if (bus.length < needed) {
            const allBus = published.filter(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'business') && !slots.business.some(b => b.id === a.id));
            bus = bus.concat(allBus.slice(0, needed - bus.length));
        }
        bus.forEach(a => {
            slots.business.push(a);
            shown.add(a.id);
        });
    }

    if (slots.sport.length < 2) {
        const needed = 2 - slots.sport.length;
        let sp = getAvailable().filter(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport')).slice(0, needed);
        if (sp.length < needed) {
            const allSport = published.filter(a => a.category && a.category.split(',').some(c => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === 'sport') && !slots.sport.some(s => s.id === a.id));
            sp = sp.concat(allSport.slice(0, needed - sp.length));
        }
        sp.forEach(a => {
            slots.sport.push(a);
            shown.add(a.id);
        });
    }

    return slots;
}

function shiftHomepageArticles(articles, currentArticleId, newPlacement) {
    if (!Array.isArray(articles)) return;

    if (newPlacement === 'top_story') {
        // 1. Find existing top_story (not the current article)
        const previousTopStory = articles.find(a => String(a.id) !== String(currentArticleId) && a.homepagePlacement === 'top_story');

        // 2. Find existing hero_side articles (sorted by date descending)
        const existingHeroSide = articles
            .filter(a => String(a.id) !== String(currentArticleId) && a.homepagePlacement === 'hero_side')
            .sort((a, b) => (b.date || 0) - (a.date || 0));

        // 3. Find existing latest articles (sorted by date descending)
        const existingLatest = articles
            .filter(a => String(a.id) !== String(currentArticleId) && a.homepagePlacement === 'latest')
            .sort((a, b) => (b.date || 0) - (a.date || 0));

        // 4. Shift previous top_story into hero_side (first slot)
        if (previousTopStory) {
            previousTopStory.homepagePlacement = 'hero_side';
            existingHeroSide.unshift(previousTopStory);
        }

        // 5. If more than 2 in hero_side, the excess shifts down to 'latest'
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

        // 6. If more than 4 in latest, excess shifts down to 'standard'
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

    // Populate brief ticker in about template
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
        contentHtml = normalizeTables(contentHtml);

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
    <header class="article-header-text" style="text-align: center; margin-bottom: 24px;">
      <div class="article-kicker">${(a.category || 'Article').split(',')[0].trim()} &middot; ${dateStr} &middot; ${readTime} min read</div>
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
        <a class="share-btn share-whatsapp" href="https://api.whatsapp.com/send?text=${encodeURIComponent(a.title)}%20${encodeURIComponent('https://clarified.co.za/articles/' + slug)}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          <span>WhatsApp</span>
        </a>
        <a class="share-btn share-facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://clarified.co.za/articles/' + slug)}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;"><path d="M13.5 21v-7.5h2.5l.5-3h-3V8.5c0-.9.3-1.5 1.6-1.5H16.5V4.3c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10.5H7.5v3H10V21h3.5z"/></svg>
          <span>Facebook</span>
        </a>
        <a class="share-btn share-twitter" href="https://twitter.com/intent/tweet?url=${encodeURIComponent('https://clarified.co.za/articles/' + slug)}&text=${encodeURIComponent(a.title)}" target="_blank" rel="noopener noreferrer" aria-label="Share on Twitter">
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

        const absoluteUrl = `https://clarified.co.za/articles/${slug}`;
        const absoluteImg = resolveAbsoluteImgUrl(a.featuredImage);
        const dateIso = new Date(a.date || Date.now()).toISOString();
        const dateModifiedIso = new Date(a.updatedAt || a.date || Date.now()).toISOString();

        const jsonLd = {
            "@context": "https://schema.org",
            "@type": a.articleType || "Article",
            "mainEntityOfPage": {
                "@type": "WebPage",
                "@id": absoluteUrl
            },
            "headline": a.title,
            "description": (a.metaDesc || a.excerpt || '').slice(0, 160),
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
${absoluteImg ? `<meta name="twitter:image" content="${absoluteImg}">` : ''}
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>`;

        out = out.replace('</head>', `${seoMeta}\n</head>`);
        fs.writeFileSync(path.join(ARTICLES_DIR, `${slug}.html`), out, 'utf8');
    });

    // ── Generate index.html statically (Homepage placement) ────────────────────
    if (fs.existsSync(INDEX_TEMPLATE)) {
        let idx = fs.readFileSync(INDEX_TEMPLATE, 'utf8');

        if (published.length) {
            const slots = resolveHomepageSlots(published);

            // 1. Brief ticker
            const spans = slots.briefTicker.map(a => `<span><a href="${articleUrl(a)}" style="color:inherit;text-decoration:none;">${a.title}</a></span>`).join('');
            idx = idx.replace(/<div class="brief-track"[^>]*>[\s\S]*?<\/div>/, `<div class="brief-track" id="brief-track">\n${spans}${spans}\n</div>`);

            // 2. Top Story & Hero Side
            const hero = slots.topStory || published[0];
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

            // 3. Latest Articles (4 articles)
            idx = idx.replace(/<div class="news-grid" id="latest-grid">[\s\S]*?<\/div>/, `<div class="news-grid" id="latest-grid">\n${slots.latest.map(cardHTML).join('\n')}\n</div>`);

            // 4. Must Read / Featured (3 articles: 1 large + 2 compact)
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

            // 5. Editor's Pick (Always rendered and visible)
            if (slots.editorsPick) {
                const ep = slots.editorsPick;
                const epHtml = `<section class="container section" id="editors-pick-section">
                  <div class="section-head"><div><span class="eyebrow">EDITORIAL</span><h2>Editor's Pick</h2></div><a href="/category-editors-pick">View all <span class="ui-arrow">→</span></a></div>
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

            // 6. Business & Sport (Fills 2 cards each to eliminate blank space in the 2-column grid)
            if (slots.business && slots.business.length) {
                idx = idx.replace(/<div class="small-grid" id="business-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="business-grid">\n${slots.business.map(cardHTML).join('\n')}\n</div>`);
            }
            if (slots.sport && slots.sport.length) {
                idx = idx.replace(/<div class="small-grid" id="sport-grid">[\s\S]*?<\/div>/, `<div class="small-grid" id="sport-grid">\n${slots.sport.map(cardHTML).join('\n')}\n</div>`);
            }
        }

        fs.writeFileSync(path.join(PROJECT_ROOT, 'index.html'), idx, 'utf8');
    }

    // Generate static category pages cleanly
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
    Object.keys(catMap).forEach(catSlug => {
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
        out = out.replace(/href="style\.css"/g, 'href="/style.css"');
        fs.writeFileSync(path.join(PROJECT_ROOT, `category-${catSlug}.html`), out, 'utf8');
    });

    // Update sitemap.xml with full Google-compliant attributes (lastmod, priority, changefreq, image tags)
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
        const slug = a.slug || generateSlug(a.title);
        const aDate = new Date(a.updatedAt || a.date || Date.now()).toISOString().split('T')[0];
        const priority = (a.homepagePlacement === 'top_story' || a.homepagePlacement === 'editors_pick') ? '0.9' : '0.8';
        const absoluteImg = resolveAbsoluteImgUrl(a.featuredImage);
        let imgXml = '';
        if (absoluteImg) {
            imgXml = `\n    <image:image>\n      <image:loc>${escapeXml(absoluteImg)}</image:loc>\n      <image:title>${escapeXml(a.title)}</image:title>\n    </image:image>`;
        }
        sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/articles/${slug}</loc>\n    <lastmod>${aDate}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>${imgXml}\n  </url>`);
    });

    ['about', 'contact', 'privacy', 'terms', 'disclaimer'].forEach(page => {
        sitemapEntries.push(`  <url>\n    <loc>https://clarified.co.za/${page}</loc>\n    <lastmod>${todayDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`);
    });

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${sitemapEntries.join('\n')}
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

    // 7. Internal Link Integrity & Spam Prevention
    if (/clarified-co-za\.vercel\.app/i.test(content)) {
        criticalErrors.push('Found preview link to "clarified-co-za.vercel.app". Always use clean links like "/articles/[slug].html" or "https://clarified.co.za/articles/[slug].html".');
    }
    if (/check out our guide/i.test(content)) {
        warnings.push('Found formulaic phrase "Check out our guide". Editorial rule mandates subtle, natural in-sentence anchor text.');
    }

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
    if (checkedSlugs.size > 2) {
        warnings.push(`Found ${checkedSlugs.size} internal links. Editorial rule strictly limits articles to maximum 2 subtle internal links.`);
    }

    // 8. Insecure links check
    if (/href=["']http:\/\//i.test(content)) {
        warnings.push('Found insecure "http://" links. Use secure "https://" destinations whenever possible.');
    }

    // 9. Excerpt & table suggestions
    if (article.excerpt && article.excerpt.length > 160) {
        warnings.push(`Excerpt is ${article.excerpt.length} characters (recommended 100-140 characters). It will be formatted cleanly on cards.`);
    }
    const comparativeKeywords = /salary|degrees|bursar|tuition|specs|requirements|fees/i;
    if (comparativeKeywords.test(title + ' ' + (article.focusKw || '')) && !/<table/i.test(content)) {
        warnings.push('This article discusses comparative data or requirements. Including a structured comparison table (<div class="table-responsive"><table class="clarified-table">) is recommended for clarity and SEO.');
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

    const stopWords = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'in', 'of', 'on', 'at', 'to', 'a', 'is', 'are', 'that', 'this', 'south', 'africa']);
    const getWords = text => (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

    const proposedWords = new Set(getWords(proposedTitle));
    const conflicts = [];

    articles.forEach(a => {
        let conflictType = null;
        let score = 0;

        if (a.slug === targetSlug) {
            conflictType = 'EXACT_SLUG_COLLISION';
            score = 100;
        }

        if (normalizedKw && a.focusKw && a.focusKw.toLowerCase().trim() === normalizedKw) {
            conflictType = conflictType || 'KEYWORD_CANNIBALIZATION';
            score = Math.max(score, 90);
        }

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
    const textLower = (content || '').toLowerCase();

    articles.forEach(a => {
        const candidates = [];
        if (a.focusKw && a.focusKw.length > 3) candidates.push(a.focusKw);
        const cleanTitle = a.title.replace(/[:\-–—].*$/, '').trim();
        if (cleanTitle.length > 10) candidates.push(cleanTitle);

        for (const candidate of candidates) {
            const pattern = candidate.toLowerCase();
            if (textLower.includes(pattern)) {
                const alreadyLinked = (content || '').includes(a.slug);
                if (!alreadyLinked) {
                    suggestions.push({
                        anchorText: candidate,
                        destinationTitle: a.title,
                        destinationSlug: a.slug,
                        destinationUrl: `/articles/${a.slug}.html`,
                        exampleUsage: `...such as <a href="/articles/${a.slug}.html">${candidate}</a> when preparing...`
                    });
                    break;
                }
            }
        }
    });

    const topSuggestions = suggestions.slice(0, 2);

    return {
        totalSuggestions: topSuggestions.length,
        suggestions: topSuggestions,
        guideline: 'Maximum 2 internal links per article. Weave anchor text naturally into normal sentences. NEVER use formulaic phrases like "Check out our guide on...".'
    };
}

// ── Tool Handlers ────────────────────────────────────────────────────────────
async function handlePublishArticle(params = {}) {
    const {
        title,
        content,
        excerpt,
        category = 'South Africa',
        tags = '',
        author = 'Clarified Editorial',
        featuredImage = '',
        imgAlt = '',
        status = 'draft',
        homepagePlacement = 'standard',
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

    const cleanContent = normalizeTables((content || '')
        .replace(/https?:\/\/clarified-co-za\.vercel\.app\/articles\//g, '/articles/')
        .replace(/https?:\/\/clarified\.co\.za\/articles\//g, '/articles/'));

    const cleanExcerpt = excerpt || cleanContent.replace(/<[^>]+>/g, '').substring(0, 150).trim() + '…';
    const finalSeoTitle = seoTitle || (title.length > 60 ? title.substring(0, 57) + '…' : title);
    const finalMetaDesc = metaDesc || (cleanExcerpt.length > 160 ? cleanExcerpt.substring(0, 157) + '…' : cleanExcerpt);

    let finalPlacement = homepagePlacement;
    if (status === 'published' && (!finalPlacement || finalPlacement === 'standard')) {
        finalPlacement = 'top_story';
    }
    if (!finalPlacement) {
        finalPlacement = 'top_story';
    }

    const articleDraft = {
        id,
        title,
        content: cleanContent,
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
        homepagePlacement: finalPlacement,
        date: id
    };

    // Automatic homepage cascading shift:
    // When an article is published as top_story, previous top story shifts to hero_side,
    // and older hero_side stories shift to latest.
    shiftHomepageArticles(db.articles, id, articleDraft.homepagePlacement);

    const qualityGate = runQualityGate(articleDraft, db.articles, isNew);

    let actualStatus = status;
    let downgradeReason = null;
    if (status === 'published' && !qualityGate.canPublish && !forcePublish) {
        actualStatus = 'draft';
        articleDraft.status = 'draft';
        downgradeReason = 'Quality Gate blocked live publication due to critical errors. Saved safely as draft.';
    }

    const duplicateReport = detectDuplicates(title, focusKw, finalSlug);

    const existingIdx = db.articles.findIndex(a => a.slug === finalSlug);
    if (existingIdx >= 0) {
        db.articles[existingIdx] = { ...db.articles[existingIdx], ...articleDraft, id: db.articles[existingIdx].id };
    } else {
        db.articles.unshift(articleDraft);
    }

    saveDB(db);

    let searchIndexing = null;
    if (actualStatus === 'published') {
        regenerateSite();
        try {
            searchIndexing = await submitToSearchEngines({ slug: articleDraft.slug });
        } catch (e) {
            console.error('Search engine submission notice:', e.message);
        }
    }

    const gitResult = syncToGit(`[CMS] ${actualStatus === 'published' ? 'Publish' : 'Draft'}: ${title}`);

    return {
        success: true,
        id: articleDraft.id,
        title: articleDraft.title,
        slug: articleDraft.slug,
        status: actualStatus,
        homepagePlacement: articleDraft.homepagePlacement,
        downgradedToDraft: Boolean(downgradeReason),
        downgradeReason,
        url: `https://clarified.co.za/articles/${articleDraft.slug}`,
        localPath: actualStatus === 'published' ? `articles/${articleDraft.slug}.html` : 'Saved in dashboard/db.json (Draft)',
        qualityGate,
        duplicateReport,
        deployment: gitResult,
        searchIndexing
    };
}

async function handleEditArticle(params = {}) {
    const { id, slug, forcePublish = false, ...updates } = params;
    if (!id && !slug) {
        throw new Error('Please specify an "id" or "slug" to locate the article to edit.');
    }

    const db = getDB();
    const idx = db.articles.findIndex(a => (id && String(a.id) === String(id)) || (slug && a.slug === slug));

    if (idx === -1) {
        throw new Error(`Article not found with ${id ? `id ${id}` : `slug "${slug}"`}.`);
    }

    if (updates.content) {
        updates.content = normalizeTables(updates.content
            .replace(/https?:\/\/clarified-co-za\.vercel\.app\/articles\//g, '/articles/')
            .replace(/https?:\/\/clarified\.co\.za\/articles\//g, '/articles/'));
    }

    const current = db.articles[idx];
    const updatedArticle = { ...current, ...updates };

    if (updates.homepagePlacement) {
        shiftHomepageArticles(db.articles, updatedArticle.id, updates.homepagePlacement);
    }

    let qualityGate = null;
    if (updatedArticle.status === 'published') {
        qualityGate = runQualityGate(updatedArticle, db.articles.filter((_, i) => i !== idx), false);
        if (!qualityGate.canPublish && !forcePublish) {
            updatedArticle.status = 'draft';
        }
    }

    db.articles[idx] = updatedArticle;
    saveDB(db);

    let searchIndexing = null;
    if (updatedArticle.status === 'published') {
        regenerateSite();
        try {
            searchIndexing = await submitToSearchEngines({ slug: updatedArticle.slug });
        } catch (e) {
            console.error('Search engine submission notice:', e.message);
        }
    }

    const gitResult = syncToGit(`[CMS] Update article: ${updatedArticle.title}`);

    return {
        success: true,
        article: updatedArticle,
        qualityGate,
        url: `https://clarified.co.za/articles/${updatedArticle.slug}`,
        deployment: gitResult,
        searchIndexing
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
        date: new Date(a.date || Date.now()).toLocaleDateString(),
        url: `https://clarified.co.za/articles/${a.slug}.html`
    }));
}

function handleGetArticle(params = {}) {
    const { id, slug } = params;
    const db = getDB();
    const article = db.articles.find(a => (id && String(a.id) === String(id)) || (slug && a.slug === slug));
    if (!article) {
        throw new Error(`Article not found matching ID "${id}" or slug "${slug}".`);
    }
    return article;
}

function handleDeleteArticle(params = {}) {
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
        try { fs.unlinkSync(articleHtmlPath); } catch (e) { }
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

function formatArticleSummary(a) {
    if (!a) return null;
    return {
        id: a.id,
        title: a.title,
        slug: a.slug,
        category: a.category,
        author: a.author,
        date: new Date(a.date || Date.now()).toLocaleDateString(),
        homepagePlacement: a.homepagePlacement || 'standard',
        url: `https://clarified.co.za/articles/${a.slug}.html`
    };
}

function handleGetHomepageLayout() {
    const db = getDB();
    const published = (db.articles || [])
        .filter(a => a.status === 'published')
        .sort((a, b) => (b.date || 0) - (a.date || 0));

    const slots = resolveHomepageSlots(published);

    return {
        topStory: formatArticleSummary(slots.topStory),
        heroSide: slots.heroSide.map(formatArticleSummary),
        latestArticles: slots.latest.map(formatArticleSummary),
        mustRead: slots.mustRead.map(formatArticleSummary),
        editorsPick: formatArticleSummary(slots.editorsPick),
        businessSpotlight: Array.isArray(slots.business) ? slots.business.map(formatArticleSummary) : formatArticleSummary(slots.business),
        sportSpotlight: Array.isArray(slots.sport) ? slots.sport.map(formatArticleSummary) : formatArticleSummary(slots.sport),
        briefTicker: (slots.briefTicker || []).map(formatArticleSummary),
        availablePublishedArticles: published.map(a => ({
            id: a.id,
            title: a.title,
            slug: a.slug,
            category: a.category,
            currentPlacement: a.homepagePlacement || 'standard'
        }))
    };
}

function handleCurateHomepage(params = {}) {
    const {
        topStory,
        heroSide,
        editorsPick,
        mustRead,
        latest,
        business,
        sport,
        resetOthers = false
    } = params;

    const db = getDB();
    const articles = db.articles || [];

    function findArticle(identifier) {
        if (!identifier) return null;
        return articles.find(a => String(a.id) === String(identifier) || a.slug === identifier);
    }

    if (resetOthers) {
        articles.forEach(a => {
            a.homepagePlacement = 'standard';
        });
    }

    const applied = {};

    if (topStory !== undefined) {
        const art = findArticle(topStory);
        if (art) {
            articles.filter(a => a.homepagePlacement === 'top_story').forEach(a => a.homepagePlacement = 'standard');
            art.homepagePlacement = 'top_story';
            applied.topStory = art.title;
        }
    }

    if (Array.isArray(heroSide)) {
        articles.filter(a => a.homepagePlacement === 'hero_side').forEach(a => a.homepagePlacement = 'standard');
        applied.heroSide = [];
        heroSide.slice(0, 2).forEach(idOrSlug => {
            const art = findArticle(idOrSlug);
            if (art) {
                art.homepagePlacement = 'hero_side';
                applied.heroSide.push(art.title);
            }
        });
    }

    if (editorsPick !== undefined) {
        const art = findArticle(editorsPick);
        if (art) {
            articles.filter(a => a.homepagePlacement === 'editors_pick').forEach(a => a.homepagePlacement = 'standard');
            art.homepagePlacement = 'editors_pick';
            applied.editorsPick = art.title;
        }
    }

    if (Array.isArray(mustRead)) {
        articles.filter(a => a.homepagePlacement === 'must_read').forEach(a => a.homepagePlacement = 'standard');
        applied.mustRead = [];
        mustRead.slice(0, 3).forEach(idOrSlug => {
            const art = findArticle(idOrSlug);
            if (art) {
                art.homepagePlacement = 'must_read';
                applied.mustRead.push(art.title);
            }
        });
    }

    if (Array.isArray(latest)) {
        articles.filter(a => a.homepagePlacement === 'latest').forEach(a => a.homepagePlacement = 'standard');
        applied.latest = [];
        latest.slice(0, 4).forEach(idOrSlug => {
            const art = findArticle(idOrSlug);
            if (art) {
                art.homepagePlacement = 'latest';
                applied.latest.push(art.title);
            }
        });
    }

    if (business !== undefined) {
        const art = findArticle(business);
        if (art) {
            articles.filter(a => a.homepagePlacement === 'business').forEach(a => a.homepagePlacement = 'standard');
            art.homepagePlacement = 'business';
            applied.business = art.title;
        }
    }

    if (sport !== undefined) {
        const art = findArticle(sport);
        if (art) {
            articles.filter(a => a.homepagePlacement === 'sport').forEach(a => a.homepagePlacement = 'standard');
            art.homepagePlacement = 'sport';
            applied.sport = art.title;
        }
    }

    saveDB(db);
    regenerateSite();
    const gitResult = syncToGit(`[CMS] Curate homepage layout: ${Object.keys(applied).join(', ')}`);

    return {
        success: true,
        applied,
        newLayout: handleGetHomepageLayout(),
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
            try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { }
        }
    }
    try {
        const rootFiles = fs.readdirSync(PROJECT_ROOT);
        for (const f of rootFiles) {
            if (f.startsWith('clarigit-') && f.endsWith('.json')) {
                try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8')); } catch (e) { }
            }
        }
    } catch (e) { }
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
        scope: 'https://www.googleapis.com/auth/webmasters',
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

// ── Automated Search Engine Submission (Google Search Console & IndexNow) ────
async function submitToSearchEngines(params = {}) {
    const { slug, url, siteUrl = 'https://clarified.co.za' } = params;
    const report = {
        timestamp: new Date().toISOString(),
        siteUrl,
        googleSearchConsole: null,
        indexNow: null,
        errors: []
    };

    // 1. Google Search Console Sitemap Submission
    try {
        const creds = findGscCredentials();
        if (creds) {
            const token = await getGscAccessToken(creds);
            const feedpath = `${siteUrl}/sitemap.xml`;
            const gscRes = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl + '/')}/sitemaps/${encodeURIComponent(feedpath)}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            report.googleSearchConsole = {
                status: gscRes.status,
                success: gscRes.ok || gscRes.status === 204,
                message: gscRes.status === 204 ? 'Sitemap successfully submitted to Google Search Console.' : `HTTP ${gscRes.status}`
            };
        } else {
            report.errors.push('Google Search Console credentials not found; skipped sitemap submission.');
        }
    } catch (err) {
        report.errors.push(`Google Search Console submission failed: ${err.message}`);
    }

    // 2. IndexNow Instant Submission (Bing, Yandex, Seznam, Naver)
    try {
        const key = '8bf7094258814ecb819f7cc91e5d36e2';
        const keyFilePath = path.join(PROJECT_ROOT, `${key}.txt`);
        if (!fs.existsSync(keyFilePath)) {
            fs.writeFileSync(keyFilePath, key, 'utf8');
        }

        const urlList = [
            `${siteUrl}/`,
            `${siteUrl}/sitemap.xml`
        ];
        if (slug) {
            urlList.push(`${siteUrl}/articles/${slug}`);
        }
        if (url && !urlList.includes(url)) {
            urlList.push(url);
        }

        const indexNowRes = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                host: 'clarified.co.za',
                key: key,
                keyLocation: `${siteUrl}/${key}.txt`,
                urlList
            })
        });

        report.indexNow = {
            status: indexNowRes.status,
            success: indexNowRes.status === 200 || indexNowRes.status === 202,
            urlsSubmitted: urlList
        };
    } catch (err) {
        report.errors.push(`IndexNow submission failed: ${err.message}`);
    }

    return report;
}

// ── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'validate_article_quality',
        description: 'Run the Clarified Pre-Flight Quality Gate. Audits for broken internal links, thin content, missing alt tags, duplicate slugs, and Google snippet limits before publishing.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Article title' },
                content: { type: 'string', description: 'Article HTML content with <h2> subheadings' },
                slug: { type: 'string', description: 'Proposed URL slug' },
                seoTitle: { type: 'string', description: 'SEO Meta Title (max 60 chars)' },
                metaDesc: { type: 'string', description: 'SEO Meta Description (max 160 chars)' },
                featuredImage: { type: 'string', description: 'Image URL or path' },
                imgAlt: { type: 'string', description: 'Descriptive alt text for image' }
            },
            required: ['title', 'content', 'slug']
        }
    },
    {
        name: 'detect_duplicates',
        description: 'Scan Clarified archive for keyword cannibalization, duplicate slugs, and topical overlap before creating a new article.',
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
                homepagePlacement: {
                    type: 'string',
                    enum: ['standard', 'top_story', 'editors_pick', 'must_read', 'hero_side', 'latest', 'business', 'sport'],
                    default: 'standard',
                    description: 'Where this article should be placed on the homepage: top_story (main hero), editors_pick (editorial banner), must_read (featured section), hero_side (side of hero), latest (latest articles grid), business (business spotlight), sport (sport spotlight), or standard (feed & category only).'
                },
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
                homepagePlacement: {
                    type: 'string',
                    enum: ['standard', 'top_story', 'editors_pick', 'must_read', 'hero_side', 'latest', 'business', 'sport'],
                    description: 'Update article placement on the homepage: top_story, editors_pick, must_read, hero_side, latest, business, sport, standard.'
                },
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
        name: 'get_homepage_layout',
        description: 'Inspect the current article layout on the Clarified homepage. Shows which articles are currently placed in Top Story (Hero), Hero Side, Latest Articles, Must Read, Editor\'s Pick, Business Spotlight, and Sport Spotlight.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'curate_homepage',
        description: 'Directly control and curate where articles are placed across the Clarified homepage. Assign articles to Top Story, Editor\'s Pick, Must Read, Hero Side, Latest Articles, Business, or Sport. Automatically rebuilds the live homepage and syncs to Git/Vercel.',
        inputSchema: {
            type: 'object',
            properties: {
                topStory: { type: 'string', description: 'Article ID or slug to place as Top Story (main hero).' },
                heroSide: { type: 'array', items: { type: 'string' }, description: 'Array of up to 2 article IDs or slugs for hero side stories.' },
                editorsPick: { type: 'string', description: 'Article ID or slug for the Editor\'s Pick banner.' },
                mustRead: { type: 'array', items: { type: 'string' }, description: 'Array of up to 3 article IDs or slugs for Must Read / Featured grid (1 large + 2 compact).' },
                latest: { type: 'array', items: { type: 'string' }, description: 'Array of up to 4 article IDs or slugs for the Latest Articles grid.' },
                business: { type: 'string', description: 'Article ID or slug for the Business spotlight.' },
                sport: { type: 'string', description: 'Article ID or slug for the Sport spotlight.' },
                resetOthers: { type: 'boolean', description: 'If true, clears homepage placements of articles not in this list to standard.' }
            }
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
    },
    {
        name: 'submit_to_search_engines',
        description: 'Automatically and immediately submit the sitemap and clean article URLs to Google Search Console and IndexNow (Bing, Yandex, Seznam).',
        inputSchema: {
            type: 'object',
            properties: {
                slug: { type: 'string', description: 'Article slug to index immediately (e.g. "start-business-r500-south-africa")' },
                url: { type: 'string', description: 'Specific absolute URL to submit' },
                siteUrl: { type: 'string', default: 'https://clarified.co.za' }
            }
        }
    }
];

// ── MCP Resources & Prompts Definitions ───────────────────────────────────────

const RESOURCES = [
    {
        uri: 'clarified://articles/all',
        name: 'All Clarified Articles',
        description: 'Catalog of all published and draft articles in Clarified.co.za database',
        mimeType: 'application/json'
    },
    {
        uri: 'clarified://guidelines',
        name: 'Clarified Editorial & SEO Standards',
        description: 'Official quality standards: word counts, heading hierarchy, snippet limits, tone of voice',
        mimeType: 'text/markdown'
    },
    {
        uri: 'clarified://categories',
        name: 'Content Categories & Taxonomy',
        description: 'List of accepted editorial categories on Clarified.co.za',
        mimeType: 'application/json'
    }
];

const PROMPTS = [
    {
        name: 'write_article',
        description: 'Generate a complete, publishing-ready article that strictly adheres to Clarified editorial quality standards.',
        arguments: [
            { name: 'topic', description: 'Topic or headline idea', required: true },
            { name: 'focusKeyword', description: 'Target SEO focus keyword', required: true },
            { name: 'category', description: 'Category (South Africa, Business, Tech, etc.)', required: false }
        ]
    },
    {
        name: 'seo_audit',
        description: 'Run comprehensive pre-flight SEO checks on draft content.',
        arguments: [
            { name: 'content', description: 'Draft text or HTML', required: true },
            { name: 'focusKeyword', description: 'Focus keyword', required: true }
        ]
    },
    {
        name: 'content_opportunities',
        description: 'Analyze live Search Console queries to find low CTR click-magnets and page 2 opportunities.',
        arguments: [
            { name: 'days', description: 'Number of days (default 28)', required: false }
        ]
    }
];

// ── Tool Execution Dispatcher ────────────────────────────────────────────────
async function executeTool(name, args = {}) {
    switch (name) {
        case 'validate_article_quality':
            const db = getDB();
            return runQualityGate(args, db.articles || [], false);
        case 'detect_duplicates':
            return detectDuplicates(args.title, args.focusKw, args.slug);
        case 'suggest_internal_links':
            return suggestInternalLinks(args.content, args.currentSlug);
        case 'publish_article':
            return await handlePublishArticle(args);
        case 'edit_article':
            return await handleEditArticle(args);
        case 'list_articles':
            return handleListArticles(args);
        case 'get_article':
            return handleGetArticle(args);
        case 'delete_article':
            return handleDeleteArticle(args);
        case 'get_homepage_layout':
            return handleGetHomepageLayout();
        case 'curate_homepage':
            return handleCurateHomepage(args);
        case 'get_search_analytics':
            return await handleGetSearchAnalytics(args);
        case 'get_content_opportunities':
            return await handleGetContentOpportunities(args);
        case 'submit_to_search_engines':
            return await submitToSearchEngines(args);
        default:
            throw new Error(`Tool not found: ${name}`);
    }
}

// ── Resource Reader ──────────────────────────────────────────────────────────
function readResource(uri) {
    if (uri === 'clarified://articles/all') {
        const db = getDB();
        return {
            contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(db.articles || [], null, 2)
            }]
        };
    }
    if (uri === 'clarified://categories') {
        return {
            contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify([
                    'South Africa',
                    'Africa',
                    'World',
                    'Business & Finance',
                    'Technology & AI',
                    'Sport',
                    'Education & Careers',
                    'GenZ & Youth',
                    'Lifestyle & Culture',
                    'Automotive'
                ], null, 2)
            }]
        };
    }
    if (uri === 'clarified://guidelines') {
        const guidelines = `# Clarified Editorial & SEO Quality Standards
1. **Word Count**: Minimum 250 words, ideal depth 600-1,200 words.
2. **Structure**: Exactly one <h1> (the article title). Body content must use <h2> subheadings and optional <h3>.
3. **Headlines**: Clear, factual, engaging without clickbait. Maximum 60 characters for SEO Title.
4. **Meta Description**: Mandatory, concise summary between 120 and 160 characters.
5. **Internal Links**: Must point to verified published articles on Clarified.co.za.
6. **Images**: Descriptive \`imgAlt\` text required for all featured images.
7. **Draft-First Safeguard**: Articles default to draft unless explicitly marked as published.`;
        return {
            contents: [{
                uri,
                mimeType: 'text/markdown',
                text: guidelines
            }]
        };
    }
    throw new Error(`Resource not found: ${uri}`);
}

// ── Universal JSON-RPC 2.0 Dispatcher ─────────────────────────────────────────
async function executeRpc(req, transportContext = {}) {
    if (!req || typeof req !== 'object') {
        return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }

    const { id, method, params } = req;
    const transport = transportContext.transport || 'stdio';

    // Heartbeat on any valid incoming request
    touchLiveStatus(params && params.clientInfo, transport);

    if (method === 'initialize') {
        startHeartbeatEngine();
        const clientProto = (params && params.protocolVersion) || '2024-11-05';
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: clientProto,
                capabilities: {
                    tools: { listChanged: false },
                    resources: { subscribe: false, listChanged: false },
                    prompts: { listChanged: false },
                    logging: {}
                },
                serverInfo: {
                    name: 'clarified-editorial-mcp',
                    version: '2.1.0'
                }
            }
        };
    }

    if (method === 'notifications/initialized') {
        return { notification: true };
    }

    if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
    }

    // Tools List
    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    // Tools Call
    if (method === 'tools/call') {
        const { name, arguments: args = {} } = params || {};
        try {
            const resultData = await executeTool(name, args);
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    content: [{
                        type: 'text',
                        text: typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2)
                    }]
                }
            };
        } catch (err) {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    content: [{ type: 'text', text: `Error: ${err.message}` }],
                    isError: true
                }
            };
        }
    }

    // Resources List & Read
    if (method === 'resources/list') {
        return { jsonrpc: '2.0', id, result: { resources: RESOURCES } };
    }

    if (method === 'resources/read') {
        const uri = params && params.uri;
        try {
            const result = readResource(uri);
            return { jsonrpc: '2.0', id, result };
        } catch (err) {
            return { jsonrpc: '2.0', id, error: { code: -32602, message: err.message } };
        }
    }

    // Prompts List & Get
    if (method === 'prompts/list') {
        return { jsonrpc: '2.0', id, result: { prompts: PROMPTS } };
    }

    if (method === 'prompts/get') {
        const name = params && params.name;
        const promptArgs = (params && params.arguments) || {};
        if (name === 'write_article') {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    description: 'Instructions for writing a Clarified article',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Write a clear, high-value, publishing-ready article for Clarified.co.za on: "${promptArgs.topic}".
Focus Keyword: "${promptArgs.focusKeyword}".
Category: "${promptArgs.category || 'South Africa'}".

Guidelines:
1. Tone: Simple, everyday English accessible to all ages. Clear and detailed, not big confusing words.
2. Structure: Short bite-sized paragraphs (2-3 sentences max). Use <h2> and <h3> subheadings, bullet points, or summary tables.
3. Internal Links: Maximum 2 internal links. Weave them subtly into the sentence flow (e.g. "...when practicing <a href="/articles/slug.html">exam techniques</a>..."). NEVER use formulaic phrases like "Check out our guide on...".
4. Outbound Links: 1-2 verified primary source links (gov.za, official portals).
5. Fast & Token-Efficient: Deliver complete, high-quality content without repetitive filler or preamble.
6. Run validate_article_quality and detect_duplicates before saving.`
                            }
                        }
                    ]
                }
            };
        }
        return {
            jsonrpc: '2.0',
            id,
            result: {
                messages: [{ role: 'user', content: { type: 'text', text: `Execute prompt: ${name}` } }]
            }
        };
    }

    if (id === undefined || id === null) {
        return { notification: true };
    }

    return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
    };
}

// ── Stdio Protocol Runner ────────────────────────────────────────────────────
function runStdioServer() {
    activeTransport = 'stdio';
    let inputBuffer = '';
    let useContentLengthFraming = false;

    // Safety: redirect console.log to stderr in stdio mode so stdout is purely JSON-RPC messages
    console.log = (...args) => console.error(...args);

    resolveProcessAncestors();

    function send(msgObj) {
        if (!msgObj || msgObj.notification) return;
        const msg = JSON.stringify(msgObj);
        if (useContentLengthFraming) {
            process.stdout.write(`Content-Length: ${Buffer.byteLength(msg, 'utf8')}\r\n\r\n${msg}`);
        } else {
            process.stdout.write(msg + '\n');
        }
    }

    // Zero-Zombie Parent & Root Monitoring:
    // If the parent process or grandparent IDE exits, exit cleanly immediately!
    parentWatchTimer = setInterval(() => {
        checkLifecycle();
    }, 1000);
    if (parentWatchTimer.unref) parentWatchTimer.unref();

    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', async chunk => {
        inputBuffer += chunk;

        while (inputBuffer.length > 0) {
            if (inputBuffer.startsWith('\r\n')) { inputBuffer = inputBuffer.slice(2); continue; }
            if (inputBuffer.startsWith('\n')) { inputBuffer = inputBuffer.slice(1); continue; }

            // Content-Length header framing
            if (/^\s*Content-Length:/i.test(inputBuffer)) {
                useContentLengthFraming = true;
                const headerEnd = inputBuffer.indexOf('\r\n\r\n');
                if (headerEnd === -1) break;

                const headerStr = inputBuffer.slice(0, headerEnd);
                const match = headerStr.match(/Content-Length:\s*(\d+)/i);
                if (!match) {
                    inputBuffer = inputBuffer.slice(headerEnd + 4);
                    continue;
                }

                const contentLength = parseInt(match[1], 10);
                const bodyStart = headerEnd + 4;
                const bodyEnd = bodyStart + contentLength;
                if (inputBuffer.length < bodyEnd) break;

                const bodyStr = inputBuffer.slice(bodyStart, bodyEnd);
                inputBuffer = inputBuffer.slice(bodyEnd);

                try {
                    const req = JSON.parse(bodyStr);
                    const res = await executeRpc(req, { transport: 'stdio' });
                    send(res);
                } catch (e) {
                    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
                }
            } else {
                // Newline-delimited JSON
                const newlineIndex = inputBuffer.indexOf('\n');
                if (newlineIndex === -1) break;

                const line = inputBuffer.slice(0, newlineIndex).trim();
                inputBuffer = inputBuffer.slice(newlineIndex + 1);

                if (!line) continue;

                try {
                    const req = JSON.parse(line);
                    const res = await executeRpc(req, { transport: 'stdio' });
                    send(res);
                } catch (e) {
                    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
                }
            }
        }
    });

    process.stdin.on('end', () => { cleanupLiveStatus(); process.exit(0); });
    process.stdin.on('close', () => { cleanupLiveStatus(); process.exit(0); });
    process.stdin.on('error', () => { cleanupLiveStatus(); process.exit(0); });
    process.stdout.on('error', err => {
        if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
            cleanupLiveStatus();
            process.exit(0);
        }
    });

    ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'].forEach(sig => {
        process.on(sig, () => {
            cleanupLiveStatus();
            if (sig !== 'exit') process.exit(0);
        });
    });
}

// ── SSE / HTTP Protocol Runner ───────────────────────────────────────────────
function runSseServer(port = 3333) {
    activeTransport = 'sse';
    const sseClients = new Map();

    const server = http.createServer(async (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const parsedUrl = new URL(req.url, `http://localhost:${port}`);
        const pathname = parsedUrl.pathname;

        // Health / Status
        if (pathname === '/health' || pathname === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'operational',
                server: 'clarified-editorial-mcp',
                version: '2.1.0',
                activeSseClients: sseClients.size,
                tools: TOOLS.length
            }, null, 2));
            return;
        }

        // Tools Catalog
        if (pathname === '/tools') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ tools: TOOLS }, null, 2));
            return;
        }

        // SSE Stream (GET /sse)
        if (pathname === '/sse') {
            const sessionId = crypto.randomBytes(16).toString('hex');
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive'
            });

            sseClients.set(sessionId, { res, connectedAt: Date.now() });
            touchLiveStatus({ name: 'Web AI (SSE)' }, 'sse');
            startHeartbeatEngine();

            // Send standard MCP endpoint event pointing to messages POST endpoint
            res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

            req.on('close', () => {
                sseClients.delete(sessionId);
                if (sseClients.size === 0) {
                    cleanupLiveStatus();
                }
            });
            return;
        }

        // MCP Messages (POST /messages)
        if (pathname === '/messages' && req.method === 'POST') {
            const sessionId = parsedUrl.searchParams.get('sessionId');
            const client = sseClients.get(sessionId);

            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const reqObj = JSON.parse(body);
                    const rpcRes = await executeRpc(reqObj, { transport: 'sse' });

                    if (client && !rpcRes.notification) {
                        client.res.write(`event: message\ndata: ${JSON.stringify(rpcRes)}\n\n`);
                    }

                    res.writeHead(202, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ accepted: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(port, () => {
        console.log(`Clarified MCP SSE Server listening on http://localhost:${port}/sse`);
    });

    ['SIGINT', 'SIGTERM'].forEach(sig => {
        process.on(sig, () => {
            cleanupLiveStatus();
            server.close(() => process.exit(0));
        });
    });
}

// ── CLI / Main Execution ─────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Clarified Model Context Protocol (MCP) Server v2.1.0
Editorial & SEO AI Engine for Clarified.co.za (Antigravity Integration)

Usage:
  node mcp/server.js               Start MCP server in Stdio mode (Default)
  node mcp/server.js --sse [port]  Start MCP server in SSE HTTP mode (Default port: 3333)

Supported AI Client:
  - Antigravity 2.0 / Antigravity IDE (settings.json / mcp_config.json)
`);
        process.exit(0);
    }

    if (args.includes('--sse') || args.includes('--http')) {
        const portIdx = args.findIndex(a => a === '--port') !== -1
            ? args.findIndex(a => a === '--port') + 1
            : args.findIndex(a => a === '--sse' || a === '--http') + 1;
        const port = (portIdx > 0 && args[portIdx] && !args[portIdx].startsWith('--'))
            ? parseInt(args[portIdx], 10)
            : (process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3333);
        runSseServer(port);
    } else {
        runStdioServer();
    }
}

// ── Exports for Dashboard Integration ────────────────────────────────────────
module.exports = {
    TOOLS,
    RESOURCES,
    PROMPTS,
    executeRpc,
    executeTool,
    runQualityGate,
    detectDuplicates,
    suggestInternalLinks,
    handlePublishArticle,
    handleEditArticle,
    handleListArticles,
    handleGetArticle,
    handleDeleteArticle,
    handleGetHomepageLayout,
    handleCurateHomepage,
    resolveHomepageSlots,
    handleGetSearchAnalytics,
    handleGetContentOpportunities,
    submitToSearchEngines,
    getDB,
    saveDB,
    regenerateSite,
    touchLiveStatus,
    cleanupLiveStatus
};
