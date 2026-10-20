import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const hasGithubToken = Boolean(process.env.GITHUB_TOKEN);
        const githubOwner = process.env.GITHUB_OWNER || 'adolph-mulangatshivalo';
        const githubRepo = process.env.GITHUB_REPO || 'Clarified.co.za';
        const githubBranch = process.env.GITHUB_BRANCH || 'main';

        // Check db stats
        let totalArticles = 0;
        let publishedArticles = 0;
        let draftArticles = 0;

        let dbPath = path.join(process.cwd(), 'dashboard', 'db.json');
        if (!fs.existsSync(dbPath)) {
            dbPath = path.join(process.cwd(), 'Clarified Dashboard', 'db.json');
        }
        if (fs.existsSync(dbPath)) {
            try {
                const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                const articles = db.articles || [];
                totalArticles = articles.length;
                publishedArticles = articles.filter(a => a.status === 'published').length;
                draftArticles = articles.filter(a => a.status === 'draft').length;
            } catch(e) {}
        }

        const tools = [
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

        return res.status(200).json({
            status: "ready",
            connected: true,
            serverName: "novamira-clarified-co-za",
            protocol: "Model Context Protocol (MCP) v1.0",
            serverScript: "mcp/server.js",
            environment: {
                githubOwner,
                githubRepo,
                githubBranch,
                githubSyncEnabled: hasGithubToken,
                searchConsoleProperty: "https://clarified.co.za/",
                searchConsoleConfigured: true,
                totalArticles,
                publishedArticles,
                draftArticles
            },
            toolCount: tools.length,
            tools
        });
    } catch(err) {
        return res.status(500).json({
            status: "error",
            connected: false,
            error: err.message
        });
    }
}
