# DevKit Market - AI Daily Blog Generator

### Enterprise Architecture & Implementation Plan

## Goal

Build a fully automated AI-powered content generation pipeline that publishes **1-20 SEO optimized technology blogs daily** on DevKit Market.

The entire workflow should require **zero manual intervention**, while still supporting manual approval if needed.

---

# Technology Stack

| Layer            | Technology                                |
| ---------------- | ----------------------------------------- |
| Frontend         | Next.js 15                                |
| Backend          | Next.js API Routes / Route Handlers       |
| ORM              | Prisma                                    |
| Database         | PostgreSQL                                |
| Queue            | BullMQ + Redis                            |
| AI               | Google Vertex AI (Gemini 2.5 Pro / Flash) |
| Image Generation | Vertex Imagen                             |
| Image Storage    | Google Cloud Storage                      |
| Scheduler        | BullMQ Cron Worker                        |
| Container        | Docker                                    |
| Deployment       | Cloud Run / ECS / Kubernetes              |
| Monitoring       | OpenTelemetry + Grafana                   |
| Logging          | Winston + Google Cloud Logging            |
| Search           | Google Trends API + News API              |
| SEO              | Automatic JSON-LD + Sitemap               |

---

# High Level Architecture

```text
                 Scheduler (Daily)

                        │
                        ▼

           Research Trending Topics Worker

                        │

                        ▼

              Blog Planning Worker

      (Title + Keywords + Category)

                        │

                        ▼

             Blog Outline Worker

                        │

                        ▼

              Blog Writing Worker

                        │

                        ▼

             Image Generation Worker

                        │

                        ▼

          Upload Image to Google Storage

                        │

                        ▼

             SEO / QA Analysis Worker

                        │

          Pass / Fail Decision

                        │

         ┌──────────────┴──────────────┐

         │                             │

      Publish                     Retry

         │

         ▼

     DevKit Market CMS

         │

         ▼

     Search Engine Index
```

---

# Queue Architecture

```
research_queue

↓

planning_queue

↓

outline_queue

↓

writing_queue

↓

image_queue

↓

quality_queue

↓

publish_queue
```

Every queue should be independent.

Workers communicate only through BullMQ.

---

# Folder Structure

```
apps/

   web/
      app/
      components/

packages/

   ai/
   database/
   queue/
   storage/
   seo/
   logger/

workers/

   research-worker

   planning-worker

   outline-worker

   writing-worker

   image-worker

   quality-worker

   publish-worker

docker/

prisma/

scripts/

```

---

# Complete Flow

---

## Worker 1

## Research Worker

Runs every morning.

Responsibilities

* Fetch Google Trends
* Fetch Hacker News
* Fetch GitHub Trending
* Fetch Reddit Programming
* Fetch Product Hunt
* Fetch Google Search Console Opportunities
* Remove duplicates
* Calculate Trend Score

Output

```
Topic

Description

Popularity

Source

Category

Trend Score
```

Example

```
Gemini CLI

Trend Score 96

Category

AI Tools
```

---

# Worker 2

## Blog Planning Worker

Uses Vertex AI

Input

Trending Topic

Output

```
SEO Blog Title

Slug

Primary Keyword

Secondary Keywords

Long Tail Keywords

Search Intent

Target Audience

Meta Title

Meta Description

Reading Time

Category

Tags

```

---

# Worker 3

## Outline Generator

Vertex AI

Produces

```
Introduction

H2

H2

H2

H2

FAQ

Summary

CTA
```

---

# Worker 4

## Blog Writer

Uses Gemini 2.5 Pro

Creates

2500-4000 words

Includes

* examples
* code snippets
* tables
* comparison
* best practices
* FAQs
* conclusion

Automatically generates

```
Markdown

HTML

JSON blocks
```

---

# Worker 5

## Image Generator

Vertex Imagen

Generate

```
Hero Image

Social Image

Twitter Banner

OG Image

Thumbnail

```

After generation

Upload

```
Google Cloud Storage

blogs/

2026/

08/

blog-name/

hero.webp

thumbnail.webp

og.webp
```

Return

```
Public URL

Width

Height

Alt Text
```

---

# Worker 6

## Quality Analysis

Gemini

Checks

Grammar

SEO

Readability

Plagiarism

AI hallucination

Fact checking

Broken markdown

Accessibility

Image Alt

Internal Links

External Links

Keyword Density

Heading Structure

Duplicate Content

Returns

```
SEO Score

Readability

Grammar

Quality Score

Pass / Retry
```

---

# Worker 7

## Publisher

If score >90

Automatically

* Save to Database
* Publish
* Generate Sitemap
* Ping Google
* Generate RSS

---

# Prisma Models

## Blog

