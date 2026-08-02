"use client";

import React, { useEffect, useState } from "react";

interface TrendsPageProps {
  onOpenManualTopic?: () => void;
}

export default function TrendResearchPage({ onOpenManualTopic }: TrendsPageProps) {
  const [activeFilter, setActiveFilter] = useState("All sources");
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<TrendRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  type TrendRow = {
    id: string;
    srcInitial: string;
    source: string;
    srcColor: string;
    score: string;
    scoreBg: string;
    scoreFg: string;
    title: string;
    cat: string;
    rec: string;
    recBg: string;
    recFg: string;
    volume: string;
    scorePct: string;
  };

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => setTrends(data.trends ?? []))
      .catch(() => setTrends([]));
  }, []);

  const handleDeleteTrend = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError("");

    try {
      const res = await fetch(`/api/trends/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete trend");
      }
      setTrends((current) => current.filter((trend) => trend.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete trend");
    } finally {
      setIsDeleting(false);
    }
  };

  const trendFilters = [
    { label: "All sources", count: trends.length },
    { label: "Google Trends", count: trends.filter((t) => t.source === "Google Trends").length },
    { label: "Google News", count: trends.filter((t) => t.source === "Google News").length },
    { label: "GitHub Trending", count: trends.filter((t) => t.source === "GitHub Trending").length },
  ];

  const filteredTrends = activeFilter === "All sources"
    ? trends
    : trends.filter((t) => t.source.toLowerCase().includes(activeFilter.toLowerCase()));

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Page Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Trend Research & Topic Selection
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            {trends.length} topics from {new Set(trends.map((t) => t.source)).size} sources
          </p>
        </div>
        <div className="flex gap-[7px]">
          <button
            aria-label="Open manual topic creator"
            onClick={onOpenManualTopic}
            className="h-[30px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] transition-colors"
          >
            + Manual topic
          </button>
          <button
            aria-label="Trigger research worker"
            onClick={() => alert("Triggered Research Worker crawl job!")}
            className="h-[30px] px-[12px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:bg-[#4f46e5] transition-colors"
          >
            Trigger research worker
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-[7px] flex-wrap items-center">
        {trendFilters.map((f, i) => {
          const isActive = activeFilter === f.label;
          return (
            <button
              key={i}
              aria-label="Filter trends"
              onClick={() => setActiveFilter(f.label)}
              className={`h-[27px] px-[11px] rounded-full border text-[11.5px] font-semibold transition-colors ${
                isActive
                  ? "bg-[var(--tint)] text-[var(--indigo)] border-[rgba(99,102,241,0.3)]"
                  : "bg-[var(--card)] text-[var(--fg2)] border-[var(--bd)] hover:border-[var(--bd2)]"
              }`}
            >
              {f.label} ({f.count})
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-[var(--mut)]">
          Showing {filteredTrends.length} topics
        </span>
      </div>

      {/* Trends Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[12px]">
        {filteredTrends.length > 0 ? filteredTrends.map((t, idx) => (
          <div
            key={idx}
            className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[13px] shadow-[var(--shadow)] flex flex-col gap-[9px] hover:border-[var(--bd2)] transition-colors"
          >
            {/* Header */}
            <div className="flex items-center gap-[8px]">
              <span
                className="w-[22px] h-[22px] flex-none rounded-[6px] flex items-center justify-center font-mono font-extrabold text-[9px] text-white"
                style={{ background: t.srcColor }}
              >
                {t.srcInitial}
              </span>
              <span className="text-[10.5px] font-semibold text-[var(--mut)]">
                {t.source}
              </span>
              <span
                className="ml-auto font-mono text-[11px] font-bold p-[2px_7px] rounded-[6px]"
                style={{ background: t.scoreBg, color: t.scoreFg }}
              >
                {t.score}
              </span>
              <button
                aria-label={`Delete trend ${t.title}`}
                title="Delete trend"
                onClick={() => {
                  setDeleteTarget(t);
                  setDeleteError("");
                }}
                className="w-[24px] h-[24px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] inline-flex items-center justify-center hover:border-[var(--rose)] hover:text-[var(--rose)] transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v5M14 11v5" />
                </svg>
              </button>
            </div>

            {/* Title */}
            <div className="text-[13.5px] font-bold leading-snug tracking-tight text-[var(--fg)]">
              {t.title}
            </div>

            {/* Badges */}
            <div className="flex gap-[6px] flex-wrap items-center">
              <span className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--card2)] text-[var(--fg2)]">
                {t.cat}
              </span>
              <span
                className="text-[10px] font-semibold p-[2px_7px] rounded-[6px]"
                style={{ background: t.recBg, color: t.recFg }}
              >
                {t.rec}
              </span>
              <span className="text-[10px] font-medium p-[2px_7px] rounded-[6px] text-[var(--faint)]">
                {t.volume}
              </span>
            </div>

            {/* Score Bar */}
            <div className="h-[3px] rounded-[2px] bg-[var(--card2)] overflow-hidden">
              <div
                className="h-full rounded-[2px]"
                style={{ width: t.scorePct, background: t.scoreFg }}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-[7px] mt-auto pt-[3px]">
              <button
                aria-label="Approve topic and send to pipeline"
                onClick={() => alert(`Approved topic "${t.title}" -> Sent to BullMQ planning_queue`)}
                className="flex-1 h-[28px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11px] font-semibold hover:bg-[#4f46e5] transition-colors"
              >
                Approve → Pipeline
              </button>
              <button
                aria-label="Dismiss topic"
                onClick={() => alert(`Skipped topic "${t.title}"`)}
                className="h-[28px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] text-[11px] font-semibold hover:border-[var(--rose)] hover:text-[var(--rose)] transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        )) : (
          <div className="sm:col-span-2 lg:col-span-3 bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[32px] text-center text-[12px] text-[var(--mut)] shadow-[var(--shadow)]">
            No trend signals yet.
          </div>
        )}
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.58)] backdrop-blur-sm flex items-center justify-center p-[18px] animate-dkfade"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-[460px] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-[14px_16px] border-b border-[var(--bd)] flex items-center gap-[10px]">
              <div className="w-[30px] h-[30px] rounded-[9px] bg-[rgba(244,63,94,0.12)] text-[var(--rose)] flex items-center justify-center">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] font-bold text-[var(--fg)]">Delete trend</div>
                <div className="text-[11px] text-[var(--mut)] mt-[2px]">This removes the research topic and linked plan/outline.</div>
              </div>
            </div>
            <div className="p-[16px]">
              <div className="text-[12.5px] font-semibold leading-snug text-[var(--fg)]">
                {deleteTarget.title}
              </div>
              <div className="mt-[8px] flex gap-[6px] flex-wrap">
                <span className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--card2)] text-[var(--fg2)]">
                  {deleteTarget.source}
                </span>
                <span className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[rgba(244,63,94,0.12)] text-[var(--rose)]">
                  score {deleteTarget.score}
                </span>
              </div>
              {deleteError && (
                <div className="mt-[12px] text-[11px] text-[var(--rose)] bg-[rgba(244,63,94,0.10)] border border-[rgba(244,63,94,0.25)] rounded-[8px] p-[8px_10px]">
                  {deleteError}
                </div>
              )}
            </div>
            <div className="p-[12px_16px] border-t border-[var(--bd)] flex justify-end gap-[8px]">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="h-[30px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteTrend}
                className="h-[30px] px-[12px] rounded-[8px] border border-transparent bg-[var(--rose)] text-white text-[11.5px] font-bold hover:bg-rose-600 disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Delete trend"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
