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
  content?: string;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
  schema?: string;
  createdAt?: string;
  updatedAt?: string;
  createdAtLabel?: string;
  updatedAtLabel?: string;
}

interface BlogDetailModalProps {
  blog: BlogItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function BlogDetailModal({ blog, isOpen, onClose }: BlogDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "seo" | "quality" | "assets" | "timeline">("overview");
  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "seo", label: "SEO & Meta" },
    { key: "quality", label: "Quality QA" },
    { key: "assets", label: "GCS Media" },
    { key: "timeline", label: "Worker History" },
  ];

  if (!isOpen || !blog) return null;

  const markdownBody = blog.content ?? "";
  const targetKeywords: string[] = blog.keywords ?? [];
  const numericQuality = Number(blog.quality ?? 0);
  const qualityChecks: {
    name: string;
    value: string;
    pct: string;
    color: string;
  }[] = numericQuality > 0 ? [
    {
      name: "SEO Quality Score",
      value: `${numericQuality}/100`,
      pct: `${Math.min(100, Math.max(0, numericQuality))}%`,
      color: numericQuality >= 90 ? "var(--emerald)" : "var(--amber)",
    },
    {
      name: "Word Count",
      value: `${blog.words || "0"} words`,
      pct: "100%",
      color: "var(--indigo)",
    },
  ] : [];
  const mediaAssets: {
    label: string;
    name: string;
    size: string;
    path: string;
  }[] = [];
  const timeline: {
    time: string;
    worker: string;
    msg: string;
  }[] = [
    ...(blog.createdAtLabel
      ? [{ time: blog.createdAtLabel, worker: "system", msg: "Blog record created" }]
      : []),
    ...(blog.updatedAtLabel
      ? [{ time: blog.updatedAtLabel, worker: "system", msg: "Blog record last updated" }]
      : []),
  ];

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
              {blog.slug} · {blog.words || "0"} words · {blog.cost || "$0.00"}
            </div>
            <div className="font-mono text-[10px] font-medium text-[var(--faint)] mt-[2px]">
              Created {blog.createdAtLabel || "-"} · Updated {blog.updatedAtLabel || blog.updated || "-"}
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
                No source generated yet
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-[14px_16px] font-mono text-[12px] leading-[1.75] text-[var(--fg2)] whitespace-pre-wrap">
              {markdownBody || "No markdown source yet."}
            </div>
          </div>

          {/* Right Pane - Inspection Details */}
          <div className="min-w-0 flex flex-col bg-[var(--card)]">
            {/* Inspector Tabs */}
            <div className="flex-none flex border-b border-[var(--bd)] overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
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
              {activeTab === "overview" && (
                <div className="flex flex-col gap-[11px]">
                  <div className="grid grid-cols-2 gap-[8px]">
                    {[
                      { label: "Blog ID", value: blog.id || "-" },
                      { label: "Status", value: blog.status },
                      { label: "Category", value: blog.cat || "General" },
                      { label: "Words", value: blog.words || "0" },
                      { label: "Quality", value: blog.quality || "0" },
                      { label: "Cost", value: blog.cost || "$0.00" },
                    ].map((item) => (
                      <div key={item.label} className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] min-w-0">
                        <div className="text-[10px] font-semibold text-[var(--mut)]">{item.label}</div>
                        <div className="font-mono text-[11px] text-[var(--fg2)] mt-[2px] truncate">{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)]">
                    <div className="text-[10px] font-semibold text-[var(--mut)]">Slug</div>
                    <div className="font-mono text-[11px] text-[var(--fg2)] mt-[2px] break-all">{blog.slug}</div>
                  </div>
                  <div className="grid grid-cols-1 gap-[8px]">
                    <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)]">
                      <div className="text-[10px] font-semibold text-[var(--mut)]">Created</div>
                      <div className="font-mono text-[11px] text-[var(--fg2)] mt-[2px]">{blog.createdAtLabel || "-"}</div>
                    </div>
                    <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)]">
                      <div className="text-[10px] font-semibold text-[var(--mut)]">Updated</div>
                      <div className="font-mono text-[11px] text-[var(--fg2)] mt-[2px]">{blog.updatedAtLabel || blog.updated || "-"}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                      Article Title
                    </div>
                    <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] text-[11.5px] leading-snug font-medium text-[var(--fg)]">
                      {blog.title}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "seo" && (
                <div className="flex flex-col gap-[11px]">
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                      Meta Title
                    </div>
                    <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] text-[11.5px] leading-snug font-medium text-[var(--fg)]">
                      {blog.metaTitle || blog.title}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                      Meta Description
                    </div>
                    <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] text-[11.5px] leading-snug text-[var(--fg2)]">
                      {blog.metaDescription || "No meta description generated yet."}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[6px]">
                      Target Keywords
                    </div>
                    <div className="flex gap-[6px] flex-wrap">
                      {targetKeywords.length > 0 ? targetKeywords.map((kw, i) => (
                        <span key={i} className="text-[10.5px] font-semibold p-[3px_8px] rounded-[7px] bg-[var(--tint)] text-[var(--indigo)]">
                          {kw}
                        </span>
                      )) : (
                        <span className="text-[11.5px] text-[var(--mut)]">
                          No target keywords yet.
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                      JSON-LD Schema
                    </div>
                    <pre className="border border-[var(--bd)] rounded-[8px] p-[9px_10px] bg-[var(--card2)] font-mono text-[10.5px] leading-relaxed text-[var(--fg2)] overflow-x-auto">
                      {blog.schema || "No schema generated yet."}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === "quality" && (
                <div className="flex flex-col gap-[10px]">
                  <div className="flex items-center gap-[12px] border border-[var(--bd)] rounded-[10px] p-[11px] bg-[var(--card2)]">
                    <div className="font-mono text-[26px] font-extrabold text-[var(--emerald)] tracking-tight">
                      {blog.quality || "0"}
                    </div>
                    <div>
                      <div className="text-[12px] font-bold text-[var(--fg)]">
                        {numericQuality >= 90 ? "Passed Quality Gate" : numericQuality > 0 ? "Needs Review" : "Not evaluated"}
                      </div>
                      <div className="text-[10.5px] text-[var(--mut)]">
                        Threshold {" >= "} 90 · {qualityChecks.length} checks available
                      </div>
                    </div>
                  </div>

                  {qualityChecks.length > 0 ? qualityChecks.map((q, idx) => (
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
                  )) : (
                    <div className="p-[24px_12px] text-center text-[12px] text-[var(--mut)]">
                      No quality checks yet.
                    </div>
                  )}
                </div>
              )}

              {activeTab === "assets" && (
                <div className="flex flex-col gap-[12px]">
                  {mediaAssets.length > 0 ? mediaAssets.map((asset, idx) => (
                    <div key={idx} className="border border-[var(--bd)] rounded-[10px] overflow-hidden bg-[var(--card2)] p-[10px]">
                      <div className="h-[120px] bg-[var(--card)] rounded-[8px] flex items-center justify-center text-[var(--mut)] font-mono text-[11px]">
                        {asset.label}
                      </div>
                      <div className="mt-[8px] flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-[var(--fg)]">{asset.name}</span>
                        <span className="font-mono text-[var(--faint)]">{asset.size}</span>
                      </div>
                      <div className="text-[10px] text-[var(--mut)] mt-[2px] font-mono truncate">
                        {asset.path}
                      </div>
                    </div>
                  )) : (
                    <div className="p-[24px_12px] text-center text-[12px] text-[var(--mut)]">
                      No media assets yet.
                    </div>
                  )}
                </div>
              )}

              {activeTab === "timeline" && (
                <div className="flex flex-col gap-[8px] font-mono text-[11px]">
                  {timeline.length > 0 ? timeline.map((row, i) => (
                    <div key={i} className="p-[6px_8px] rounded-[6px] bg-[var(--card2)] border border-[var(--bd)] flex flex-col gap-[2px]">
                      <div className="flex items-center justify-between text-[10px] text-[var(--indigo)] font-bold">
                        <span>{row.worker}</span>
                        <span className="text-[var(--faint)]">{row.time}</span>
                      </div>
                      <div className="text-[var(--fg2)]">{row.msg}</div>
                    </div>
                  )) : (
                    <div className="p-[24px_12px] text-center text-[12px] text-[var(--mut)]">
                      No worker history yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
