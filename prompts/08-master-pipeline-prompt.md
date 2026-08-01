# DevKit Market - Master AI Daily Blog Generator Implementation Prompt

## Architectural Overview
This master prompt provides complete end-to-end instructions for scaffolding, building, and deploying the **DevKit Market AI Daily Blog Generator** pipeline based on [README.md](file:///c:/Users/admin/Desktop/blog-agent/README.md).

The system consists of:
1. **Frontend & CMS Dashboard**: Next.js 15 App Router (`/dashboard`, `/dashboard/blogs`, `/dashboard/trends`, `/dashboard/assets`, `/dashboard/quality`, `/dashboard/workers`, `/dashboard/logs`, `/dashboard/settings`).
2. **7 Distributed BullMQ Workers**:
   - `research-worker`: Multi-source trend fetcher & scoring.
   - `planning-worker`: SEO metadata & strategy (Gemini 2.5 Flash).
   - `outline-worker`: Multi-section outline generation (Gemini 2.5 Pro).
   - `writing-worker`: 2,500 - 4,000 word blog generation (Gemini 2.5 Pro).
   - `image-worker`: Hero & social asset generation (Imagen 4 + GCS).
   - `quality-worker`: 13-point QA audit & Quality Gate ≥ 90 evaluation.
   - `publish-worker`: Database update, Sitemap, RSS, and Google Indexing API.
3. **Core Shared Packages (`packages/`)**:
   - `packages/ai`: Vertex AI SDK client wrappers (Gemini 2.5 Pro, Flash, Imagen 4).
   - `packages/database`: Prisma ORM client & PostgreSQL models.
   - `packages/queue`: BullMQ queue instances and Redis connection options.
   - `packages/storage`: Google Cloud Storage upload and WebP optimization.
   - `packages/seo`: JSON-LD, Sitemap, Indexing API, and RSS generators.
   - `packages/logger`: Winston & Google Cloud Logging integration.

---

### 📂 Full Folder Structure Reference
```
apps/
  web/
    app/
      dashboard/
    components/
packages/
  ai/
  database/
  queue/
  storage/
  seo/
  logger/
workers/
  research-worker/
  planning-worker/
  outline-worker/
  writing-worker/
  image-worker/
  quality-worker/
  publish-worker/
docker/
prisma/
  schema.prisma
  prisma.config.ts
docker-compose.yml
Dockerfile
```

---

### 🚀 Execution Strategy & Sequence
1. **Prisma Setup**: Database models for `Blog`, `BlogSEO`, `Category`, `Asset`, `Trend`, `Job`, `AIUsage` defined in `prisma/schema.prisma`.
2. **Docker Orchestration**: `docker-compose.yml` spinning up `next-app` (3000), `postgres` (5432), and `redis` (6379).
3. **Queue Communication**: Each worker processes its designated queue (`research_queue` -> `planning_queue` -> `outline_queue` -> `writing_queue` -> `image_queue` -> `quality_queue` -> `publish_queue`).

---

### 📌 Refer to Specific Worker Prompt Files:
- [01-research-worker-prompt.md](file:///c:/Users/admin/Desktop/blog-agent/prompts/01-research-worker-prompt.md)
- [02-planning-worker-prompt.md](file:///c:/Users/admin/Desktop/blog-agent/prompts/02-planning-worker-prompt.md)
- [03-outline-worker-prompt.md](file:///c:/Users/admin/Desktop/blog-agent/prompts/03-outline-worker-prompt.md)
- [04-writing-worker-prompt.md](file:///c:/Users/admin/Desktop/blog-agent/prompts/04-writing-worker-prompt.md)
- [05-image-worker-prompt.md](file:///c:/Users/admin/Desktop/blog-agent/prompts/05-image-worker-prompt.md)
- [06-quality-worker-prompt.md](file:///c:/Users/admin/Desktop/blog-agent/prompts/06-quality-worker-prompt.md)
- [07-publisher-worker-prompt.md](file:///c:/Users/admin/Desktop/blog-agent/prompts/07-publisher-worker-prompt.md)
