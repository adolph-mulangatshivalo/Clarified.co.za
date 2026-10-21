# Clarified Editorial, Writing & SEO Guardrails

Whenever researching, drafting, editing, or publishing content for Clarified.co.za, strictly follow these editorial, readability, and SEO rules:

## 1. Simple, Everyday English (Accessible to All Ages)
* **Write in plain, conversational English**: Avoid dense academic jargon, bureaucratic filler, and confusing big words. If a simple word works, use it (e.g. use "use" instead of "utilize", "start" instead of "commence", "pay" instead of "remuneration").
* **Bite-sized paragraphs**: Strictly limit paragraphs to **2 to 3 sentences** (40–60 words max). Never create giant walls of text.
* **Explain acronyms & South African terms**: Always spell out and clarify acronyms upon first mention (NSFAS, DHET, SARS, APS score, SETA, K53).

## 2. Rich, Scannable Formatting
* Divide content with question-driven, actionable `<h2>` and `<h3>` subheadings.
* Break down complex information into bullet points (`<ul>`), numbered step-by-step guides (`<ol>`), and summary comparison tables (`<table>`).
* Add callout boxes (`<div class="callout-box">`) for pro tips, deadlines, and critical warnings.
* Keep the automatic "WHAT TO EXPECT" Table of Contents (`what-to-expect-box`) intact for easy mobile navigation and Google search sitelinks.

## 3. Deep Research & Factual Sources
* Before drafting, use `search_web` to verify numbers, dates, admission requirements, legal thresholds, and facts.
* Prioritize official, primary South African sources (`gov.za`, `statssa.gov.za`, university faculty portals, verified industry bodies).
* Never invent numbers, salary estimates, or application cutoff dates.

## 4. Authentic External Links & Verified Internal Links
* **Outbound links to actual sources**: Include 2 to 4 verified external links to the primary official portals (e.g. `https://www.nsfas.org.za`, SARS eFiling, university admissions) with clear descriptive anchor text.
* **Contextual internal links**: Include 3 to 5 verified internal links to related Clarified stories (`/articles/[slug].html`). Use `suggest_internal_links` or check `list_articles` to verify URLs exist.

## 5. Realistic Editorial Imagery
* Images must look authentic and realistic, featuring real South African contexts (diverse students on university campuses, genuine modern workplaces, city skylines, real vehicles, practical tools).
* Strictly avoid cartoonish, distorted, or bizarre AI art.
* Provide descriptive, keyword-rich `imgAlt` text for Google Image search indexing.

## 6. Technical SEO, Googlebot Crawling & Sitemaps
* **High-CTR Titles**: Under 60 characters, with focus keyword, concrete numbers, or current year (2026).
* **Compelling Meta Description**: 120–155 characters with a clear summary and call to action.
* **Schema.org Structured Data**: Output valid `NewsArticle` or `Article` JSON-LD schema with dates, author, and publisher logo.
* **Sitemap Auto-Update**: Ensure `sitemap.xml` is regenerated with `<lastmod>` ISO dates, `<priority>` ratings, image tags, and category hub pages.
* **Robots.txt Crawl Efficiency**: Ensure `robots.txt` whitelists content while disallowing `/dashboard/` and `/api/` to maximize Googlebot crawl budget.

## 7. Pre-Flight Quality Gate & Homepage Placement
* Run `detect_duplicates` to prevent keyword cannibalization or slug collisions.
* Run `validate_article_quality` before publishing.
* Assign explicit `homepagePlacement` (`top_story`, `editors_pick`, `must_read`, etc.) to keep the homepage freshly curated.
