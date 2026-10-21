---
name: clarified-article-writer
description: >-
  Editorial and SEO runbook for researching, writing, optimizing, and publishing
  articles on Clarified.co.za. Enforces plain everyday English, short scannable paragraphs,
  factual South African research, verified external and internal links, realistic imagery,
  Schema.org JSON-LD structured data, and high-CTR search rankings.
---

# Clarified Editorial, Writing & SEO Master Skill

Clarified.co.za is a modern, independent South African news, careers, finance, and tech publication. Our editorial mission is to make important information **crystal clear, engaging, and genuinely useful** for readers of all ages and backgrounds—from high school matriculants and university students to young professionals, parents, and everyday South Africans.

---

## 1. Writing Style: Simple, Punchy English for All Ages

### The "Coffee Shop" Rule
Write as if you are explaining the topic to a smart friend at a coffee shop. Be clear, warm, engaging, and direct. Avoid stuffy academic language, bloated corporate jargon, and confusing $10 words when a simple word gets the point across faster.

* **Replace Complex Words with Simple Everyday Words:**
  * Instead of *utilize* &rarr; use **use**
  * Instead of *subsequently* &rarr; use **then** or **after that**
  * Instead of *commence* &rarr; use **start** or **begin**
  * Instead of *remuneration* &rarr; use **salary**, **pay**, or **earnings**
  * Instead of *facilitate* &rarr; use **help**, **guide**, or **make easier**
  * Instead of *in light of the fact that* &rarr; use **because** or **since**
  * Instead of *terminate* &rarr; use **end** or **stop**
  * Instead of *numerous* &rarr; use **many** or **lots of**

### Bite-Sized Paragraphs (Max 2–3 Sentences)
* Never write long walls of text. Giant paragraphs intimidate readers, especially on mobile phones.
* Keep paragraphs strictly to **2 to 3 sentences** (40–60 words max).
* Give thoughts room to breathe with white space between paragraphs.

### South African Context & Clarifying Acronyms
* Always spell out and explain South African acronyms and terminology on first mention:
  * **NSFAS**: National Student Financial Aid Scheme (government student funding).
  * **DHET**: Department of Higher Education and Training.
  * **SARS**: South African Revenue Service.
  * **APS**: Admission Point Score (used by South African universities to calculate matric results).
  * **SETA**: Sector Education and Training Authority.
  * **K53**: The official South African driving licence examination standard.
* Use authentic South African terminology naturally where appropriate (e.g., matric, bakkie, load shedding, NSFAS, SASSA, tertiary education) without descending into forced slang.

---

## 2. Formatting & Visual Scannability

Every article must look inviting, structured, and easy to skim. Readers must be able to glance at an article and instantly extract value.

### Elements Every Article Must Include:
1. **Engaging Subheadings (`<h2>` and `<h3>`):**
   * Make subheadings actionable and question-based (e.g., `<h2>How Much Does It Actually Cost?</h2>`, `<h2>Step 1: Check Your Minimum APS Score</h2>`, `<h2>Common Mistakes to Avoid</h2>`).
   * Never use generic headings like "Overview" or "Conclusion".
2. **"What to Expect" Table of Contents:**
   * Clarified automatically parses `<h2>` elements into a `<div class="what-to-expect-box">` with anchor links. This provides instant on-page navigation and generates Google Search sitelinks in search results.
3. **Bullet Points and Numbered Steps:**
   * Break down lists of requirements, benefits, or actionable steps into clean bullet points (`<ul>`) or numbered steps (`<ol>`).
4. **Summary & Comparison Tables:**
   * When comparing degrees, salaries, institutions, or vehicle specs, include a clean HTML table (`<table>`) for instant clarity.
5. **Key Takeaway / Callout Blocks:**
   * Use highlighted callouts for critical warnings, deadlines, or pro tips:
     ```html
     <div class="callout-box" style="background:#f0f7f8;border-left:4px solid #006666;padding:16px 20px;border-radius:6px;margin:24px 0;">
       <strong>Pro Tip:</strong> Apply before the August cut-off date to avoid late registration penalties.
     </div>
     ```

---

## 3. Factual Research Protocol (Mandatory Before Writing)

Clarified readers rely on us for life-altering decisions: career choices, university applications, bursaries, and financial planning. **Inaccuracy is unacceptable.**

### The 4-Step Research Workflow:
1. **Search Authoritative Web Sources:**
   * Before writing, call `search_web` to collect current, verified facts.
   * Prioritize primary sources:
     * **Government Portals:** `gov.za`, `dhet.gov.za`, `sars.gov.za`, `statssa.gov.za`, `dsd.gov.za`.
     * **Official Universities:** `wits.ac.za`, `uct.ac.za`, `up.ac.za`, `uj.ac.za`, `sun.ac.za`, `unisa.ac.za`.
     * **Reputable Research & Industry Data:** CareerJunction, OfferZen, Stats SA Labour Force Surveys, Engineering Council of South Africa (ECSA).
     * **Verified Financial & Business Outlets:** Business Day, News24, Moneyweb, TechCentral.
2. **Verify Numbers & Dates:**
   * Double-check application deadlines, salary ranges, pass requirements, and interest rates against the current year (2026).
3. **Never Guess:**
   * If a specific fee or requirement varies by university, explicitly state that and link directly to the faculty's official prospectus.
4. **Distinguish Facts from Commentary:**
   * Present verified data clearly, then explain what it means for the reader in practical, actionable terms.

---

## 4. Link Building: Outbound Source Links & Internal Clarified Links

