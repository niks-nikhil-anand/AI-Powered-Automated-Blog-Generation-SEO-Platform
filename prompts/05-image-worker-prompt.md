# Worker 5: Image Generator Worker Specification & Implementation Prompt

## Objective
Implement **Worker 5: Image Generator Worker** in the DevKit Market AI Daily Blog Generator architecture. This worker processes article payloads from `image_queue`, calls Vertex Imagen 4 to generate high-resolution visual assets (Hero Image 1920x1080, Social OG Image 1200x630, Twitter Banner, Thumbnail 512x512), converts images to WebP format, uploads them to Google Cloud Storage under `blogs/2026/08/{slug}/`, and returns public CDN URLs.

---

### 📥 Inputs
Payload dequeued from BullMQ `image_queue`:
```json
{
  "blogId": "blog-cuid-987",
  "title": "Next.js 15 Partial Prerendering: Production Architecture & Optimization",
  "slug": "nextjs-15-partial-prerendering-production-guide"
}
```

---

### 🎨 Vertex Imagen 4 Generation Specifications
Generate 4 distinct image assets for each article:
1. **Hero Image**: Aspect Ratio 16:9 (`1920x1080`), file path: `blogs/2026/08/{slug}/hero.webp`
   - Prompt: `"Modern developer dashboard UI visualization for Next.js 15 Partial Prerendering, glowing indigo and emerald neon data flows, glassmorphism, 8k resolution, photorealistic tech render"`
2. **OG Image**: Aspect Ratio 1.91:1 (`1200x630`), file path: `blogs/2026/08/{slug}/og.webp`
3. **Twitter Banner**: Aspect Ratio 3:1 (`1500x500`), file path: `blogs/2026/08/{slug}/twitter.webp`
4. **Thumbnail**: Aspect Ratio 1:1 (`512x512`), file path: `blogs/2026/08/{slug}/thumbnail.webp`

---

### ⚙️ Image Optimization & Google Cloud Storage Lifecycle
1. Use `sharp` Node.js package to compress and convert raw PNG/JPEG output from Imagen 4 into optimized `.webp` format (Quality: 85%).
2. Upload assets to GCS Bucket (`devkit-market-media`):
   ```typescript
   await storage.bucket("devkit-market-media").upload(filePath, {
     destination: `blogs/2026/08/${slug}/hero.webp`,
     metadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000" },
   });
   ```
3. Generate public CDN URL: `https://cdn.devkit.market/blogs/2026/08/{slug}/hero.webp`
4. Create `Asset` records in PostgreSQL via Prisma.

---

### 📤 Output & Queue Transition
1. Associate `featuredImageId` on the `Blog` model.
2. Push job payload to BullMQ `quality_queue`:
   ```typescript
   await qualityQueue.add("evaluate_blog", {
     blogId: blog.id,
     slug: slug,
   });
   ```

---

### 🛠️ Implementation Checklist
- [ ] Create `workers/image-worker/src/index.ts`
- [ ] Implement Vertex Imagen 4 client wrapper in `packages/ai/src/imagen.ts`
- [ ] Implement GCS upload & WebP conversion helper in `packages/storage/src/index.ts`
- [ ] Save created `Asset` records to PostgreSQL
- [ ] Dispatch payload to `quality_queue`
