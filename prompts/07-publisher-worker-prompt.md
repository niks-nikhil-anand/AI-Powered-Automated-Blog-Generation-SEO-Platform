# Worker 7: Publisher Worker Specification & Implementation Prompt

## Objective
Implement **Worker 7: Publisher Worker** in the DevKit Market AI Daily Blog Generator architecture. This worker handles the final publishing phase for articles that pass the Quality Gate. It persists published records to PostgreSQL via Prisma, updates `BlogStatus` to `PUBLISHED`, generates JSON-LD structured data, rebuilds the XML Sitemap, pings Google Indexing API for rapid search indexing, and generates RSS feed entries.

---

### 📥 Inputs
Payload dequeued from BullMQ `publish_queue`:
```json
{
  "blogId": "blog-cuid-987",
  "qualityScore": 94
}
```

---

### ⚙️ Publishing Tasks & Workflows

1. **Database Record State Update**:
   - Update Prisma `Blog.status = PUBLISHED`
   - Set `publishedAt = new Date()`

2. **JSON-LD Structured Data Generation**:
   Generate Schema.org `TechArticle` / `BlogPosting` JSON block:
   ```json
   {
     "@context": "https://schema.org",
     "@type": "TechArticle",
     "headline": "Next.js 15 Partial Prerendering: Production Guide",
     "description": "How PPR combines static shells with streamed dynamic holes in Next.js 15.",
     "url": "https://devkit.market/blog/nextjs-15-partial-prerendering-production-guide",
     "image": "https://cdn.devkit.market/blogs/2026/08/nextjs-15-ppr/hero.webp",
     "datePublished": "2026-08-01T06:00:00.000Z",
     "publisher": {
       "@type": "Organization",
       "name": "DevKit Market"
     }
   }
   ```
   Save to `BlogSEO.schema` field.

3. **XML Sitemap Rebuild**:
   - Generate static XML sitemap at `public/sitemap.xml` containing all published article URLs and `lastmod` timestamps.

4. **Google Search Console Indexing API Ping**:
   - Send HTTP POST request to Google Indexing API (`https://indexing.googleapis.com/v3/urlNotifications:publish`):
     ```json
     {
       "url": "https://devkit.market/blog/nextjs-15-partial-prerendering-production-guide",
       "type": "URL_UPDATED"
     }
     ```

5. **RSS 2.0 Feed Generation**:
   - Append article to `public/rss.xml`.

---

### 🛠️ Implementation Checklist
- [ ] Create `workers/publish-worker/src/index.ts`
- [ ] Implement JSON-LD schema builder in `packages/seo/src/jsonld.ts`
- [ ] Implement XML sitemap generator in `packages/seo/src/sitemap.ts`
- [ ] Implement Google Indexing API ping client in `packages/seo/src/indexing.ts`
- [ ] Implement RSS generator in `packages/seo/src/rss.ts`
- [ ] Record final execution log in Winston / Google Cloud Logging
