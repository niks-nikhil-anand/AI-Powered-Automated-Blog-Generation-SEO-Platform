# Worker 4: Blog Writer Worker Specification & Implementation Prompt

## Objective
Implement **Worker 4: Blog Writer Worker** in the DevKit Market AI Daily Blog Generator architecture. This worker processes outline payloads from `writing_queue`, invokes Google Vertex AI (`gemini-2.5-pro` with 128k context window), and generates an exhaustive, 2,500 to 4,000-word technical blog post complete with production-ready code snippets, comparative Markdown tables, best practices, FAQ sections, and clean HTML rendering.

---

### 📥 Inputs
Payload dequeued from BullMQ `writing_queue`:
```json
{
  "blogId": "blog-cuid-987",
  "plan": { ... },
  "outline": { ... }
}
```

---

### 🧠 Vertex AI Gemini 2.5 Pro Writing Prompt Blueprint
```text
System Instruction:
You are a Staff Technical Writer and Lead Architect for DevKit Market.
Write an authoritative, highly detailed, 2,500 - 4,000 word technical article in Markdown format based strictly on the provided outline and SEO strategy.

Guidelines:
1. Tone: Deeply technical, practical, authoritative, zero fluff.
2. Code Snippets: Include 3-5 complete, syntax-highlighted (TypeScript/Rust/Go/Docker/SQL) production code examples.
3. Tables: Include at least one Markdown comparison table comparing benchmarks, metrics, or trade-offs.
4. Formatting: Use proper GitHub Flavored Markdown (H1, H2, H3, bolding, blockquotes, lists, tables).
5. Output Format: Return a JSON object with keys: `markdown`, `html`, and `excerpt`.

Article Plan: {{json plan}}
Article Outline: {{json outline}}
```

---

### ⚙️ Post-Processing & Conversion
1. Convert Markdown to HTML using `marked` or `unified`/`remark`/`rehype`.
2. Extract clean text excerpt (150-200 chars).
3. Compute total word count and token cost.
4. Record token usage in Prisma `AIUsage` model (`worker: "writing-worker"`, `model: "gemini-2.5-pro"`).

---

### 📤 Output & Queue Transition
1. Update Prisma `Blog` record:
   - `content = markdown`
   - `html = html`
   - `excerpt = excerpt`
2. Push job payload to BullMQ `image_queue`:
   ```typescript
   await imageQueue.add("generate_images", {
     blogId: blog.id,
     title: plan.seoTitle,
     slug: plan.slug,
   });
   ```

---

### 🛠️ Implementation Checklist
- [ ] Create `workers/writing-worker/src/index.ts`
- [ ] Build Gemini 2.5 Pro long-form generator in `packages/ai/src/writer.ts`
- [ ] Integrate `marked` Markdown to HTML compiler
- [ ] Record AI token usage metrics in PostgreSQL `AIUsage` table
- [ ] Dispatch payload to `image_queue`
