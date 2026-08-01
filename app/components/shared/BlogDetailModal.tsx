"use client";

import React, { useState } from "react";

export interface BlogItem {
  id?: string;
  title: string;
  slug: string;
  cat?: string;
  words?: string;
  trend?: string;
  quality?: string;
  cost?: string;
  status: string;
  updated?: string;
  sBg?: string;
  sFg?: string;
  sBd?: string;
  qBg?: string;
  qFg?: string;
}

interface BlogDetailModalProps {
  blog: BlogItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function BlogDetailModal({ blog, isOpen, onClose }: BlogDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"seo" | "quality" | "assets" | "timeline">("seo");

  if (!isOpen || !blog) return null;

  const sampleMarkdown = `# ${blog.title}

## Overview
As modern web development moves toward zero-bundle runtime strategies, Partial Prerendering (PPR) introduces a hybrid architecture combining static shell generation with streamed dynamic content holes.

### Key Architectural Benefits
- **Sub-10ms TTFB**: Served instantly from edge CDN cache.
- **Dynamic Streaming**: React 19 Suspense boundaries stream server components asynchronously.
- **Unified DX**: Single page file handles static and dynamic features seamlessly.

\`\`\`tsx
// app/page.tsx - Next.js 15 PPR Component
import { Suspense } from "react";
import { UserProfile } from "./components/UserProfile";

export const experimental_ppr = true;

export default function Page() {
  return (
    <main className="max-w-4xl mx-auto py-12">
      <h1 className="text-3xl font-bold">DevKit Market Dashboard</h1>
      <Suspense fallback={<ProfileSkeleton />}>
        <UserProfile />
      </Suspense>
    </main>
  );
}
\`\`\`

## Benchmarks & Performance Impact
| Metric | Standard SSR | Static SSG | PPR Hybrid |
| :--- | :--- | :--- | :--- |
| First Contentful Paint | 420ms | 110ms | 115ms |
| Time To Interactive | 850ms | 240ms | 260ms |
| Cache Hit Ratio | 12% | 99% | 98% |
`;

  const jsonLdSample = `{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "${blog.title}",
  "description": "Comprehensive guide on Next.js 15 Partial Prerendering architecture.",
  "author": {
    "@type": "Organization",
    "name": "DevKit Market AI"
  },
  "publisher": {
    "@type": "Organization",
    "name": "DevKit Market",
    "logo": "https://cdn.devkit.market/logo.png"
  }
}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.55)] backdrop-blur-[3px] flex items-center justify-center p-[26px] animate-dkfade"
      onClick={onClose}
    >
      <div
        className="w-[min(1180px,100%)] h-[min(760px,100%)] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-none flex items-center gap-[10px] p-[12px_14px] border-b border-[var(--bd)]">
          <span
            className="text-[10.5px] font-semibold p-[2.5px_8px] rounded-full border"
            style={{
              background: blog.sBg || "var(--card2)",
              color: blog.sFg || "var(--fg2)",
              borderColor: blog.sBd || "var(--bd)",
            }}
          >
            {blog.status}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis text-[var(--fg)]">
              {blog.title}
            </div>
            <div className="font-mono text-[10px] font-medium text-[var(--faint)]">
              {blog.slug} · {blog.words || "2,840"} words · {blog.cost || "$0.24"}
            </div>
          </div>
          <div className="ml-auto flex gap-[7px]">
            <button
              aria-label="Re-run quality QA"
              className="h-[28px] px-[11px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] transition-colors"
            >
              Re-run QA
            </button>
            <button
              aria-label="Publish article"
              className="h-[28px] px-[12px] rounded-[8px] border border-transparent bg-[var(--emerald)] text-white text-[11.5px] font-bold hover:bg-emerald-600 transition-colors"
            >
              Publish
            </button>
            <button
              aria-label="Close detail"
              onClick={onClose}
              className="w-[28px] h-[28px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] flex items-center justify-center hover:text-[var(--fg)] transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content Body Grid */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_400px]">
          {/* Left Pane - Markdown Source */}
          <div className="min-w-0 flex flex-col border-r border-[var(--bd)]">
            <div className="flex-none flex items-center gap-[6px] p-[8px_12px] border-b border-[var(--bd)] bg-[var(--card2)]">
              <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                Markdown Source
              </span>
              <span className="ml-auto font-mono text-[10px] text-[var(--faint)]">
                edited by writing_worker · 11:42 AM
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-[14px_16px] font-mono text-[12px] leading-[1.75] text-[var(--fg2)] whitespace-pre-wrap">
              {sampleMarkdown}
            </div>
          </div>

          {/* Right Pane - Inspection Details */}
          <div className="min-w-0 flex flex-col bg-[var(--card)]">
            {/* Inspector Tabs */}
            <div className="flex-none flex border-b border-[var(--bd)] overflow-x-auto">
              {[
                { key: "seo", label: "SEO & Meta" },
                { key: "quality", label: "Quality QA" },
                { key: "assets", label: "GCS Media" },
                { key: "timeline", label: "Worker History" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key as any)}
                  className={`flex-1 h-[36px] px-[8px] border-b-2 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    activeTab === t.key
                      ? "border-[var(--indigo)] text-[var(--indigo)] font-bold"
                      : "border-transparent text-[var(--mut)] hover:text-[var(--fg)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab Panels */}
            <div className="flex-1 overflow-y-auto p-[13px]">
              {activeTab === "seo" && (
                <div className="flex flex-col gap-[11px]">
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                      Meta Title <span className="text-[var(--emerald)] font-mono">58/60</span>
                    </div>
                    <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] text-[11.5px] leading-snug font-medium text-[var(--fg)]">
                      {blog.title}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                      Meta Description <span className="text-[var(--amber)] font-mono">148/160</span>
                    </div>
                    <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] text-[11.5px] leading-snug text-[var(--fg2)]">
                      Comprehensive guide on how PPR combines static shells with streamed dynamic holes in Next.js 15 applications.
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[6px]">
                      Target Keywords
                    </div>
                    <div className="flex gap-[6px] flex-wrap">
                      {["Next.js 15", "PPR", "React 19", "Streaming", "Zero-Bundle", "App Router"].map((kw, i) => (
                        <span key={i} className="text-[10.5px] font-semibold p-[3px_8px] rounded-[7px] bg-[var(--tint)] text-[var(--indigo)]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                      JSON-LD Schema
                    </div>
                    <pre className="border border-[var(--bd)] rounded-[8px] p-[9px_10px] bg-[var(--card2)] font-mono text-[10.5px] leading-relaxed text-[var(--fg2)] overflow-x-auto">
                      {jsonLdSample}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === "quality" && (
                <div className="flex flex-col gap-[10px]">
                  <div className="flex items-center gap-[12px] border border-[var(--bd)] rounded-[10px] p-[11px] bg-[var(--card2)]">
                    <div className="font-mono text-[26px] font-extrabold text-[var(--emerald)] tracking-tight">
                      {blog.quality || "94"}
                    </div>
                    <div>
                      <div className="text-[12px] font-bold text-[var(--fg)]">
                        Passed Quality Gate
                      </div>
                      <div className="text-[10.5px] text-[var(--mut)]">
                        Threshold ≥ 90 · 6 of 6 checks green
                      </div>
                    </div>
                  </div>

                  {[
                    { name: "SEO Optimization Score", value: "96/100", pct: "96%", color: "var(--emerald)" },
                    { name: "Flesch Reading Ease", value: "88/100", pct: "88%", color: "var(--emerald)" },
                    { name: "Grammar & Structure", value: "98/100", pct: "98%", color: "var(--emerald)" },
                    { name: "Plagiarism Check", value: "0% match", pct: "100%", color: "var(--emerald)" },
                    { name: "Fact & Code Verification", value: "Passed", pct: "100%", color: "var(--emerald)" },
                    { name: "Image Alt Text Presence", value: "100% complete", pct: "100%", color: "var(--emerald)" },
                  ].map((q, idx) => (
                    <div key={idx}>
                      <div className="flex justify-between text-[11.5px] mb-[4px]">
                        <span className="font-semibold text-[var(--fg2)]">{q.name}</span>
                        <span className="font-mono font-semibold text-[11px]" style={{ color: q.color }}>
                          {q.value}
                        </span>
                      </div>
                      <div className="h-[5px] rounded-[3px] bg-[var(--card2)] overflow-hidden">
                        <div className="h-full rounded-[3px]" style={{ width: q.pct, background: q.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "assets" && (
                <div className="flex flex-col gap-[12px]">
                  <div className="border border-[var(--bd)] rounded-[10px] overflow-hidden bg-[var(--card2)] p-[10px]">
                    <div className="h-[120px] bg-slate-800 rounded-[8px] flex items-center justify-center text-white font-mono text-[11px]">
                      Imagen 4 Hero WebP (1920×1080)
                    </div>
                    <div className="mt-[8px] flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-[var(--fg)]">hero.webp</span>
                      <span className="font-mono text-[var(--faint)]">342 KB</span>
                    </div>
                    <div className="text-[10px] text-[var(--mut)] mt-[2px] font-mono truncate">
                      gs://devkit-market-media/blogs/2026/08/hero.webp
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "timeline" && (
                <div className="flex flex-col gap-[8px] font-mono text-[11px]">
                  {[
                    { time: "11:40:02", worker: "research_worker", msg: "Topic approved: Next.js 15 PPR" },
                    { time: "11:40:14", worker: "planning_worker", msg: "Generated SEO metadata & outline" },
                    { time: "11:41:02", worker: "writing_worker", msg: "Created 2,840 words markdown body" },
                    { time: "11:41:45", worker: "image_worker", msg: "Imagen 4 generated hero.webp" },
                    { time: "11:42:10", worker: "quality_worker", msg: "QA Score 94/100 -> Passed" },
                  ].map((row, i) => (
                    <div key={i} className="p-[6px_8px] rounded-[6px] bg-[var(--card2)] border border-[var(--bd)] flex flex-col gap-[2px]">
                      <div className="flex items-center justify-between text-[10px] text-[var(--indigo)] font-bold">
                        <span>{row.worker}</span>
                        <span className="text-[var(--faint)]">{row.time}</span>
                      </div>
                      <div className="text-[var(--fg2)]">{row.msg}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
