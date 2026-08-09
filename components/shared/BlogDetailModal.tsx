"use client";

import React, { useState } from "react";
import { SeoSnippetPreview } from "./SeoSnippetPreview";
import { OverridePublishModal } from "./OverridePublishModal";
import {
  META_DESCRIPTION_BUDGET,
  META_TITLE_BUDGET,
  checkJsonLd,
  lengthStatus,
  lengthStatusColor,
} from "@/lib/seo";

export interface BlogItem {
  id?: string;
  title: string;
  slug: string;
  cat?: string;
  words?: string;
  trend?: string;
  quality?: string;
  cost?: string;
  costValue?: number;
  tokens?: string;
  tokenCount?: number;
  aiCalls?: number;
  models?: string[];
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
  featuredImage?: {
    id: string;
    name: string;
    bucket: string;
    path: string;
    publicUrl: string;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    size: number;
  };
  qualityReport?: {
    overallScore: number;
    passed: boolean;
    recommendation: string;
    checks: {
      label: string;
      score: number;
      maxScore: number;
      notes: string[];
    }[];
    /** Task 3: claim-level fact-check detail (null/absent for legacy sampled checks). */
    factCheckDetail?: {
      mode: string;
      totalClaims: number;
      supported: number;
      uncertain: number;
      unsupported: number;
      unverifiable: number;
      coveragePct: number;
      claims: { claim: string; verdict: string; confidence: number; note?: string; sourceUrl?: string }[];
    } | null;
    /** Task 4: LLM editorial judge breakdown (null/absent when disabled or failed). */
    judgeDetail?: {
      scores: { depth: number; accuracyOfTone: number; originality: number; usefulness: number };
      overall: number;
      critique: string;
      fixes: { section: string; issue: string; fix: string; priority: string }[];
      shadowMode?: boolean;
    } | null;
    createdAt: string;
  };
  workflow?: {
    id: string;
    status: string;
    currentStage: string;
    failureReason?: string | null;
    attempts: {
      id: string;
      worker: string;
      attempt: number;
      status: string;
      error?: string | null;
      qualityReport?: unknown;
      startedAt: string;
      finishedAt?: string | null;
    }[];
  };
}

type DetailTab = "overview" | "seo" | "quality" | "assets" | "timeline";

interface BlogDetailModalProps {
  blog: BlogItem | null;
  isOpen: boolean;
  onClose: () => void;
  /** Opens directly on a specific tab - e.g. the Quality page deep-links into "quality" or "seo". */
  initialTab?: DetailTab;
  /** Fired after a Re-run QA / Regenerate / Publish action completes, so the caller can refresh its data. */
  onActionComplete?: () => void;
}

const qualityParameterLabels = [
  "SEO Structure",
  "Content Completeness",
  "Readability",
  "Content Quality",
  "Keyword Optimization",
  "Technical SEO",
  "Formatting & UX",
  "Media Quality",
  "AI & Fact Quality",
  "Publishing Readiness",
];