Search engines reward articles that provide genuine source citations and clean topical internal links.

### Outbound Links to Official Sources (2–4 Per Article)
* Link directly to the primary website where the reader can take action (e.g. download forms, check admission status, apply online).
* Use natural, descriptive anchor text:
  * **Good:** `You can submit your application directly on the <a href="https://www.nsfas.org.za" target="_blank" rel="noopener noreferrer">official NSFAS portal</a>.`
  * **Bad:** `<a href="https://www.nsfas.org.za">Click here</a>.`

### Subtle Contextual Internal Links (Strictly Maximum 2 Per Article)
* **Maximum 2 Links:** Never clutter articles with links. Include at most two internal links in the entire article (e.g. one in the middle and one near the conclusion or intro).
* **Must Be Subtle and Natural:** Never write jarring, formulaic promotional sentences like *"Check out our guide on [X] for tips"* or *"Read more about [X] here"*.
* **Seamless In-Sentence Anchor Text:**
  * **Strictly Banned:** `Check out our guide on <a href="...">how to pass matric maths easily</a> for practical exam techniques.`
  * **Correct & Subtle:** `When preparing for final exams, students who practice proven <a href="/articles/how-to-pass-matric-maths.html">matric maths exam techniques</a> consistently score higher.`
* **Clean URLs Only:** Always link to `/articles/[slug].html` (or `https://clarified.co.za/articles/[slug].html`). Never use temporary preview URLs (like `clarified-co-za.vercel.app`).
* **Fast & Token-Efficient:** Keep drafts concise, focused, and high-value without repetitive filler words.

---

## 5. High-Quality, Realistic Editorial Imagery

Images give the first visual impression of quality and credibility.

### Imagery Standards:
* **Authentic South African Context:** Feature real, relatable settings—diverse students collaborating on campuses, modern South African workplaces, bustling urban centers, practical technical tools, or genuine vehicles.
* **Realistic Editorial Style:** Avoid plastic, cartoonish, or bizarre AI art with warped hands, surreal lighting, or floating text. Images must look like authentic press/editorial photography.
* **Descriptive `imgAlt` Text (Mandatory for SEO):**
  * Include a descriptive, keyword-rich sentence for every image so Google Images indexes the photo.
  * **Example:** `South African university engineering students working with high-tech equipment in a modern laboratory.`

---

## 6. Technical SEO & High-CTR Blueprint

To rank #1 on Google and achieve high Click-Through Rates (CTR), follow these proven specifications:

### 1. Click-Worthy Titles (Max 60 Characters)
* Put the main keyword near the front.
* Include concrete numbers, current year, or emotional triggers:
  * *Top Degrees with the Highest Employment Rate in South Africa: 2026 Guide*
  * *How to Pass Matric Maths Easily: 12 Tips That Actually Work*
  * *10 Bakkie Side Hustles You Can Start in South Africa Today*

### 2. Irresistible Meta Descriptions (120–155 Characters)
* Summarize the exact benefit and finish with a call to action.
* **Example:** `Looking for job security in SA? Discover the degrees with the highest employment rates in 2026, real salary insights, and how to pick the right career path.`

### 3. Heading Hierarchy
* **Single `<h1>`:** The article title (rendered by the CMS template).
* **Hierarchical `<h2>` and `<h3>`:** Divide the body into logical sections. Never skip heading levels.

### 4. Schema.org JSON-LD Structured Data
* Every article must output valid `NewsArticle` or `Article` JSON-LD schema with `headline`, `datePublished`, `dateModified`, `author`, `publisher`, and `image` metadata. Google uses this for Rich Snippets and Google News inclusion.

### 5. Sitemaps & Googlebot Crawling
* Every publication or edit must automatically update `sitemap.xml` with:
  * Real `<lastmod>` timestamps in ISO 8601 format (`YYYY-MM-DD`).
  * Explicit `<priority>` tags (`1.0` for home, `0.9` for top stories/editor picks, `0.8` for articles, `0.7` for category hubs).
  * Image tags (`<image:image><image:loc>...</image:loc></image:image>`) for Google Images discovery.
  * All 10 category hub pages.
* `robots.txt` must explicitly allow articles, images, and category pages while disallowing `/dashboard/` and `/api/` to maximize Googlebot crawl budget.

---

## 7. Pre-Flight Quality Gate Checklist

Before publishing any article live to Clarified.co.za, run this checklist:

1. [ ] **Factual Accuracy:** Verified dates, numbers, and sources via `search_web`.
2. [ ] **Reading Level:** Written in clear, plain everyday English accessible to all ages.
3. [ ] **Formatting:** Short 2–3 sentence paragraphs; bullet lists; summary table or callout box included.
4. [ ] **Headings:** Single H1, engaging descriptive H2s and H3s; Table of Contents generated.
5. [ ] **Outbound Links:** 2–4 verified links to official primary sources with descriptive anchor text.
6. [ ] **Internal Links:** 3–5 verified links to existing Clarified articles.
7. [ ] **Duplicates Check:** Checked with `detect_duplicates` (no keyword cannibalization or slug collisions).
8. [ ] **SEO Meta:** Title under 60 chars, meta description under 155 chars, keyword present in first 100 words.
9. [ ] **Image & Alt Text:** Realistic editorial photo with descriptive `imgAlt`.
10. [ ] **Quality Gate Pass:** Passed `validate_article_quality`.
11. [ ] **Homepage Curation:** Assigned appropriate `homepagePlacement` (`top_story`, `editors_pick`, `must_read`, etc.) and confirmed static compilation of `index.html` and `sitemap.xml`.
