# Worker 6: Quality Analysis Worker Specification & Implementation Prompt

## Objective
Implement **Worker 6: Quality Analysis Worker** in the DevKit Market AI Daily Blog Generator architecture. This worker acts as the strict automated QA gatekeeper. It evaluates generated articles across 13 audit criteria, calculates a aggregate Quality Score (0–100), and enforces a strict publication threshold (Quality Score ≥ 90). If passed, the job moves to `publish_queue`; if failed, it triggers retry routing or flags the post for manual review in the dashboard.

---

### 📥 Inputs
Payload dequeued from BullMQ `quality_queue`:
```json
{
  "blogId": "blog-cuid-987",
  "slug": "nextjs-15-partial-prerendering-production-guide"
}
```

---

### 🔍 13 Automated Quality & SEO Inspection Checks
1. **Grammar & Syntax**: Zero grammatical, spelling, or punctuation errors.
2. **SEO Optimization Score**: Title length (50-60 chars), Meta description (140-160 chars), URL slug format.
3. **Flesch Reading Ease**: Readability score (Target: 60-80).
4. **Plagiarism & Originality**: Verifies 0% duplicated verbatim text.
5. **AI Hallucination Verification**: Code snippets and framework API syntax check.
6. **Fact Checking**: Technical accuracy of software versions and features (e.g. Next.js 15, React 19).
7. **Broken Markdown Check**: Validates unclosed code blocks, broken tables, or corrupt markdown formatting.
8. **Accessibility Audit**: Verifies all images have descriptive `alt` text.
9. **Image Alt Text Quality**: Checks alt text relevance and length.
10. **Internal Links Presence**: Includes relevant links to DevKit Market resources.
11. **External Reference Links**: Includes valid HTTP links to authoritative documentation.
12. **Keyword Density**: Primary keyword density between 1.0% and 2.5%.
13. **Heading Hierarchy**: Enforces single `<h1>` and ordered `<h2>`/`<h3>` structure.

---

### 🧠 Vertex AI Gemini Quality Evaluation Prompt
```text
System Instruction:
You are an uncompromising Lead Content Quality Editor. Audit the following Markdown blog post against strict publishing standards.

Markdown Body: {{blog.content}}
Primary Keyword: {{blog.seo.keywords}}

Respond ONLY with valid JSON matching this schema:
{
  "grammarScore": 98,
  "seoScore": 96,
  "readabilityScore": 88,
  "plagiarismScore": 100,
  "qualityScore": 94,
  "pass": true,
  "reasons": ["Grammar clean", "Alt text verified", "Code syntax valid"],
  "failedChecks": []
}
```

---

### 🚪 Gate Decision & Queue Routing
- **Pass (Score ≥ 90)**: Update `BlogSEO.score = qualityScore`, update `Blog.status = PENDING_REVIEW` or `PUBLISHED`, push to `publish_queue`.
- **Fail (Score < 90)**: Update `Blog.status = FAILED`, log rejection reasons, and dispatch job to `writing_queue` with retry prompt or flag in Admin Dashboard for manual override.

---

### 🛠️ Implementation Checklist
- [ ] Create `workers/quality-worker/src/index.ts`
- [ ] Implement 13 quality checks in `packages/seo/src/quality.ts`
- [ ] Store audit score in `BlogSEO` Prisma model
- [ ] Enforce Quality Gate (Score ≥ 90) before dispatching to `publish_queue`
