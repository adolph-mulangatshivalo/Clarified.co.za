const fs = require('fs');
const path = require('path');

const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
const EDITOR_PATH = path.join(DASHBOARD_DIR, 'editor.html');
const SERVER_PATH = path.join(DASHBOARD_DIR, 'server.js');

// 1. Update editor.html
let editorHtml = fs.readFileSync(EDITOR_PATH, 'utf8');

// Insert Secondary Keywords after Focus Keyword
if (!editorHtml.includes('f-secondarykw')) {
    const kwHtml = `
                        <div>
                            <label style="display:block;margin-bottom:6px;color:#5f696c;font-weight:600;font-size:14px;">Secondary Keywords</label>
                            <input id="f-secondarykw" type="text" placeholder="e.g. AI jobs, MTN careers"
                                style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:7px;outline:none;font-size:14px;box-sizing:border-box;">
                        </div>`;
    editorHtml = editorHtml.replace(/(<input id="f-focuskw"[^>]+>\s*<\/div>)/, `$1\n${kwHtml}`);
}

// Insert Image Alt Text after Featured Image input
if (!editorHtml.includes('f-imgalt')) {
    const altHtml = `<input id="f-imgalt" type="text" placeholder="Image alt text..." style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:7px;outline:none;font-size:14px;box-sizing:border-box;margin-top:8px;">`;
    editorHtml = editorHtml.replace(/(<input id="img-file"[^>]+>)/, `$1\n${altHtml}`);
}

// Insert Indexing, Follow Links, Article Type after Canonical URL
if (!editorHtml.includes('f-indexing')) {
    const extraSeoHtml = `
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                            <div>
                                <label style="display:block;margin-bottom:6px;color:#5f696c;font-weight:600;font-size:14px;">Indexing</label>
                                <select id="f-indexing" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:7px;outline:none;font-size:14px;box-sizing:border-box;">
                                    <option value="index">Index</option>
                                    <option value="noindex">Noindex</option>
                                </select>
                            </div>
                            <div>
                                <label style="display:block;margin-bottom:6px;color:#5f696c;font-weight:600;font-size:14px;">Follow Links</label>
                                <select id="f-followlinks" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:7px;outline:none;font-size:14px;box-sizing:border-box;">
                                    <option value="follow">Follow</option>
                                    <option value="nofollow">Nofollow</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style="display:block;margin-bottom:6px;color:#5f696c;font-weight:600;font-size:14px;">Article Type</label>
                            <select id="f-articletype" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:7px;outline:none;font-size:14px;box-sizing:border-box;">
                                <option value="Article" selected>Article</option>
                                <option value="NewsArticle">NewsArticle</option>
                            </select>
                        </div>`;
    editorHtml = editorHtml.replace(/(<input id="f-canonical"[^>]+>\s*<\/div>\s*<\/div>)/, `$1\n${extraSeoHtml}`);
}

// Add to save payload
if (!editorHtml.includes('secondaryKw:')) {
    editorHtml = editorHtml.replace(/focusKw:\s*document.getElementById\('f-focuskw'\).value.trim\(\),/, 
        `focusKw:   document.getElementById('f-focuskw').value.trim(),
        secondaryKw: document.getElementById('f-secondarykw').value.trim(),
        imgAlt:      document.getElementById('f-imgalt').value.trim(),
        indexing:    document.getElementById('f-indexing').value,
        followLinks: document.getElementById('f-followlinks').value,
        articleType: document.getElementById('f-articletype').value,`);
}

// Add to init article loading
if (!editorHtml.includes("document.getElementById('f-secondarykw').value")) {
    editorHtml = editorHtml.replace(/document\.getElementById\('f-focuskw'\)\.value\s*=\s*article\.focusKw\s*\|\|\s*'';/, 
        `document.getElementById('f-focuskw').value         = article.focusKw   || '';
        document.getElementById('f-secondarykw').value     = article.secondaryKw || '';
        if (document.getElementById('f-imgalt')) document.getElementById('f-imgalt').value = article.imgAlt || '';
        if (document.getElementById('f-indexing')) document.getElementById('f-indexing').value = article.indexing || 'index';
        if (document.getElementById('f-followlinks')) document.getElementById('f-followlinks').value = article.followLinks || 'follow';
        if (document.getElementById('f-articletype')) document.getElementById('f-articletype').value = article.articleType || 'Article';`);
}
fs.writeFileSync(EDITOR_PATH, editorHtml);