```prisma
model Blog {
  id                String   @id @default(cuid())

  title             String
  slug              String   @unique

  excerpt           String?

  content           String

  html              String

  categoryId        String?

  category          Category? @relation(fields:[categoryId],references:[id])

  status            BlogStatus

  featuredImageId   String?

  featuredImage     Asset? @relation(fields:[featuredImageId],references:[id])

  seo               BlogSEO?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

---

## Blog SEO

```prisma
model BlogSEO {

 id String @id @default(cuid())

 blogId String @unique

 blog Blog @relation(fields:[blogId],references:[id])

 metaTitle String

 metaDescription String

 canonical String?

 keywords Json

 schema Json

 score Int

}
```

---

## Asset

```prisma
model Asset {

 id String @id @default(cuid())

 fileName String

 bucket String

 path String

 publicUrl String

 mimeType String

 width Int?

 height Int?

 size Int

 createdAt DateTime @default(now())

}
```

---

## Trend

```prisma
model Trend {

 id String @id @default(cuid())

 topic String

 source String

 category String

 score Float

 status TrendStatus

 createdAt DateTime @default(now())

}
```

---

## Queue Job

```prisma
model Job {

 id String @id @default(cuid())

 queue String

 status JobStatus

 attempts Int

 payload Json

 result Json?

 error String?

 createdAt DateTime @default(now())

}
```

---

## AI Usage

```prisma
model AIUsage {

 id String @id @default(cuid())

 worker String

 model String

 promptTokens Int

 completionTokens Int

 cost Float

 latency Int

 createdAt DateTime @default(now())

}
```

---

# Google Cloud Storage

Bucket Structure

```
devkit-market/

blogs/

2026/

08/

01/

hero.webp

thumbnail.webp

og.webp

inline/

code/

assets/

authors/

```

Lifecycle

```
Raw Images

↓

Optimize

↓

WebP

↓

CDN Cache

↓

Public URL
```

---

# Vertex AI Models

| Task                                | Model              |
| ----------------------------------- | ------------------ |
| Research                            | Gemini 2.5 Flash   |
| Planning                            | Gemini 2.5 Flash   |
| Outline                             | Gemini 2.5 Pro     |
| Writing                             | Gemini 2.5 Pro     |
| QA                                  | Gemini 2.5 Pro     |
| Image                               | Imagen 4           |
| Embeddings (future semantic search) | text-embedding-005 |

---

# Docker Containers

```
next-app

postgres

redis

research-worker

planning-worker

outline-worker

writing-worker

image-worker

quality-worker

publish-worker

nginx
```

Each worker scales independently.

---

# Environment Variables

```env
DATABASE_URL=

REDIS_URL=

GOOGLE_CLOUD_PROJECT=

GOOGLE_APPLICATION_CREDENTIALS=

VERTEX_LOCATION=us-central1

VERTEX_MODEL=gemini-2.5-pro

VERTEX_FLASH=gemini-2.5-flash

VERTEX_IMAGE_MODEL=imagen-4

GCS_BUCKET=devkit-market

NEXT_PUBLIC_CDN=
```

---

# API Routes

```
POST /api/blogs/generate

POST /api/blogs/publish

GET /api/blogs

GET /api/blog/:slug

POST /api/webhooks/research

POST /api/webhooks/publish
```

---

# Dashboard

Provide an admin dashboard to monitor the pipeline in real time:

* Queue health (waiting, active, failed, completed)
* AI token usage and estimated cost by worker
* Daily blog generation count
* Trend discovery history and selected topics
* Quality scores with pass/fail reasons
* Image generation previews
* Publishing status and retry controls
* Google Cloud Storage asset browser
* Search Console indexing status
* SEO analytics and organic traffic trends
* Worker logs and error traces
* Manual approval/editing before publish (optional)

---

# Phase-wise Implementation Roadmap

### Phase 1 – Foundation (Week 1)

* Initialize Next.js 15 monorepo
* Configure Prisma + PostgreSQL
* Set up Docker Compose (Next.js, PostgreSQL, Redis)
* Integrate BullMQ
* Configure Google Cloud Storage
* Configure Vertex AI authentication
* Build authentication and admin dashboard shell

### Phase 2 – Content Generation Pipeline (Week 2)

* Implement Research Worker with multiple trend sources
* Build Planning Worker (SEO metadata)
* Build Outline Worker
* Build Writing Worker with Markdown/HTML generation
* Add prompt versioning and AI usage tracking

### Phase 3 – Media & QA (Week 3)

* Integrate Imagen 4 for hero images
* Upload and optimize assets in Google Cloud Storage
* Implement Quality Analysis Worker
* Add automatic retry logic for failed quality checks

### Phase 4 – Publishing & SEO (Week 4)

* Publish blogs to DevKit Market
* Generate JSON-LD structured data
* Update XML sitemap and RSS feed
* Submit URLs for indexing
* Add analytics, monitoring, alerts, and production deployment

---

## Future Enhancements

* Multi-language blog generation
* Human approval workflow with version history
* Auto-generation of LinkedIn, X, Facebook, and Instagram posts
* Newsletter generation from published blogs
* AI-powered internal linking between related articles
* Retrieval-Augmented Generation (RAG) using previous DevKit Market content
* Automatic YouTube script and narration generation
* AI avatar video creation from blog posts
* Semantic search using Vertex AI embeddings and a vector database
* A/B testing for titles, meta descriptions, and featured images

This architecture is modular, horizontally scalable, cloud-native, and designed to support thousands of blog-generation jobs per day by scaling individual BullMQ workers independently while keeping AI, storage, publishing, and monitoring concerns cleanly separated.
