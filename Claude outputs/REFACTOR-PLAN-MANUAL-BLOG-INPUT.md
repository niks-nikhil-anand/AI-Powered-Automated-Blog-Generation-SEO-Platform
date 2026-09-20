# Refactoring Plan: Remove Research + Add Manual Blog Input

**Objective:** Replace automated trend discovery with manual blog specifications. Users input JSON blog specs through UI → Workers auto-generate content.

**Scope Change:**
```
OLD FLOW:
Research → Planning → Outline → Writing → Image → Quality → Publish

NEW FLOW:
Manual Input (UI) → Planning → Outline → Writing → Image → Quality → Publish
```

---

## 1. DATABASE SCHEMA CHANGES

### Remove/Archive Tables
```prisma
// DELETE these from schema.prisma:
model Trend { ... }                    // Discovered topics
model ContentPlan { ... }              // Planning output (KEEP for now)
model ResearchRun { ... }             // Research audit trail
model ManualTopic { ... }             // Editorial topics pool

// KEEP these:
model ContentOutline { ... }          // Structure (still needed)
model Blog { ... }                    // Final article
model BlogSEO { ... }                 // SEO metadata
model QualityReport { ... }           // Quality scores
model Asset { ... }                   // Images
model WorkflowRun { ... }             // Execution tracking
model WorkerAttempt { ... }           // Audit trail
model AIUsage { ... }                 // Cost tracking
```

### Add New Table: `BlogInput`
```prisma
model BlogInput {
  id                String   @id @default(cuid())
  title             String   @unique
  slug              String   @unique
  
  // User-provided specifications
  specs             Json     // Raw JSON input
  
  // Parsed specs (denormalized for easier queries)
  keywords          String[] @default([])        // Primary keywords
  secondaryKeywords String[] @default([])        // LSI keywords
  audience          String?                      // Target audience
  searchIntent      String?                      // What problem does it solve?
  tone              String?  @default("professional") // professional, casual, technical
  contentLength     Int?     @default(2000)      // Target word count
  category          String?
  
  // Optional: Pre-defined outline
  outlineJson       Json?    // Pre-structured sections/bullets
  
  // SEO metadata
  metaTitle         String?
  metaDescription   String?
  focusKeyword      String?
  
  // Status
  status            String   @default("PENDING") // PENDING | PROCESSING | COMPLETED | FAILED
  
  // Link to generated blog
  blogId            String?
  blog              Blog?    @relation(fields: [blogId], references: [id])
  
  // Audit
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  processedAt       DateTime?
  
  // Tracking
  workflowRunId     String?
  workflowRun       WorkflowRun? @relation(fields: [workflowRunId], references: [id])
}
```

### Migration
```bash
npx prisma migrate dev --name add_blog_input_remove_trend
```

---

## 2. UI PAGE: MANUAL BLOG INPUT

### Location
Create: `app/dashboard/blogs/new/page.tsx`

### Component Layout
```
┌─────────────────────────────────────────────────────────────────┐
│  NEW BLOG SUBMISSION                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  BASIC INFO                                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Title: [________________] (Required, unique)             │   │
│  │ Slug: [_________________] (Auto-generated or custom)     │   │
│  │ Category: [dropdown: Tech, Business, Lifestyle, ...]     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  SEO & KEYWORDS                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Focus Keyword: [_____________]                           │   │
│  │ Primary Keywords: [_____________] + [_____________]      │   │
│  │ Secondary Keywords: [tags input]                         │   │
│  │ Meta Title: [_________________________________]          │   │
│  │ Meta Description: [_____________________________]         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  CONTENT SPECIFICATIONS                                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Target Audience: [________________]                      │   │
│  │ Search Intent: [________________]                        │   │
│  │ Tone: [Professional] [Casual] [Technical]                │   │
│  │ Target Length: [_______] words                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  OPTIONAL: PRE-STRUCTURED OUTLINE                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ [ ] Provide custom outline (JSON)                        │   │
│  │                                                           │   │
│  │ {                                                         │   │
│  │   "sections": [                                           │   │
│  │     {                                                     │   │
│  │       "heading": "What is X?",                            │   │
│  │       "intent": "Define the concept",                     │   │
│  │       "bullets": ["Point 1", "Point 2"]                  │   │
│  │     },                                                    │   │
│  │     ...                                                   │   │
│  │   ],                                                      │   │
│  │   "faqs": [                                               │   │
│  │     { "question": "Q1?", "answer": "A1" }                │   │
│  │   ]                                                       │   │
│  │ }                                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  [PREVIEW JSON]  [SUBMIT FOR PROCESSING]                         │
│                                                                   │
│  ┌─ RECENT SUBMISSIONS ──────────────────────────────────────┐  │
│  │ Title          │ Status    │ Created      │ Actions      │  │
│  │ How to React?  │ COMPLETED │ Sep 17 10am  │ [View Blog]  │  │
│  │ Python Tips    │ PROCESSING│ Sep 17 9:45am│ [View Log]   │  │
│  │ AI Trends      │ PENDING   │ Sep 17 8:30am│ [Cancel]     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Form Schema (TypeScript)
```typescript
// app/dashboard/blogs/new/types.ts
import { z } from "zod";