// 2. Update server.js
let serverJs = fs.readFileSync(SERVER_PATH, 'utf8');

// Update DB save fields
if (!serverJs.includes('secondaryKw:')) {
    serverJs = serverJs.replace(/focusKw:\s*data.focusKw\s*\|\|\s*'',/g, 
        `focusKw:  data.focusKw  || '',
                    secondaryKw: data.secondaryKw || '',
                    imgAlt: data.imgAlt || '',
                    indexing: data.indexing || 'index',
                    followLinks: data.followLinks || 'follow',
                    articleType: data.articleType || 'Article',`);
}

// Replace alt text in generated image
serverJs = serverJs.replace(/alt="\$\{a\.title\}"/g, 'alt="${a.imgAlt || a.title}"');

// Generate SEO meta and JSON-LD
const seoCode = `
        const isoDate = new Date(a.date).toISOString();
        const absoluteUrl = 'https://clarified.co.za/articles/' + a.slug + '.html';
        const absoluteImg = a.featuredImage ? 'https://clarified.co.za/' + a.featuredImage : '';
        const indexingContent = \`\${a.indexing || 'index'}, \${a.followLinks || 'follow'}\`;
        const canonicalUrl = a.canonical || absoluteUrl;
        
        let seoMeta = \`
<meta name="description" content="\${metaDesc}">
<meta name="robots" content="\${indexingContent}">
<link rel="canonical" href="\${canonicalUrl}">
<meta property="og:title" content="\${seoTitle}">
<meta property="og:description" content="\${metaDesc}">
<meta property="og:url" content="\${absoluteUrl}">
<meta property="og:type" content="article">
\${absoluteImg ? \`<meta property="og:image" content="\${absoluteImg}">\` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="\${seoTitle}">
<meta name="twitter:description" content="\${metaDesc}">
\${absoluteImg ? \`<meta name="twitter:image" content="\${absoluteImg}">\` : ''}
\`;
        
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
        seoMeta += \`<script type="application/ld+json">\\n\${JSON.stringify(jsonLd, null, 2)}\\n</script>\\n\`;

        out = out.replace('</head>', seoMeta + '</head>');
`;

// Remove old description replace logic and insert new seoMeta
serverJs = serverJs.replace(/if\s*\(metaDesc\)\s*\{\s*if\s*\(out\.includes.*?\}\s*\}/s, seoCode);

// Generate sitemap and robots.txt at the end of regenerateStaticSite()
const sitemapCode = `
    // Generate robots.txt
    const robotsTxt = \`User-agent: *\\nAllow: /\\nSitemap: https://clarified.co.za/sitemap.xml\`;
    fs.writeFileSync(path.join(SITE_ROOT, 'robots.txt'), robotsTxt);
    
    // Generate sitemap.xml
    const sitemapUrls = published.map(a => \`  <url>\\n    <loc>https://clarified.co.za/articles/\${a.slug}.html</loc>\\n    <lastmod>\${new Date(a.date).toISOString().split('T')[0]}</lastmod>\\n  </url>\`).join('\\n');
    const sitemapXml = \`<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n  <url>\\n    <loc>https://clarified.co.za/</loc>\\n  </url>\\n\${categories.map(catSlug => \`  <url>\\n    <loc>https://clarified.co.za/category-\${catSlug}.html</loc>\\n  </url>\`).join('\\n')}\\n\${sitemapUrls}\\n</urlset>\`;
    fs.writeFileSync(path.join(SITE_ROOT, 'sitemap.xml'), sitemapXml);
`;

if (!serverJs.includes('robots.txt')) {
    serverJs = serverJs.replace(/fs\.writeFileSync\(path\.join\(SITE_ROOT, 'index\.html'\), idx\);\n\s*\}/, `fs.writeFileSync(path.join(SITE_ROOT, 'index.html'), idx);\n    }${sitemapCode}`);
}

fs.writeFileSync(SERVER_PATH, serverJs);

console.log("SEO updates applied successfully.");
