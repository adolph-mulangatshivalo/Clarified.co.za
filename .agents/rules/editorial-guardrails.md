# Clarified Editorial, Writing & SEO Guardrails

Whenever researching, drafting, editing, or publishing content for Clarified.co.za, strictly follow these editorial, readability, and SEO rules:

## 1. Short, Straightforward & Simple South African English
* **Keep articles concise (not very long):** Target **450 to 800 words** (2–4 minute read). Never pad articles with fluff, repetitive intros, or filler paragraphs. Readers want clear answers fast.
* **Get straight to the point:** Answer the reader's question directly in the opening lines. Avoid long-winded backstories.
* **Very simple South African English:** Write in plain, everyday conversational English that anyone across South Africa can understand immediately.
  * Use "use" instead of "utilize"
  * Use "start" instead of "commence"
  * Use "pay" or "salary" instead of "remuneration"
  * Use "because" instead of "in light of the fact that"
  * Use "help" instead of "facilitate"
  * Use natural everyday South African context (matric, bakkie, NSFAS, SASSA, side hustle, Dezemba) without forced slang.
* **Bite-sized paragraphs:** Strictly limit paragraphs to **2 to 3 sentences** (30–50 words max). Never create giant walls of text.
* **Explain acronyms & South African terms:** Always spell out and clarify acronyms upon first mention (NSFAS, DHET, SARS, APS score, SETA, K53).

## 2. Rich, Scannable Formatting
* Divide content with question-driven, actionable `<h2>` and `<h3>` subheadings.
* Break down complex information into bullet points (`<ul>`), numbered step-by-step guides (`<ol>`), and summary comparison tables (`<table>`).
* Add callout boxes (`<div class="callout-box">`) for pro tips, deadlines, and critical warnings.
* Keep the automatic "WHAT TO EXPECT" Table of Contents (`what-to-expect-box`) intact for easy mobile navigation and Google search sitelinks.

## 3. Deep Research & Factual Sources
* Before drafting, use `search_web` to verify numbers, dates, admission requirements, legal thresholds, and facts.
* Prioritize official, primary South African sources (`gov.za`, `statssa.gov.za`, university faculty portals, verified industry bodies).
* Never invent numbers, salary estimates, or application cutoff dates.

## 4. Authentic External Links & Subtle Internal Links (Max 2)
* **Outbound links to actual sources**: Include 1 to 2 verified external links to the primary official portals (e.g. `https://www.nsfas.org.za`, SARS eFiling, university admissions) with clear descriptive anchor text.
* **Subtle internal links (Strictly Maximum 2)**: Include at most **2** internal links per article (`/articles/[slug].html`).
* **Natural in-sentence anchor text only**: Weave links seamlessly into normal sentences (e.g. "...when practicing <a href=\"/articles/how-to-pass-matric-maths.html\">matric maths exam techniques</a>...").
* **Strictly banned phrasing**: NEVER write repetitive formulaic callouts like *"Check out our guide on [XYZ] for tips"* or *"Read more about [XYZ] here"*.
* **Never use preview domains**: Always link via `/articles/[slug].html` (or `https://clarified.co.za/articles/[slug].html`), never `clarified-co-za.vercel.app`.

## 5. Realistic Editorial Imagery
* Images must look authentic and realistic, featuring real South African contexts (diverse students on university campuses, genuine modern workplaces, city skylines, real vehicles, practical tools).
* Strictly avoid cartoonish, distorted, or bizarre AI art.
* Provide descriptive, keyword-rich `imgAlt` text for Google Image search indexing.

## 6. Technical SEO, Googlebot Crawling & Sitemaps
* **High-CTR Titles**: Under 60 characters, with focus keyword, concrete numbers, or current year (2026).
* **Compelling Meta Description**: 120–155 characters with a clear summary and call to action.
* **Schema.org Structured Data**: Output valid `Article` JSON-LD schema with dates, author, and publisher logo.
* **Sitemap Auto-Update**: Ensure `sitemap.xml` is regenerated with `<lastmod>` ISO dates, `<priority>` ratings, image tags, and category hub pages.
* **Robots.txt Crawl Efficiency**: Ensure `robots.txt` whitelists content while disallowing `/dashboard/` and `/api/` to maximize Googlebot crawl budget.

## 7. Pre-Flight Quality Gate & Automated Homepage Cascading
* Run `detect_duplicates` to prevent keyword cannibalization or slug collisions.
* Run `validate_article_quality` before publishing.
* **Automatic Top Story & Cascading Placement:** Every newly published article must ALWAYS lead as `top_story` (the main Hero card at the top of the homepage). When a new article is published, the previous `top_story` automatically shifts to `hero_side` (card 1), the previous `hero_side` card 1 shifts to `hero_side` (card 2), and the previous `hero_side` card 2 shifts down into `latest`. The newest story must ALWAYS lead the homepage without getting buried.
