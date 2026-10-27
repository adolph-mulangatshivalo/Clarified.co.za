# Clarified.co.za &mdash; AI Pair Programming & Editorial Guidelines

Welcome to the **Clarified.co.za** codebase and publishing platform. Clarified is an independent South African articles platform exploring technology, education, business, lifestyle, and culture through thoughtful perspectives and insights.

---

## 1. Editorial Voice & Readability (Accessible to All Ages)
* **Simple, Everyday English:** Write clearly, warmly, and directly. Avoid bloated academic words, corporate jargon, and dense sentences.
  * Use "use" instead of "utilize"
  * Use "start" instead of "commence"
  * Use "pay" or "salary" instead of "remuneration"
  * Use "because" instead of "in light of the fact that"
* **Bite-Sized Paragraphs:** Maximum **2 to 3 sentences** (40–60 words) per paragraph. Never write monolithic blocks of text.
* **Clarify All Acronyms:** Always spell out and explain South African terms upon first mention (e.g. NSFAS, DHET, SARS, APS score, SETA, K53).

---

## 2. Formatting & Visual Scannability
* Divide articles with question-driven, actionable `<h2>` and `<h3>` subheadings.
* **Mandatory Comparison Tables:** Anything that requires comparing salaries, degrees, bursary requirements, vehicle specs, or step-by-step processes MUST include a proper HTML table wrapped in `<div class="table-responsive"><table class="clarified-table">...</table></div>` for seamless mobile readability.
* Include bullet points (`<ul>`), numbered step-by-step guides (`<ol>`), and summary comparison tables.
* Highlight critical advice with callout boxes (`<div class="callout-box">`).
* Ensure `<h2>` elements remain intact so the automatic Table of Contents (`what-to-expect-box`) renders anchor links for Google sitelinks.
* **Clean Excerpts:** Excerpts must be punchy (100–140 characters), truncate cleanly at word boundaries, and append `...` if truncated—never cutting words in half or hanging abruptly.

---

## 3. Deep Factual Research & Source Citations
* **Mandatory Fact-Checking:** Before drafting, use `search_web` to verify numbers, dates, admission requirements, legal thresholds, and facts.
* **Official Sources:** Cite verified South African primary sources (`gov.za`, `statssa.gov.za`, university faculty portals, verified industry bodies).
* **Outbound Links:** Include 1 to 2 verified external links to the primary official portals (e.g. official NSFAS application portal, SARS eFiling, university admissions) with clear descriptive anchor text.
* **Subtle Internal Links (Max 2):** Include at most **2** internal links per article (`/articles/[slug].html`). Weave them subtly and naturally into the sentence flow (e.g. "...when practicing <a href=\"/articles/how-to-pass-matric-maths.html\">matric maths exam techniques</a>..."). NEVER use formulaic spam like "Check out our guide on [X]...". Never use preview domains like `clarified-co-za.vercel.app`.

---

## 4. Realistic Editorial Imagery & Consistent Dimensions
* **Consistent 16:9 Dimensions:** All article images are standardized at 16:9 aspect ratio (`max-width: 800px`, `height: 420px`, `object-fit: cover`) via `.article-hero-image` to ensure visual consistency across all articles and devices. Images must never blow up or distort.
* Images must look authentic and realistic, featuring real South African contexts (diverse students on university campuses, genuine modern workplaces, city skylines, real vehicles, practical tools).
* Strictly avoid cartoonish, distorted, or bizarre AI art.
* Provide descriptive, keyword-rich `imgAlt` text for Google Image search indexing.

---

## 5. Technical SEO, Googlebot Crawling & Sitemaps
* **High-CTR Titles:** Under 60 characters, with focus keyword, concrete numbers, or current year (2026).
* **Compelling Meta Description:** 120–155 characters with a clear summary and call to action.
* **Schema.org Structured Data:** Valid `Article` JSON-LD schema with dates, author, and publisher logo.
* **Sitemap Auto-Update:** `sitemap.xml` is automatically regenerated with ISO `<lastmod>` timestamps, `<priority>` ratings, image tags, and category hub pages.
* **Robots.txt Crawl Efficiency:** Explicitly allow articles, images, and category pages while disallowing `/dashboard/` and `/api/` to maximize Googlebot crawl budget.

---

## 6. Pre-Flight Quality Gate & Homepage Placement
* Run `detect_duplicates` to prevent keyword cannibalization or slug collisions.
* Run `validate_article_quality` before publishing.
* Assign explicit `homepagePlacement` (`top_story`, `editors_pick`, `must_read`, etc.) to keep the homepage freshly curated.
