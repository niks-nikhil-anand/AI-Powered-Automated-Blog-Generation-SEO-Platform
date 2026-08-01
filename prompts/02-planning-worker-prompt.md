# Worker 2: Blog Planning Worker Specification & Implementation Prompt

## Objective
Implement **Worker 2: Blog Planning Worker** in the DevKit Market AI Daily Blog Generator architecture. This worker processes trending topic payloads from `planning_queue`, invokes Google Vertex AI (`gemini-2.5-flash`), and generates a comprehensive SEO blueprint including titles, slugs, primary/secondary/long-tail keywords, search intent, target audience, meta title, meta description, estimated reading time, category, and tags.

---

### 📥 Inputs
Payload dequeued from BullMQ `planning_queue`:
```json
{
  "trendId": "clx123abc",
  "topic": "Next.js 15 Partial Prerendering",
  "category": "Frameworks",
  "score": 96.4
}
```

---

### 🧠 Vertex AI Gemini Prompt Blueprint
```text
System Instruction:
You are an expert Senior Technical SEO Strategist for DevKit Market, a premier technology blog network.
Given a trending technical topic, generate a structured JSON planning blueprint optimizing for high Google Search rankings (Search Intent: Informational/Transactional).

Input Topic: {{topic}}
Category: {{category}}

Respond ONLY with valid JSON matching this schema:
{
  "seoTitle": "Next.js 15 Partial Prerendering: Production Architecture & Optimization",
  "slug": "nextjs-15-partial-prerendering-production-guide",
  "primaryKeyword": "Next.js 15 Partial Prerendering",
  "secondaryKeywords": ["PPR architecture", "React 19 Suspense streaming", "Next.js 15 performance"],
  "longTailKeywords": ["how to enable PPR in Next.js 15", "Next.js partial prerendering benchmarks vs SSG"],
  "searchIntent": "Informational",
  "targetAudience": "Senior Frontend Engineers, Fullstack Next.js Developers, Technical Leads",
  "metaTitle": "Next.js 15 Partial Prerendering: Production Architecture Guide (58 chars)",
  "metaDescription": "How PPR combines static shell caching with streamed dynamic holes in Next.js 15 — benchmarks, setup, and migration steps. (148 chars)",
  "readingTime": "12 min read",
  "category": "Frameworks",
  "tags": ["Next.js", "React 19", "Frontend", "Performance", "WebDev"]
}
```

---

### 📤 Output & Queue Transition
1. Save draft `Blog` record to PostgreSQL via Prisma with `status: DRAFT`.
2. Push job payload to BullMQ `outline_queue`:
   ```typescript
   await outlineQueue.add("generate_outline", {
     blogId: blog.id,
     plan: planningResult,
   });
   ```

---

### 🛠️ Implementation Checklist
- [ ] Create `workers/planning-worker/src/index.ts`
- [ ] Implement Gemini 2.5 Flash caller in `packages/ai/src/planning.ts` using `@google-cloud/vertexai`
- [ ] Enforce strict JSON Schema parsing with Zod
- [ ] Handle slug uniqueness check against database `Blog` table
- [ ] Dispatch to `outline_queue` upon successful validation
