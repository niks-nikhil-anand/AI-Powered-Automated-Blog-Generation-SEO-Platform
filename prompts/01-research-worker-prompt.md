# Worker 1: Research Worker Specification & Implementation Prompt

## Objective
Implement **Worker 1: Research Worker** in the DevKit Market AI Daily Blog Generator architecture. This worker runs as a scheduled daily background job (or via webhook trigger) to crawl technical trend signals from multiple public sources, remove duplicate entries, calculate a normalized Trend Score (0–100), and dispatch selected trending topics into the BullMQ `planning_queue`.

---

### 📥 Inputs & Data Sources
The worker must fetch trending developer topics across the following 6 sources:
1. **Google Trends API**: Trending search queries under 'Software & Technology'.
2. **Hacker News Firebase API** (`https://hacker-news.firebaseio.com/v0/topstories.json`): Stories with high score/comment velocity.
3. **GitHub Trending API**: Repositories trending daily in TypeScript, Rust, Go, Python, and Web development.
4. **Reddit Programming Subreddits** (`r/programming`, `r/webdev`, `r/node`, `r/reactjs`): Top posts in the last 24 hours.
5. **Product Hunt API**: Top daily dev tools and AI releases.
6. **Google Search Console (GSC) API**: Content gap and high-impression/low-CTR search query opportunities.

---

### ⚙️ Processing Logic & Trend Scoring
1. **Normalization & Deduplication**:
   - Normalize titles to lowercase keywords.
   - Fuzzy match title similarity (Jaccard similarity > 0.7) to merge duplicate topics across sources.
2. **Trend Score Algorithm (0–100)**:
   ```typescript
   TrendScore = (SourceWeight * VolumeScore) + (VelocityScore * 0.3) + (SearchVolumeModifier * 0.2)
   ```
   - Source Weights: GSC (1.0) > Google Trends (0.9) > Hacker News (0.85) > GitHub (0.8) > Product Hunt (0.75) > Reddit (0.7).
3. **Filtering**:
   - Filter out non-technical or general news items.
   - Retain top 5–20 highest-scoring topics daily.

---

### 📤 Output Data Payload
```json
{
  "id": "trend-cuid",
  "topic": "Gemini CLI & Vertex AI Integration",
  "description": "Google released native CLI tools for Vertex AI Gemini models.",
  "popularity": 125000,
  "source": "Google Trends + Hacker News",
  "category": "AI Tools",
  "trendScore": 96.4,
  "status": "NEW",
  "createdAt": "2026-08-01T06:00:00.000Z"
}
```

---

### 🚀 BullMQ Queue Integration
- **Input Queue**: Triggered by BullMQ Cron Scheduler (`0 6 * * *` - 6:00 AM daily) or `POST /api/webhooks/research`.
- **Output Queue**: Emits job payload to `planning_queue`:
  ```typescript
  await planningQueue.add("plan_blog", {
    trendId: trend.id,
    topic: trend.topic,
    category: trend.category,
    score: trend.trendScore,
  });
  ```

---

### 🛠️ Implementation Checklist
- [ ] Create `workers/research-worker/src/index.ts`
- [ ] Build source fetchers: `fetchGoogleTrends()`, `fetchHackerNews()`, `fetchGithubTrending()`, `fetchReddit()`, `fetchProductHunt()`, `fetchGscOpportunities()`
- [ ] Implement deduplication utility in `packages/ai` or `workers/research-worker/src/dedupe.ts`
- [ ] Save trend topics to PostgreSQL via Prisma `Trend` model (`TrendStatus: NEW`)
- [ ] Add Winston error logging and BullMQ retry backoff (3 attempts, exponential backoff)
