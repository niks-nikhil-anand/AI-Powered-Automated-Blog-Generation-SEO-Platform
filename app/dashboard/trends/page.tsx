"use client";

import React, { useState } from "react";

interface TrendsPageProps {
  onOpenManualTopic?: () => void;
}

export default function TrendResearchPage({ onOpenManualTopic }: TrendsPageProps) {
  const [activeFilter, setActiveFilter] = useState("All sources");

  const trendFilters = [
    { label: "All sources", count: 42 },
    { label: "Google Trends", count: 14 },
    { label: "Hacker News", count: 11 },
    { label: "GitHub Trending", count: 9 },
    { label: "Reddit", count: 5 },
    { label: "Product Hunt", count: 3 },
  ];

  const trends = [
    {
      srcInitial: "GT",
      source: "Google Trends",
      srcColor: "var(--indigo)",
      score: "98.5",
      scoreBg: "rgba(16,185,129,0.14)",
      scoreFg: "var(--emerald)",
      title: "DeepSeek-V3 Architecture: Open-Weights Mixture of Experts Model",
      cat: "AI Tooling",
      rec: "Highly Recommended",
      recBg: "rgba(16,185,129,0.12)",
      recFg: "var(--emerald)",
      volume: "125K searches/day",
      scorePct: "98.5%",
    },
    {
      srcInitial: "HN",
      source: "Hacker News",
      srcColor: "var(--amber)",
      score: "96.4",
      scoreBg: "rgba(16,185,129,0.14)",
      scoreFg: "var(--emerald)",
      title: "Next.js 15 Partial Prerendering: Hybrid Static-Dynamic Architecture",
      cat: "Frameworks",
      rec: "Recommended",
      recBg: "rgba(16,185,129,0.12)",
      recFg: "var(--emerald)",
      volume: "482 points · 210 comments",
      scorePct: "96.4%",
    },
    {
      srcInitial: "GH",
      source: "GitHub Trending",
      srcColor: "#171717",
      score: "91.2",
      scoreBg: "rgba(16,185,129,0.14)",
      scoreFg: "var(--emerald)",
      title: "Bun 1.2 Native SQLite Driver with Zero Copy ArrayBuffer",
      cat: "Runtime",
      rec: "Recommended",
      recBg: "rgba(16,185,129,0.12)",
      recFg: "var(--emerald)",
      volume: "1,420 stars today",
      scorePct: "91.2%",
    },
    {
      srcInitial: "RD",
      source: "Reddit /r/programming",
      srcColor: "var(--rose)",
      score: "88.6",
      scoreBg: "rgba(99,102,241,0.14)",
      scoreFg: "var(--indigo)",
      title: "Rust vs Go Microservices in 2026: Garbage Collection vs Borrow Checker",
      cat: "Backend",
      rec: "Good Potential",
      recBg: "rgba(99,102,241,0.12)",
      recFg: "var(--indigo)",
      volume: "890 upvotes · 340 comments",
      scorePct: "88.6%",
    },
    {
      srcInitial: "GT",
      source: "Google Trends",
      srcColor: "var(--indigo)",
      score: "86.0",
      scoreBg: "rgba(99,102,241,0.14)",
      scoreFg: "var(--indigo)",
      title: "Tailwind CSS v4 Engine Deep Dive: CSS-First Configuration",
      cat: "CSS",
      rec: "Good Potential",
      recBg: "rgba(99,102,241,0.12)",
      recFg: "var(--indigo)",
      volume: "45K searches/day",
      scorePct: "86.0%",
    },
    {
      srcInitial: "PH",
      source: "Product Hunt",
      srcColor: "var(--amber)",
      score: "83.4",
      scoreBg: "rgba(99,102,241,0.14)",
      scoreFg: "var(--indigo)",
      title: "PostgreSQL 17 Memory Management & Logical Replication Enhancements",
      cat: "Database",
      rec: "Consider Topic",
      recBg: "var(--card2)",
      recFg: "var(--fg2)",
      volume: "620 upvotes",
      scorePct: "83.4%",
    },
    {
      srcInitial: "GH",
      source: "GitHub Trending",
      srcColor: "#171717",
      score: "81.0",
      scoreBg: "var(--card2)",
      scoreFg: "var(--fg2)",
      title: "Docker Multi-Stage Builds for Node.js Applications Optimization",
      cat: "DevOps",
      rec: "Consider Topic",
      recBg: "var(--card2)",
      recFg: "var(--fg2)",
      volume: "980 stars today",
      scorePct: "81.0%",
    },
    {
      srcInitial: "HN",
      source: "Hacker News",
      srcColor: "var(--amber)",
      score: "79.5",
      scoreBg: "var(--card2)",
      scoreFg: "var(--fg2)",
      title: "TypeScript 5.6 Nullish Coalescing & Type Checking Performance",
      cat: "TypeScript",
      rec: "Consider Topic",
      recBg: "var(--card2)",
      recFg: "var(--fg2)",
      volume: "310 points · 94 comments",
      scorePct: "79.5%",
    },
    {
      srcInitial: "RD",
      source: "Reddit /r/node",
      srcColor: "var(--rose)",
      score: "76.2",
      scoreBg: "var(--card2)",
      scoreFg: "var(--fg2)",
      title: "Vite 6 Environment API & Server-Side Rendering Improvements",
      cat: "Tooling",
      rec: "Low Priority",
      recBg: "var(--card2)",
      recFg: "var(--faint)",
      volume: "240 upvotes",
      scorePct: "76.2%",
    },
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
            42 signals across 5 sources · last crawl 12 min ago
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
        {filteredTrends.map((t, idx) => (
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
        ))}
      </div>
    </div>
  );
}
