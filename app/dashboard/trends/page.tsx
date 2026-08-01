"use client";

import React, { useState } from "react";

interface TrendsPageProps {
  onOpenManualTopic?: () => void;
}

export default function TrendResearchPage({ onOpenManualTopic }: TrendsPageProps) {
  const [activeFilter, setActiveFilter] = useState("All sources");

  const trendFilters = [
    { label: "All sources", count: 0 },
    { label: "Google Trends", count: 0 },
    { label: "Hacker News", count: 0 },
    { label: "GitHub Trending", count: 0 },
    { label: "Reddit", count: 0 },
    { label: "Product Hunt", count: 0 },
  ];

  const trends: {
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
  }[] = [];

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
            0 signals across 0 sources · no crawls yet
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
    </div>
  );
}
