# Worker 3: Outline Generator Worker Specification & Implementation Prompt

## Objective
Implement **Worker 3: Outline Generator Worker** in the DevKit Market AI Daily Blog Generator architecture. This worker processes SEO blueprints from `outline_queue`, invokes Google Vertex AI (`gemini-2.5-pro`), and constructs a detailed multi-section article outline including introduction hooks, H2/H3 subheadings, code example requirements, benchmark table specs, FAQ items, summary, and call-to-action (CTA).

---

### 📥 Inputs
Payload dequeued from BullMQ `outline_queue`:
```json
{
  "blogId": "blog-cuid-987",
  "plan": {
    "seoTitle": "Next.js 15 Partial Prerendering: Production Architecture & Optimization",
    "slug": "nextjs-15-partial-prerendering-production-guide",
    "primaryKeyword": "Next.js 15 Partial Prerendering",
    "secondaryKeywords": ["PPR architecture", "React 19 Suspense streaming"],
    "targetAudience": "Senior Frontend Engineers"
  }
}
```

---

### 🧠 Vertex AI Gemini 2.5 Pro Prompt Blueprint
```text
System Instruction:
You are a Principal Software Architect and Content Strategist. Create a rigorous, highly structured, 8-section blog post outline designed to guide a 3,000-word deep-dive article.

Article Title: {{plan.seoTitle}}
Primary Keyword: {{plan.primaryKeyword}}
Target Audience: {{plan.targetAudience}}

Respond ONLY with valid JSON matching this schema:
{
  "introduction": {
    "hook": "Discuss zero-bundle runtime shifts and the problem with binary SSG vs SSR choices.",
    "problemStatement": "Traditional SSR adds latency; SSG lacks fresh dynamic user data.",
    "solutionOverview": "Partial Prerendering (PPR) combines static shell caching with streamed dynamic holes."
  },
  "sections": [
    {
      "h2": "Understanding PPR: Static Shells vs Dynamic Holes",
      "h3List": ["The Core Mechanics of Experimental PPR", "React 19 Suspense Boundaries"],
      "keyTakeaways": ["Sub-10ms TTFB", "Zero client JS overhead for static parts"],
      "codeSnippetRequired": true,
      "snippetDescription": "app/page.tsx showing experimental_ppr = true and Suspense fallback"
    },
    {
      "h2": "Architectural Deep Dive & Configuration Steps",
      "h3List": ["Enabling PPR in next.config.ts", "Caching Rules and Revalidation"],
      "codeSnippetRequired": true,
      "snippetDescription": "next.config.ts configuration block with experimental ppr flag"
    },
    {
      "h2": "Performance Benchmarks & Memory Overhead",
      "tableRequired": true,
      "tableColumns": ["Metric", "Standard SSR", "Static SSG", "PPR Hybrid"],
      "keyTakeaways": ["TTFB comparison", "First Contentful Paint (FCP)", "TTI metrics"]
    }
  ],
  "faq": [
    {
      "question": "Is PPR production-ready in Next.js 15?",
      "answerOverview": "PPR is currently experimental in Next.js 15 but stable for canary testing."
    },
    {
      "question": "How does PPR affect Vercel / Cloud Run deployment costs?",
      "answerOverview": "PPR reduces server compute costs by serving cached static shells from edge CDN."
    }
  ],
  "summary": "PPR represents the modern convergence of static speed and dynamic flexibility.",
  "cta": "Explore DevKit Market's starter templates and benchmarks repo."
}
```

---

### 📤 Output & Queue Transition
1. Store generated JSON outline in database `Blog` record (`Blog.content` draft or JSON field).
2. Push job payload to BullMQ `writing_queue`:
   ```typescript
   await writingQueue.add("write_blog", {
     blogId: blog.id,
     plan: job.data.plan,
     outline: outlineResult,
   });
   ```

---

### 🛠️ Implementation Checklist
- [ ] Create `workers/outline-worker/src/index.ts`
- [ ] Build Gemini 2.5 Pro outline generator in `packages/ai/src/outline.ts`
- [ ] Validate generated outline schema using Zod
- [ ] Dispatch payload to `writing_queue`