export function BlogDetailModal({ blog, isOpen, onClose, initialTab, onActionComplete }: BlogDetailModalProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab ?? "overview");
  const [actionPending, setActionPending] = useState<"requeue-quality" | "publish" | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "seo", label: "SEO & Meta" },
    { key: "quality", label: "Quality QA" },
    { key: "assets", label: "GCS Media" },
    { key: "timeline", label: "Worker History" },
  ];

  // The modal component stays mounted between opens (parents toggle `isOpen`
  // rather than unmounting it), so activeTab needs to be re-synced to
  // initialTab every time it's (re)opened - otherwise a second open with a
  // different initialTab would keep showing whatever tab was last active.
  // Done as a render-time state adjustment on the isOpen transition rather
  // than a useEffect, since calling setState synchronously inside an effect
  // body is a lint error in this repo's config (see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setActiveTab(initialTab ?? "overview");
      setActionMessage(null);
    }
  }

  if (!isOpen || !blog) return null;

  const writingAttempts = blog.workflow?.attempts.filter((attempt) => attempt.worker === "writing-worker").length ?? 0;
  const hasQualityReport = Boolean(blog.qualityReport);
  const qualityPassed = blog.qualityReport?.passed ?? false;
  const retryLimit = 4;

  const handleReRunQa = async () => {
    if (!blog.id || actionPending) return;
    setActionPending("requeue-quality");
    setActionMessage(null);
    try {
      const res = await fetch(`/api/blogs/${blog.id}/requeue-quality`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to queue quality check");
      setActionMessage({ text: `Quality check queued (job ${data.jobId}).`, tone: "ok" });
      onActionComplete?.();
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "Failed to queue quality check", tone: "error" });
    } finally {
      setActionPending(null);
    }
  };

  const handlePublish = async () => {
    if (!blog.id || actionPending || !hasQualityReport) return;
    if (!qualityPassed) {
      setOverrideModalOpen(true);
      return;
    }
    setActionPending("publish");
    setActionMessage(null);
    try {
      const res = await fetch(`/api/blogs/${blog.id}/override-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Published from dashboard (quality gate passed)." }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to publish");
      setActionMessage({ text: "Published.", tone: "ok" });
      onActionComplete?.();
    } catch (err) {
      setActionMessage({ text: err instanceof Error ? err.message : "Failed to publish", tone: "error" });
    } finally {
      setActionPending(null);
    }
  };

  const handleOverrideConfirm = async (reason: string) => {
    if (!blog.id) return;
    setActionPending("publish");
    try {
      const res = await fetch(`/api/blogs/${blog.id}/override-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to publish");
      setActionMessage({ text: "Published.", tone: "ok" });
      setOverrideModalOpen(false);
      onActionComplete?.();
    } finally {
      setActionPending(null);
    }
  };

  const markdownBody = blog.content ?? "";
  const targetKeywords: string[] = blog.keywords ?? [];
  const numericQuality = Number(blog.quality ?? 0);
  const qualityReportChecks = blog.qualityReport?.checks ?? [];
  const fallbackQualityScore = Math.min(10, Math.max(0, Math.round(numericQuality / 10)));
  const qualityChecks: {
    name: string;
    value: string;
    pct: string;
    color: string;
    notes?: string[];
  }[] = qualityParameterLabels.map((label, index) => {
    const reportCheck = qualityReportChecks.find((check) => check.label === label);
    const score = reportCheck?.score ?? (numericQuality > 0 ? fallbackQualityScore : 0);
    const maxScore = reportCheck?.maxScore ?? 10;
    return {
      name: label,
      value: reportCheck ? `${score}/${maxScore}` : numericQuality > 0 ? `${score}/${maxScore}` : "Pending",
      pct: `${Math.min(100, Math.max(0, (score / maxScore) * 100))}%`,
      color: score >= 9 ? "var(--emerald)" : score >= 7 ? "var(--amber)" : score > 0 ? "var(--indigo)" : "var(--mut)",
      notes: reportCheck?.notes ?? [
        index === 0
          ? "Detailed QA report not generated yet"
          : "Run Quality QA to calculate this parameter",
      ],
    };
  });
  const mediaAssets: {
    label: string;
    name: string;
    size: string;
    path: string;
    bucket: string;
    publicUrl: string;
    mimeType: string;
  }[] = blog.featuredImage
    ? [
        {
          label: blog.featuredImage.width && blog.featuredImage.height
            ? `${blog.featuredImage.width}x${blog.featuredImage.height}`
            : "Hero image",
          name: blog.featuredImage.name,
          size: `${Math.max(1, Math.round(blog.featuredImage.size / 1024))} KB`,
          path: blog.featuredImage.path,
          bucket: blog.featuredImage.bucket,
          publicUrl: blog.featuredImage.publicUrl,
          mimeType: blog.featuredImage.mimeType,
        },
      ]
    : [];
  const timeline: {
    time: string;
    worker: string;
    msg: string;
    status?: string;
    error?: string | null;
  }[] = [
    ...(blog.createdAtLabel
      ? [{ time: blog.createdAtLabel, worker: "system", msg: "Blog record created" }]
      : []),
    ...(blog.workflow?.attempts.map((attempt) => ({
      time: new Date(attempt.finishedAt ?? attempt.startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      worker: attempt.worker,
      status: attempt.status,
      msg: `Attempt ${attempt.attempt}${attempt.error ? " failed" : " completed"}`,
      error: attempt.error,
    })) ?? []),
    ...(blog.updatedAtLabel
      ? [{ time: blog.updatedAtLabel, worker: "system", msg: "Blog record last updated" }]
      : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.55)] backdrop-blur-[3px] flex items-center justify-center p-[16px] sm:p-[26px] animate-dkfade overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-[min(1180px,100%)] h-[calc(100dvh-32px)] sm:h-[min(860px,calc(100dvh-52px))] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] flex flex-col overflow-hidden my-auto"
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
              disabled={actionPending !== null}
              onClick={handleReRunQa}
              className="h-[28px] px-[11px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {actionPending === "requeue-quality" ? "Queueing…" : "Re-run QA"}
            </button>
            <button
              aria-label="Publish article"
              disabled={actionPending !== null || blog.status === "Published" || !hasQualityReport}
              onClick={handlePublish}
              title={
                !hasQualityReport
                  ? "Quality check hasn't run yet - this will auto-publish once it passes"
                  : qualityPassed
                    ? "Publish now"
                    : "Score is below the quality gate - publishing requires an override reason"
              }
              className="h-[28px] px-[12px] rounded-[8px] border border-transparent bg-[var(--emerald)] text-white text-[11.5px] font-bold hover:bg-emerald-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {actionPending === "publish"
                ? "Publishing…"
                : blog.status === "Published"
                  ? "Published"
                  : !hasQualityReport
                    ? "Awaiting QA"
                    : qualityPassed
                      ? "Publish"
                      : "Override & publish"}
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

        {actionMessage && (
          <div
            className="flex-none px-[14px] py-[6px] text-[11px] font-medium border-b border-[var(--bd)]"
            style={{
              background: actionMessage.tone === "ok" ? "rgba(16,185,129,0.10)" : "rgba(244,63,94,0.10)",
              color: actionMessage.tone === "ok" ? "var(--emerald)" : "var(--rose)",
            }}
          >
            {actionMessage.text}
          </div>
        )}

        {/* Content Body Grid */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] overflow-hidden">
          {/* Left Pane - Markdown Source */}
          <div className="min-w-0 min-h-0 flex flex-col border-r border-[var(--bd)]">
            <div className="flex-none flex items-center gap-[6px] p-[8px_12px] border-b border-[var(--bd)] bg-[var(--card2)]">
              <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                Markdown Source
              </span>
              <span className="ml-auto font-mono text-[10px] text-[var(--faint)]">
                No source generated yet
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-[14px_16px] font-mono text-[12px] leading-[1.75] text-[var(--fg2)] whitespace-pre-wrap">
              {markdownBody || "No markdown source yet."}
            </div>
          </div>

          {/* Right Pane - Inspection Details */}
          <div className="min-w-0 min-h-0 flex flex-col bg-[var(--card)]">
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
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-[13px]">
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
                  {blog.featuredImage && (
                    <div>
                      <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[5px]">
                        Generated Hero Image
                      </div>
                      <div className="border border-[var(--bd)] rounded-[10px] bg-[var(--card2)] p-[8px]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={blog.featuredImage.publicUrl}
                          alt={blog.title}
                          className="w-full aspect-video object-cover rounded-[8px] border border-[var(--bd)] bg-[var(--card)]"
                        />
                        <div className="mt-[7px] font-mono text-[10px] text-[var(--faint)] break-all">
                          {blog.featuredImage.publicUrl}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "seo" && (() => {
                const metaTitle = blog.metaTitle || blog.title;
                const metaDescription = blog.metaDescription || "";
                const titleLen = lengthStatus(metaTitle.length, META_TITLE_BUDGET);
                const descLen = lengthStatus(metaDescription.length, META_DESCRIPTION_BUDGET);
                const jsonLd = checkJsonLd(blog.schema);
                return (
                  <div className="flex flex-col gap-[13px]">
                    <div>
                      <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[6px]">
                        Search Result Preview
                      </div>
                      <SeoSnippetPreview title={metaTitle} slug={blog.slug} description={metaDescription} />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-[5px]">
                        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                          Meta Title
                        </span>
                        <span className="font-mono text-[10px] font-semibold" style={{ color: lengthStatusColor(titleLen) }}>
                          {metaTitle.length} / {META_TITLE_BUDGET}
                        </span>
                      </div>
                      <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] text-[11.5px] leading-snug font-medium text-[var(--fg)]">
                        {metaTitle}
                      </div>
                      {titleLen === "over" && (
                        <div className="mt-[4px] text-[10px] text-[var(--rose)]">
                          Over budget - Google will truncate this in search results.
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-[5px]">
                        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                          Meta Description
                        </span>
                        <span className="font-mono text-[10px] font-semibold" style={{ color: lengthStatusColor(descLen) }}>
                          {metaDescription.length} / {META_DESCRIPTION_BUDGET}
                        </span>
                      </div>
                      <div className="border border-[var(--bd)] rounded-[8px] p-[8px_10px] bg-[var(--card2)] text-[11.5px] leading-snug text-[var(--fg2)]">
                        {metaDescription || "No meta description generated yet."}
                      </div>
                      {descLen === "over" && (
                        <div className="mt-[4px] text-[10px] text-[var(--rose)]">
                          Over budget - Google will truncate this in search results.
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)] mb-[6px]">
                        Target Keywords
                      </div>
                      <div className="flex gap-[6px] flex-wrap">
                        {targetKeywords.length > 0 ? targetKeywords.map((kw, i) => {
                          const found = markdownBody.toLowerCase().includes(kw.toLowerCase());
                          return (
                            <span
                              key={i}
                              className="text-[10.5px] font-semibold p-[3px_8px] rounded-[7px] flex items-center gap-[4px]"
                              style={{
                                background: found ? "var(--tint)" : "rgba(244,63,94,0.10)",
                                color: found ? "var(--indigo)" : "var(--rose)",
                              }}
                              title={found ? "Found in article content" : "Not found in article content"}
                            >
                              {kw}
                              <span>{found ? "✓" : "✕"}</span>
                            </span>
                          );
                        }) : (
                          <span className="text-[11.5px] text-[var(--mut)]">
                            No target keywords yet.
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-[5px]">
                        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                          JSON-LD Schema
                        </span>
                        <span
                          className="text-[9.5px] font-bold px-[6px] py-[1.5px] rounded-[5px]"
                          style={{
                            background: jsonLd.valid ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)",
                            color: jsonLd.valid ? "var(--emerald)" : "var(--rose)",
                          }}
                        >
                          {jsonLd.valid ? "Valid" : "Needs attention"}
                        </span>
                      </div>
                      {jsonLd.errors.length > 0 && (
                        <ul className="mb-[6px] flex flex-col gap-[2px]">
                          {jsonLd.errors.map((err, i) => (
                            <li key={i} className="text-[10px] text-[var(--rose)]">
                              · {err}
                            </li>
                          ))}
                        </ul>
                      )}
                      <pre className="border border-[var(--bd)] rounded-[8px] p-[9px_10px] bg-[var(--card2)] font-mono text-[10.5px] leading-relaxed text-[var(--fg2)] overflow-x-auto">
                        {jsonLd.pretty || "No schema generated yet."}
                      </pre>
                    </div>
                  </div>
                );
              })()}

              {activeTab === "quality" && (
                <div className="flex flex-col gap-[10px]">
                  <div className="flex items-center gap-[12px] border border-[var(--bd)] rounded-[10px] p-[11px] bg-[var(--card2)]">
                    <div className="font-mono text-[26px] font-extrabold text-[var(--emerald)] tracking-tight">
                      {blog.quality || "0"}
                    </div>
                    <div>
                      <div className="text-[12px] font-bold text-[var(--fg)]">
                        {blog.qualityReport?.recommendation || (numericQuality >= 90 ? "Passed Quality Gate" : numericQuality > 0 ? "Needs Review" : "Not evaluated")}
                      </div>
                      <div className="text-[10.5px] text-[var(--mut)]">
                        Threshold {" >= "} 90 · {qualityChecks.length} QA parameters
                      </div>
                    </div>
                  </div>

                  {!qualityPassed && blog.workflow && (
                    <div
                      className="flex items-center gap-[8px] rounded-[8px] p-[8px_10px] border"
                      style={{
                        background: writingAttempts >= retryLimit ? "rgba(244,63,94,0.08)" : "var(--tint)",
                        borderColor: writingAttempts >= retryLimit ? "rgba(244,63,94,0.25)" : "rgba(99,102,241,0.25)",
                      }}
                    >
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: writingAttempts >= retryLimit ? "var(--rose)" : "var(--indigo)" }}
                      >
                        {writingAttempts >= retryLimit
                          ? `Retry budget exhausted (${writingAttempts}/${retryLimit}) - won't regenerate automatically.`
                          : `Regeneration attempt ${writingAttempts}/${retryLimit} - will retry via writing-worker automatically.`}
                      </span>
                    </div>
                  )}

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
                      {q.notes && q.notes.length > 0 && (
                        <div className="mt-[4px] text-[10px] text-[var(--faint)] leading-snug">
                          {q.notes.slice(0, 2).join(" · ")}
                        </div>
                      )}
                    </div>
                  )) : (
                    <div className="p-[24px_12px] text-center text-[12px] text-[var(--mut)]">
                      No quality checks yet.
                    </div>
                  )}

                  {/* Task 4: LLM editorial judge breakdown */}
                  {blog.qualityReport?.judgeDetail && (
                    <div className="border border-[var(--bd)] rounded-[10px] p-[10px_11px] bg-[var(--card2)]">
                      <div className="flex items-center justify-between mb-[6px]">
                        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                          Editorial Judge{blog.qualityReport.judgeDetail.shadowMode ? " (shadow)" : ""}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-[var(--indigo)]">
                          {blog.qualityReport.judgeDetail.overall}/100
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--fg2)] leading-snug mb-[7px]">
                        {blog.qualityReport.judgeDetail.critique}
                      </div>
                      <div className="grid grid-cols-4 gap-[6px] mb-[7px]">
                        {([
                          ["Depth", blog.qualityReport.judgeDetail.scores.depth],
                          ["Tone", blog.qualityReport.judgeDetail.scores.accuracyOfTone],
                          ["Originality", blog.qualityReport.judgeDetail.scores.originality],
                          ["Usefulness", blog.qualityReport.judgeDetail.scores.usefulness],
                        ] as const).map(([label, value]) => (
                          <div key={label} className="text-center border border-[var(--bd)] rounded-[7px] p-[4px]">
                            <div className="text-[9px] font-semibold text-[var(--mut)]">{label}</div>
                            <div className="font-mono text-[11px] font-bold text-[var(--fg)]">{value}/10</div>
                          </div>
                        ))}
                      </div>
                      {blog.qualityReport.judgeDetail.fixes.length > 0 && (
                        <ul className="flex flex-col gap-[4px]">
                          {blog.qualityReport.judgeDetail.fixes.map((fix, i) => (
                            <li key={i} className="text-[10.5px] text-[var(--fg2)] leading-snug">
                              <span
                                className="font-semibold"
                                style={{
                                  color:
                                    fix.priority === "high"
                                      ? "var(--rose)"
                                      : fix.priority === "medium"
                                        ? "var(--amber)"
                                        : "var(--mut)",
                                }}
                              >
                                [{fix.priority}] {fix.section}:
                              </span>{" "}
                              {fix.fix}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Task 3: claim-level fact-check detail */}
                  {blog.qualityReport?.factCheckDetail && (
                    <div className="border border-[var(--bd)] rounded-[10px] p-[10px_11px] bg-[var(--card2)]">
                      <div className="flex items-center justify-between mb-[6px]">
                        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                          Claim-level Fact Check
                        </span>
                        <span className="font-mono text-[10px] font-semibold text-[var(--fg2)]">
                          {blog.qualityReport.factCheckDetail.supported}/{blog.qualityReport.factCheckDetail.totalClaims} supported ·{" "}
                          {blog.qualityReport.factCheckDetail.coveragePct}% coverage
                        </span>
                      </div>
                      {blog.qualityReport.factCheckDetail.claims.filter((claim) => claim.verdict !== "supported").length > 0 ? (
                        <ul className="flex flex-col gap-[4px]">
                          {blog.qualityReport.factCheckDetail.claims
                            .filter((claim) => claim.verdict !== "supported")
                            .slice(0, 5)
                            .map((claim, i) => (
                              <li key={i} className="text-[10.5px] leading-snug text-[var(--fg2)]">
                                <span
                                  className="font-semibold"
                                  style={{
                                    color:
                                      claim.verdict === "unsupported"
                                        ? "var(--rose)"
                                        : claim.verdict === "unverifiable"
                                          ? "var(--amber)"
                                          : "var(--mut)",
                                  }}
                                >
                                  {claim.verdict}:
                                </span>{" "}
                                {claim.claim.length > 140 ? `${claim.claim.slice(0, 140)}…` : claim.claim}
                                {claim.note ? ` — ${claim.note}` : ""}
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <div className="text-[10.5px] text-[var(--emerald)]">
                          All extracted claims verified against evidence.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "assets" && (
                <div className="flex flex-col gap-[12px]">
                  {mediaAssets.length > 0 ? mediaAssets.map((asset, idx) => (
                    <div key={idx} className="border border-[var(--bd)] rounded-[10px] overflow-hidden bg-[var(--card2)] p-[10px]">
                      {asset.publicUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={asset.publicUrl}
                          alt={asset.name}
                          className="h-[150px] w-full object-cover rounded-[8px] bg-[var(--card)] border border-[var(--bd)]"
                        />
                      ) : (
                        <div className="h-[120px] bg-[var(--card)] rounded-[8px] flex items-center justify-center text-[var(--mut)] font-mono text-[11px]">
                          {asset.label}
                        </div>
                      )}
                      <div className="mt-[8px] flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-[var(--fg)]">{asset.name}</span>
                        <span className="font-mono text-[var(--faint)]">{asset.size}</span>
                      </div>
                      <div className="text-[10px] text-[var(--mut)] mt-[5px] font-mono break-all">
                        s3://{asset.bucket}/{asset.path}
                      </div>
                      <div className="text-[10px] text-[var(--faint)] mt-[4px] font-mono break-all">
                        {asset.publicUrl}
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
                  {blog.workflow && (
                    <div className="p-[8px] rounded-[8px] bg-[var(--card2)] border border-[var(--bd)]">
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span className="text-[var(--fg)]">Workflow {blog.workflow.status}</span>
                        <span className="text-[var(--faint)]">{blog.workflow.currentStage}</span>
                      </div>
                      {blog.workflow.failureReason && (
                        <div className="mt-[5px] text-[var(--rose)] whitespace-pre-wrap">
                          {blog.workflow.failureReason}
                        </div>
                      )}
                    </div>
                  )}
                  {timeline.length > 0 ? timeline.map((row, i) => (
                    <div key={i} className="p-[6px_8px] rounded-[6px] bg-[var(--card2)] border border-[var(--bd)] flex flex-col gap-[2px]">
                      <div className="flex items-center justify-between text-[10px] text-[var(--indigo)] font-bold">
                        <span>{row.worker}</span>
                        <span className="text-[var(--faint)]">{row.time}</span>
                      </div>
                      <div className="text-[var(--fg2)]">
                        {row.status ? `${row.status}: ` : ""}{row.msg}
                      </div>
                      {row.error && (
                        <div className="text-[var(--rose)] whitespace-pre-wrap">{row.error}</div>
                      )}
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
      <OverridePublishModal
        isOpen={overrideModalOpen}
        title={blog.title}
        report={
          blog.qualityReport
            ? { overallScore: blog.qualityReport.overallScore, recommendation: blog.qualityReport.recommendation }
            : null
        }
        onClose={() => setOverrideModalOpen(false)}
        onConfirm={handleOverrideConfirm}
      />
    </div>
  );
}