export const blogInputSchema = z.object({
  title: z.string().min(10).max(200),
  slug: z.string().min(3).max(100).optional(),
  category: z.string().optional(),
  
  // SEO
  focusKeyword: z.string().optional(),
  primaryKeywords: z.array(z.string()).default([]),
  secondaryKeywords: z.array(z.string()).default([]),
  metaTitle: z.string().max(60).optional(),
  metaDescription: z.string().max(160).optional(),
  
  // Content specs
  audience: z.string().optional(),
  searchIntent: z.string().optional(),
  tone: z.enum(["professional", "casual", "technical"]).default("professional"),
  contentLength: z.number().min(500).max(5000).default(2000),
  
  // Optional: Custom outline
  outlineJson: z.record(z.any()).optional(),
});

export type BlogInputFormData = z.infer<typeof blogInputSchema>;
```

### React Component
```typescript
// app/dashboard/blogs/new/page.tsx
"use client";

import { useState } from "react";
import { blogInputSchema, type BlogInputFormData } from "./types";
import { submitBlogInput } from "./actions";

export default function NewBlogPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOutlineInput, setShowOutlineInput] = useState(false);
  const [formData, setFormData] = useState<Partial<BlogInputFormData>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const validated = blogInputSchema.parse(formData);
      const result = await submitBlogInput(validated);
      
      // Success: redirect to blog or show confirmation
      if (result.success) {
        // Redirect to /dashboard/blogs/{blogInputId}
        window.location.href = `/dashboard/blogs/input/${result.id}`;
      } else {
        setError(result.error);
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Submit Blog Specification</h1>
      
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* BASIC INFO */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Basic Info</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium">Title *</label>
              <input
                type="text"
                required
                placeholder="e.g., How to Master React Hooks"
                value={formData.title || ""}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">Slug</label>
              <input
                type="text"
                placeholder="auto-generated from title"
                value={formData.slug || ""}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">Category</label>
              <select
                value={formData.category || ""}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              >
                <option value="">Select category</option>
                <option value="tech">Technology</option>
                <option value="business">Business</option>
                <option value="lifestyle">Lifestyle</option>
                <option value="education">Education</option>
              </select>
            </div>
          </div>
        </section>

        {/* SEO & KEYWORDS */}
        <section>
          <h2 className="text-xl font-semibold mb-4">SEO & Keywords</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium">Focus Keyword</label>
              <input
                type="text"
                placeholder="Main keyword to target"
                value={formData.focusKeyword || ""}
                onChange={(e) => setFormData({ ...formData, focusKeyword: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">Primary Keywords (comma-separated)</label>
              <input
                type="text"
                placeholder="keyword1, keyword2, keyword3"
                onChange={(e) => 
                  setFormData({
                    ...formData,
                    primaryKeywords: e.target.value.split(",").map(k => k.trim())
                  })
                }
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">Meta Title (60 chars max)</label>
              <input
                type="text"
                maxLength={60}
                value={formData.metaTitle || ""}
                onChange={(e) => setFormData({ ...formData, metaTitle: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.metaTitle?.length || 0}/60
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium">Meta Description (160 chars max)</label>
              <textarea
                maxLength={160}
                rows={2}
                value={formData.metaDescription || ""}
                onChange={(e) => setFormData({ ...formData, metaDescription: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.metaDescription?.length || 0}/160
              </p>
            </div>
          </div>
        </section>

        {/* CONTENT SPECIFICATIONS */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Content Specifications</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium">Target Audience</label>
              <input
                type="text"
                placeholder="e.g., Junior developers, CTOs, engineering managers"
                value={formData.audience || ""}
                onChange={(e) => setFormData({ ...formData, audience: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">Search Intent</label>
              <textarea
                rows={3}
                placeholder="What problem does this solve? What should readers learn?"
                value={formData.searchIntent || ""}
                onChange={(e) => setFormData({ ...formData, searchIntent: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">Tone</label>
              <div className="flex gap-4 mt-2">
                {["professional", "casual", "technical"].map((tone) => (
                  <label key={tone} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="tone"
                      value={tone}
                      checked={formData.tone === tone}
                      onChange={(e) => setFormData({ ...formData, tone: e.target.value as any })}
                    />
                    {tone.charAt(0).toUpperCase() + tone.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium">Target Word Count</label>
              <input
                type="number"
                min={500}
                max={5000}
                step={100}
                value={formData.contentLength || 2000}
                onChange={(e) => setFormData({ ...formData, contentLength: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded"
              />
              <p className="text-xs text-gray-500 mt-1">Recommended: 1500-2500 words</p>
            </div>
          </div>
        </section>

        {/* OPTIONAL OUTLINE */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              checked={showOutlineInput}
              onChange={(e) => setShowOutlineInput(e.target.checked)}
              className="w-4 h-4"
            />
            <label className="text-sm font-medium">Provide custom outline (optional)</label>
          </div>

          {showOutlineInput && (
            <div>
              <label className="block text-sm font-medium mb-2">Outline JSON</label>
              <textarea
                rows={10}
                placeholder={`{
  "sections": [
    {
      "heading": "Introduction",
      "intent": "Hook the reader",
      "bullets": ["Point 1", "Point 2"]
    }
  ],
  "faqs": [
    {"question": "Q1?", "answer": "A1"}
  ]
}`}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setFormData({ ...formData, outlineJson: parsed });
                  } catch (err) {
                    // Keep raw value, show error on submit
                  }
                }}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Optional JSON to guide blog structure</p>
            </div>
          )}
        </section>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded text-red-800">
            {error}
          </div>
        )}

        {/* SUBMIT */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => {
              console.log(JSON.stringify(formData, null, 2));
            }}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Preview JSON
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? "Submitting..." : "Submit for Processing"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

---

## 3. API ENDPOINT: ACCEPT BLOG INPUT

### Route: `app/api/blogs/input/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { blogInputSchema } from "@/app/dashboard/blogs/new/types";
import { enqueueWritingJob } from "@/workers/shared/queues";

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    
    // Validate input
    const validated = blogInputSchema.parse(data);
    
    // Check for duplicate title
    const existing = await prisma.blogInput.findUnique({
      where: { title: validated.title }
    });
    
    if (existing) {
      return NextResponse.json(
        { error: "A blog with this title already exists" },
        { status: 409 }
      );
    }
    
    // Auto-generate slug if not provided
    const slug = validated.slug || 
      validated.title
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
    
    // Create BlogInput record
    const blogInput = await prisma.blogInput.create({
      data: {
        title: validated.title,
        slug,
        category: validated.category,
        keywords: validated.primaryKeywords,
        secondaryKeywords: validated.secondaryKeywords,
        audience: validated.audience,
        searchIntent: validated.searchIntent,
        tone: validated.tone,
        contentLength: validated.contentLength,
        metaTitle: validated.metaTitle,
        metaDescription: validated.metaDescription,
        outlineJson: validated.outlineJson,
        specs: validated // Store full spec as JSON
      }
    });
    
    // Create WorkflowRun for tracking
    const workflowRun = await prisma.workflowRun.create({
      data: {
        status: "QUEUED",
        currentStage: "WRITING", // Skip straight to writing
        input: {
          blogInputId: blogInput.id,
          ...validated
        }
      }
    });
    
    // Update BlogInput with workflowRunId
    await prisma.blogInput.update({
      where: { id: blogInput.id },
      data: { workflowRunId: workflowRun.id }
    });
    
    // Enqueue writing job
    // (Skip planning & outline, go straight to writing)
    await enqueueWritingJob({
      blogInputId: blogInput.id,
      title: validated.title,
      specs: validated,
      workflowRunId: workflowRun.id
    });
    
    return NextResponse.json({
      success: true,
      id: blogInput.id,
      message: "Blog queued for processing"
    });
    
  } catch (error) {
    console.error("Blog input error:", error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: "Failed to process blog input" },
      { status: 500 }
    );
  }
}

// GET: List recent blog inputs
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status");
  
  const where = status ? { status } : {};
  
  const blogInputs = await prisma.blogInput.findMany({
    where,
    take: 50,
    orderBy: { createdAt: "desc" },
    include: { blog: true, workflowRun: true }
  });
  
  return NextResponse.json(blogInputs);
}
```

---

## 4. WORKER MODIFICATIONS

### A. Remove Research Worker
```bash
# Delete the entire directory
rm -rf workers/research-worker/

# Remove from package.json scripts
# "worker:research": "tsx workers/research-worker/index.ts"
# "worker:research:once": "tsx workers/research-worker/trigger-once.ts"
```

### B. Modify Writing Worker to Accept BlogInput
```typescript
// workers/writing-worker/index.ts

import { WritingJobPayload } from "@/workers/shared/queues";
import { prisma } from "@/lib/db";

export async function processWritingJob(job: WritingJobPayload) {
  try {
    // NEW: Accept either outlineId (old flow) or blogInputId (new flow)
    let specs;
    let workflowRunId = job.workflowRunId;
    
    if (job.blogInputId) {
      // NEW FLOW: User provided specs directly
      const blogInput = await prisma.blogInput.findUnique({
        where: { id: job.blogInputId }
      });
      
      if (!blogInput) {
        throw new Error(`BlogInput ${job.blogInputId} not found`);
      }
      
      specs = blogInput.specs;
      workflowRunId = blogInput.workflowRunId || workflowRunId;
    } else {
      // OLD FLOW: Content from outline (still supported)
      const outline = await prisma.contentOutline.findUnique({
        where: { id: job.outlineId }
      });
      
      specs = {
        title: outline.title,
        audience: outline.metaDescription,
        contentLength: 2000,
        tone: "professional",
        // ... map other fields
      };
    }
    
    // Generate blog using specs
    const blog = await generateBlogFromSpecs(specs);
    
    // Persist blog
    await persistBlog(blog, specs, workflowRunId);
    
    // Dispatch to image queue
    await enqueueImageJob({
      blogId: blog.id,
      title: blog.title,
      category: blog.category
    });
    
    // Update status
    await updateBlogInputStatus(job.blogInputId, "PROCESSING");
    
  } catch (error) {
    logger.error("Writing job failed", { jobId: job.id, error });
    if (job.blogInputId) {
      await updateBlogInputStatus(job.blogInputId, "FAILED", error.message);
    }
    throw error;
  }
}

async function generateBlogFromSpecs(specs) {
  // Use Vertex AI to generate blog from specs
  const prompt = `
    Generate a comprehensive blog article with these specs:
    - Title: ${specs.title}
    - Audience: ${specs.audience}
    - Search Intent: ${specs.searchIntent}
    - Tone: ${specs.tone}
    - Target Length: ${specs.contentLength} words
    - Keywords: ${specs.primaryKeywords?.join(", ")}
    ${specs.outlineJson ? `- Outline: ${JSON.stringify(specs.outlineJson)}` : ""}
    
    Return ONLY valid markdown, no frontmatter or code blocks.
  `;
  
  const response = await vertex.generateContent(prompt);
  return response.text();
}

async function updateBlogInputStatus(id: string, status: string, error?: string) {
  await prisma.blogInput.update({
    where: { id },
    data: {
      status,
      processedAt: status === "COMPLETED" ? new Date() : undefined
    }
  });
}
```

### C. Update Queue Types
```typescript
// workers/shared/queues.ts

export type WritingJobPayload = {
  id: string;
  workflowRunId?: string;
  
  // OLD: Outline-based (still supported)
  outlineId?: string;
  
  // NEW: Direct specs
  blogInputId?: string;
  title?: string;
  specs?: any;
};
```

---

## 5. DASHBOARD UPDATES

### Remove Pages
```bash
# Delete research and topics pool pages
rm -rf app/dashboard/research/
rm -rf app/dashboard/topics/
```

### Update Dashboard Navigation
```typescript
// app/dashboard/layout.tsx

const navigationItems = [
  { label: "Dashboard", href: "/dashboard" },
  // { label: "Research", href: "/dashboard/research" },  // REMOVE
  // { label: "Topics Pool", href: "/dashboard/topics" }, // REMOVE
  { label: "New Blog", href: "/dashboard/blogs/new" },     // ADD
  { label: "Blogs", href: "/dashboard/blogs" },
  { label: "Quality", href: "/dashboard/quality" },
  { label: "Workers", href: "/dashboard/workers" },
  { label: "Settings", href: "/dashboard/settings" }
];
```

### Update Main Dashboard
```typescript
// app/dashboard/page.tsx - Remove research metrics

// OLD metrics to remove:
// - Research queue count
// - Signals collected
// - Trends promoted

// NEW metrics to add:
// - Blog inputs pending
// - Blog inputs processing
// - Blog inputs completed today
```

---

## 6. MIGRATION SCRIPT

```typescript
// scripts/migrate-to-manual-input.ts

import { prisma } from "@/lib/db";

async function migrate() {
  console.log("Starting migration to manual blog input...");
  
  // 1. Archive existing research data
  console.log("Archiving research data...");
  await prisma.trend.deleteMany({});
  await prisma.contentPlan.deleteMany({});
  await prisma.manualTopic.deleteMany({});
  await prisma.researchRun.deleteMany({});
  
  // 2. Verify BlogInput table exists
  console.log("Checking BlogInput table...");
  try {
    await prisma.blogInput.findMany({ take: 1 });
    console.log("✓ BlogInput table ready");
  } catch (error) {
    console.error("✗ BlogInput table missing. Run: npx prisma migrate dev");
    process.exit(1);
  }
  
  // 3. Delete research worker processes (if any are stored)
  await prisma.workerAttempt.deleteMany({
    where: { worker: "research" }
  });
  
  console.log("✓ Migration complete");
  console.log("\nNext steps:");
  console.log("1. Remove Research Worker: rm -rf workers/research-worker/");
  console.log("2. Update package.json scripts");
  console.log("3. Restart workers: npm run worker:dev");
}

migrate().catch(console.error);
```

Run:
```bash
npm run tsx scripts/migrate-to-manual-input.ts
```

---

## 7. EXAMPLE JSON INPUT

Users can paste this JSON format:

```json
{
  "title": "How to Master React Hooks: A Complete Guide",
  "slug": "react-hooks-guide",
  "category": "tech",
  "focusKeyword": "React hooks",
  "primaryKeywords": ["React hooks", "useEffect", "useState", "custom hooks"],
  "secondaryKeywords": ["React development", "JavaScript patterns", "state management"],
  "metaTitle": "React Hooks Mastery: Complete 2024 Guide for Developers",
  "metaDescription": "Learn React hooks from basics to advanced patterns. Includes useState, useEffect, custom hooks, and best practices.",
  "audience": "Junior to mid-level React developers",
  "searchIntent": "Users want to understand React hooks deeply with practical examples and best practices",
  "tone": "technical",
  "contentLength": 2500,
  "outlineJson": {
    "sections": [
      {
        "heading": "What are React Hooks?",
        "intent": "Define hooks and why they matter",
        "bullets": [
          "Introduced in React 16.8",
          "Allow functional components to use state",
          "Simplify component logic"
        ]
      },
      {
        "heading": "useState Hook Explained",
        "intent": "Deep dive into useState",
        "bullets": [
          "Basic syntax and usage",
          "Multiple state variables",
          "Common pitfalls"
        ]
      },
      {
        "heading": "useEffect Hook Deep Dive",
        "intent": "Master side effects in React",
        "bullets": [
          "Running effects after render",
          "Dependency arrays",
          "Cleanup functions",
          "Common patterns"
        ]
      },
      {
        "heading": "Building Custom Hooks",
        "intent": "Create reusable hook logic",
        "bullets": [
          "Hook naming conventions",
          "Sharing logic between components",
          "Real-world examples"
        ]
      },
      {
        "heading": "Best Practices & Tips",
        "intent": "Avoid common mistakes",
        "bullets": [
          "Follow rules of hooks",
          "Performance optimization",
          "Testing hooks"
        ]
      }
    ],
    "faqs": [
      {
        "question": "Can I use hooks in class components?",
        "answer": "No, hooks are designed for functional components only."
      },
      {
        "question": "What's the difference between useState and useReducer?",
        "answer": "useState is simpler for single state values. useReducer is better for complex state logic with multiple related values."
      },
      {
        "question": "Why is dependency array important in useEffect?",
        "answer": "It controls when the effect runs. Omitting it runs every render (memory leaks). Empty array runs once. Specific deps run when they change."
      }
    ]
  }
}
```

---

## 8. IMPLEMENTATION TIMELINE

```
PHASE 1: DATABASE & API (Day 1-2)
├─ Add BlogInput table to Prisma schema
├─ Create database migration
├─ Create POST /api/blogs/input endpoint
└─ Add Blog Input API validation

PHASE 2: UI (Day 2-3)
├─ Create /app/dashboard/blogs/new page
├─ Implement form with all fields
├─ Add JSON preview
├─ List recent inputs

PHASE 3: WORKER UPDATES (Day 3-4)
├─ Modify writing-worker to accept BlogInput
├─ Update queue types
├─ Test with sample input
└─ Remove research-worker code

PHASE 4: CLEANUP (Day 4-5)
├─ Remove research/topics pages from dashboard
├─ Update navigation
├─ Run migration script
├─ Delete research worker directory
├─ Update package.json

PHASE 5: TESTING & DOCS (Day 5-6)
├─ Test end-to-end flow
├─ Document JSON input format
├─ Create runbook for users
└─ Deploy
```

---

## 9. NEW WORKFLOW DIAGRAM

```
USER INPUT FLOW:
┌──────────────────────────────────────────────────────────┐
│ Dashboard: /dashboard/blogs/new                          │
│ - Fill form with blog specs                              │
│ - (Optional) Provide JSON outline                        │
│ - Submit                                                 │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼ POST /api/blogs/input
            ┌─────────────────┐
            │ Validate specs  │
            │ Create BlogInput│
            └────────┬────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ BlogInput created (PENDING)│
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Enqueue WritingJob         │
        │ (with blogInputId)         │
        └────────────┬───────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
    ┌──────────────┐      ┌──────────────┐
    │ Writing      │      │ Update status│
    │ Worker       │      │ → PROCESSING │
    │ (generates   │      └──────────────┘
    │  blog from   │
    │  specs)      │
    └──────┬───────┘
           │
           ▼
    ┌──────────────────┐
    │ Image Worker     │
    │ (generate image) │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ Quality Worker   │
    │ (validate)       │
    └────────┬─────────┘
             │
        ┌────┴────┐
        │          │
    ✅ PASS   ❌ FAIL
        │          │
        ▼          ▼
    PUBLISH    MARK FAILED
        │          │
        ▼          ▼
    Update status: COMPLETED
    
    Notify user → View blog
```

---

## 10. QUICK START COMMANDS

```bash
# 1. Add new schema
npx prisma migrate dev --name add_blog_input_remove_research

# 2. Create new files
touch app/dashboard/blogs/new/page.tsx
touch app/dashboard/blogs/new/types.ts
touch app/dashboard/blogs/new/actions.ts

# 3. Update workers
# Modify workers/writing-worker/index.ts
# Update workers/shared/queues.ts

# 4. Remove research
rm -rf workers/research-worker/

# 5. Update package.json
# Remove: "worker:research" scripts
# Keep: "worker:planning", "worker:outline", "worker:writing", etc.

# 6. Test
npm run worker:dev
# Navigate to http://localhost:3000/dashboard/blogs/new
# Fill form and submit
```

---

## 11. ROLLBACK PLAN

If something goes wrong:

```bash
# Undo Prisma migration
npx prisma migrate resolve --rolled-back add_blog_input_remove_research

# Or reset to previous schema
npx prisma migrate deploy
```

---

## 12. SUCCESS CRITERIA

- [ ] BlogInput table created and migrated
- [ ] Form UI accessible at `/dashboard/blogs/new`
- [ ] Form submission creates BlogInput + WorkflowRun + enqueues WritingJob
- [ ] Writing worker accepts BlogInput and generates blog
- [ ] Recent inputs listed on dashboard
- [ ] Research worker completely removed
- [ ] Manual topics pool removed
- [ ] All workers still functioning
- [ ] E2E flow: Input → Blog → Image → Quality → Published ✅

---

**Estimated effort:** 3-5 days  
**Risk level:** Medium (removes research, but keeps proven writing/image/quality pipeline)  
**Rollback:** Possible via Prisma migration rollback