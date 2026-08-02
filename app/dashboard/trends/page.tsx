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
  const [approveTarget, setApproveTarget] = useState<TrendRow | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [approveResult, setApproveResult] = useState<{ jobId: string; queue: string } | null>(null);
  const [isResearchRunning, setIsResearchRunning] = useState(false);
  const [researchMessage, setResearchMessage] = useState("");

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
    let mounted = true;
    const loadTrends = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (mounted) setTrends(data.trends ?? []);
        })
        .catch(() => {
          if (mounted) setTrends([]);
        });
    };
    loadTrends();
    const timer = window.setInterval(loadTrends, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleTriggerResearch = async () => {
    setIsResearchRunning(true);
    setResearchMessage("Queueing research worker...");
    try {
      const res = await fetch("/api/research/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to queue research worker");
      }
      setResearchMessage(`Queued ${data.queue}${data.jobId ? ` · ${data.jobId}` : ""}`);
    } catch (err) {
      setResearchMessage(err instanceof Error ? err.message : "Failed to queue research worker");
    } finally {
      setIsResearchRunning(false);
    }
  };

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

  const openApproveModal = (trend: TrendRow) => {
    setApproveTarget(trend);
    setApproveError("");
    setApproveResult(null);
  };

  const closeApproveModal = () => {
    if (isApproving) return;
    setApproveTarget(null);
    setApproveError("");
    setApproveResult(null);
  };

  const handleApproveTrend = async () => {
    if (!approveTarget) return;
    setIsApproving(true);
    setApproveError("");
    setApproveResult(null);

    try {
      const res = await fetch(`/api/trends/${approveTarget.id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to start pipeline");
      }
      setApproveResult({ jobId: String(data.jobId), queue: data.queue });
      setTrends((current) =>
        current.map((trend) =>
          trend.id === approveTarget.id
            ? { ...trend, volume: `PLANNED · queued now`, rec: "Pipeline Queued" }
            : trend
        )
      );
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Failed to start pipeline");
    } finally {
      setIsApproving(false);
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
  const minWritingScore = 90;

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
            disabled={isResearchRunning}
            onClick={handleTriggerResearch}
            className="h-[30px] px-[12px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:bg-[#4f46e5] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isResearchRunning ? "Queueing..." : "Trigger research worker"}
          </button>
        </div>
      </div>
      {researchMessage && (
        <div className="rounded-[9px] border border-[var(--bd)] bg-[var(--card)] px-[11px] py-[8px] text-[11.5px] text-[var(--fg2)]">
          {researchMessage}
        </div>
      )}

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
        {filteredTrends.length > 0 ? filteredTrends.map((t, idx) => {
          const canApprove = Number(t.score) >= minWritingScore;
          return (
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
                disabled={!canApprove}
                onClick={() => openApproveModal(t)}
                className="flex-1 h-[28px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11px] font-semibold hover:bg-[#4f46e5] transition-colors disabled:bg-[var(--card2)] disabled:text-[var(--mut)] disabled:border-[var(--bd)] disabled:cursor-not-allowed"
              >
                {canApprove ? "Approve → Pipeline" : "Score too low"}
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
          );
        }) : (
          <div className="sm:col-span-2 lg:col-span-3 bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[32px] text-center text-[12px] text-[var(--mut)] shadow-[var(--shadow)]">
            No trend signals yet.
          </div>
        )}
      </div>

      {approveTarget && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.58)] backdrop-blur-sm flex items-center justify-center p-[18px] animate-dkfade"
          onClick={closeApproveModal}
        >
          <div
            className="w-full max-w-[620px] bg-[var(--card)] border border-[var(--bd)] rounded-[16px] shadow-[var(--shadow)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-[16px] border-b border-[var(--bd)] flex items-start gap-[12px]">
              <div className="w-[38px] h-[38px] rounded-[12px] bg-[var(--tint)] text-[var(--indigo)] flex items-center justify-center flex-none">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 13a8 8 0 0 1 14-5" />
                  <path d="M14 4h5v5" />
                  <path d="M20 11a8 8 0 0 1-14 5" />
                  <path d="M10 20H5v-5" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-extrabold tracking-tight text-[var(--fg)]">
                  Run content pipeline
                </div>
                <div className="text-[11.5px] text-[var(--mut)] mt-[3px] leading-relaxed">
                  Approve this research signal and queue it for planning, outline generation, and writing.
                </div>
              </div>
              <button
                aria-label="Close approve pipeline modal"
                disabled={isApproving}
                onClick={closeApproveModal}
                className="ml-auto w-[30px] h-[30px] rounded-[9px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] flex items-center justify-center hover:text-[var(--fg)] disabled:opacity-50"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="p-[16px] flex flex-col gap-[14px]">
              <div className="rounded-[12px] border border-[var(--bd)] bg-[var(--card2)] p-[13px]">
                <div className="flex items-center gap-[8px] flex-wrap mb-[8px]">
                  <span
                    className="w-[24px] h-[24px] rounded-[7px] flex items-center justify-center font-mono font-extrabold text-[9px] text-white"
                    style={{ background: approveTarget.srcColor }}
                  >
                    {approveTarget.srcInitial}
                  </span>
                  <span className="text-[10.5px] font-semibold text-[var(--mut)]">{approveTarget.source}</span>
                  <span className="text-[10.5px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--card)] text-[var(--fg2)]">
                    {approveTarget.cat}
                  </span>
                  <span
                    className="ml-auto font-mono text-[11px] font-bold p-[2px_8px] rounded-[7px]"
                    style={{ background: approveTarget.scoreBg, color: approveTarget.scoreFg }}
                  >
                    score {approveTarget.score}
                  </span>
                </div>
                <div className="text-[13px] font-bold leading-snug text-[var(--fg)]">
                  {approveTarget.title}
                </div>
                <div className="text-[11px] text-[var(--mut)] mt-[8px]">
                  {approveTarget.volume}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-[9px]">
                {[
                  { label: "Planning", text: "SEO intent, audience, angle", active: true },
                  { label: "Outline", text: "Sections, FAQs, metadata", active: Boolean(approveResult) },
                  { label: "Writing", text: "Structured Markdown draft", active: Boolean(approveResult) },
                ].map((step, index) => (
                  <div key={step.label} className="rounded-[11px] border border-[var(--bd)] bg-[var(--card)] p-[11px]">
                    <div className="flex items-center gap-[7px]">
                      <span
                        className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold ${
                          step.active ? "bg-[var(--indigo)] text-white" : "bg-[var(--card2)] text-[var(--mut)]"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="text-[11.5px] font-bold text-[var(--fg)]">{step.label}</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--mut)] mt-[7px] leading-snug">{step.text}</div>
                  </div>
                ))}
              </div>

              {approveError && (
                <div className="text-[11px] text-[var(--rose)] bg-[rgba(244,63,94,0.10)] border border-[rgba(244,63,94,0.25)] rounded-[9px] p-[9px_10px]">
                  {approveError}
                </div>
              )}

              {approveResult && (
                <div className="text-[11px] text-[var(--emerald)] bg-[rgba(16,185,129,0.10)] border border-[rgba(16,185,129,0.25)] rounded-[9px] p-[9px_10px]">
                  Pipeline queued successfully: job {approveResult.jobId} on {approveResult.queue}.
                </div>
              )}
            </div>

            <div className="p-[12px_16px] border-t border-[var(--bd)] flex items-center justify-between gap-[10px]">
              <div className="text-[10.5px] text-[var(--mut)]">
                Worker must be running: <span className="font-mono">npm run worker:dev</span>
              </div>
              <div className="flex gap-[8px]">
                <button
                  type="button"
                  disabled={isApproving}
                  onClick={closeApproveModal}
                  className="h-[31px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] disabled:opacity-60"
                >
                  {approveResult ? "Close" : "Cancel"}
                </button>
                {!approveResult && (
                  <button
                    type="button"
                    disabled={isApproving}
                    onClick={handleApproveTrend}
                    className="h-[31px] px-[13px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-bold hover:bg-[#4f46e5] disabled:opacity-60"
                  >
                    {isApproving ? "Queueing..." : "Run pipeline"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
