"use client";

import React, { useState } from "react";
import Link from "next/link";
import { MetricCard } from "../components/ui/MetricCard";
import { BlogItem } from "../components/shared/BlogDetailModal";

interface DashboardPageProps {
  onOpenBlogModal?: (blog: BlogItem) => void;
}

export default function ExecutiveDashboard({ onOpenBlogModal }: DashboardPageProps) {
  const [range, setRange] = useState("24h");

  const metrics = [
    {
      label: "Daily Blogs",
      value: "14 / 20",
      suffix: "published",
      delta: "+3 vs yest",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: "70%",
      color: "var(--indigo)",
      foot: "Goal: 20 blogs / day",
    },
    {
      label: "Success Rate",
      value: "94.2%",
      suffix: "passed QA",
      delta: "+1.8%",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: "94%",
      color: "var(--emerald)",
      foot: "1 failure re-routed to retry queue",
    },
    {
      label: "AI Cost Today",
      value: "$3.42",
      suffix: "total",
      delta: "-12% cost/blog",
      deltaBg: "rgba(99,102,241,0.12)",
      deltaFg: "var(--indigo)",
      pct: "45%",
      color: "var(--sky)",
      foot: "Avg $0.244 per 3,000-word post",
    },
    {
      label: "Quality Score",
      value: "92",
      suffix: "/100 avg",
      delta: "gate ≥ 90",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: "92%",
      color: "var(--amber)",
      foot: "Highest score: 98 (PPR Guide)",
    },
  ];

  const stages = [
    { name: "Research", count: "42", state: "crawling", rate: "12/min", pct: "100%", dot: "var(--emerald)", anim: "animate-dkpulse", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Planning", count: "6", state: "queued", rate: "4/min", pct: "75%", dot: "var(--indigo)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Outline", count: "2", state: "active", rate: "2/min", pct: "50%", dot: "var(--indigo)", anim: "animate-dkpulse", bg: "var(--tint)", bd: "rgba(99,102,241,0.3)", arrow: "block" },
    { name: "Writing", count: "3", state: "active", rate: "1/min", pct: "85%", dot: "var(--indigo)", anim: "animate-dkpulse", bg: "var(--tint)", bd: "rgba(99,102,241,0.3)", arrow: "block" },
    { name: "Image", count: "1", state: "active", rate: "3/min", pct: "40%", dot: "var(--sky)", anim: "animate-dkpulse", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Quality QA", count: "2", state: "evaluating", rate: "5/min", pct: "60%", dot: "var(--amber)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Publish", count: "14", state: "completed", rate: "daily 20", pct: "100%", dot: "var(--emerald)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "none" },
  ];

  const recentBlogs: BlogItem[] = [
    {
      title: "Next.js 15 Partial Prerendering: Production Architecture & Optimization",
      slug: "nextjs-15-partial-prerendering-production-guide",
      cat: "Frameworks",
      trend: "96.4",
      quality: "94",
      cost: "$0.24",
      status: "Published",
      words: "2,840",
      updated: "12m ago",
      qBg: "rgba(16,185,129,0.14)",
      qFg: "var(--emerald)",
      sBg: "rgba(16,185,129,0.12)",
      sFg: "var(--emerald)",
      sBd: "rgba(16,185,129,0.3)",
    },
    {
      title: "Rust vs Go in 2026: Microservices Benchmarks and Memory Safety Analysis",
      slug: "rust-vs-go-microservices-benchmarks-2026",
      cat: "Backend",
      trend: "91.8",
      quality: "84",
      cost: "$0.29",
      status: "Failed QA",
      words: "3,120",
      updated: "24m ago",
      qBg: "rgba(244,63,94,0.14)",
      qFg: "var(--rose)",
      sBg: "rgba(244,63,94,0.12)",
      sFg: "var(--rose)",
      sBd: "rgba(244,63,94,0.3)",
    },
    {
      title: "Bun 1.2 Native SQLite & Postgres Drivers: Low-Latency Database Layer",
      slug: "bun-1-2-native-sqlite-postgres-drivers",
      cat: "Runtime",
      trend: "88.2",
      quality: "92",
      cost: "$0.21",
      status: "Published",
      updated: "1h ago",
      qBg: "rgba(16,185,129,0.14)",
      qFg: "var(--emerald)",
      sBg: "rgba(16,185,129,0.12)",
      sFg: "var(--emerald)",
      sBd: "rgba(16,185,129,0.3)",
    },
    {
      title: "DeepSeek-V3 Open-Weights LLM: Self-Hosting Guide with Ollama & vLLM",
      slug: "deepseek-v3-open-weights-self-hosting-vllm",
      cat: "AI Tooling",
      trend: "98.5",
      quality: "96",
      cost: "$0.32",
      status: "Published",
      words: "3,400",
      updated: "2h ago",
      qBg: "rgba(16,185,129,0.14)",
      qFg: "var(--emerald)",
      sBg: "rgba(16,185,129,0.12)",
      sFg: "var(--emerald)",
      sBd: "rgba(16,185,129,0.3)",
    },
    {
      title: "Tailwind CSS v4 Engine Deep Dive: CSS-First Configuration & Oxide Compiler",
      slug: "tailwind-css-v4-engine-oxide-compiler-guide",
      cat: "CSS",
      trend: "85.0",
      quality: "91",
      cost: "$0.19",
      status: "Writing",
      updated: "In progress",
      qBg: "var(--card2)",
      qFg: "var(--fg2)",
      sBg: "rgba(99,102,241,0.12)",
      sFg: "var(--indigo)",
      sBd: "rgba(99,102,241,0.3)",
    },
    {
      title: "Docker Multi-Stage Builds for Node.js: Reducing Image Size from 1GB to 80MB",
      slug: "docker-multi-stage-builds-nodejs-optimization",
      cat: "DevOps",
      trend: "82.4",
      quality: "90",
      cost: "$0.22",
      status: "Published",
      updated: "4h ago",
      qBg: "rgba(16,185,129,0.14)",
      qFg: "var(--emerald)",
      sBg: "rgba(16,185,129,0.12)",
      sFg: "var(--emerald)",
      sBd: "rgba(16,185,129,0.3)",
    },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Page Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Executive Dashboard
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            Automated blog generation pipeline · Sat 01 Aug 2026 · cron{" "}
            <span className="font-mono text-[var(--fg2)]">0 */2 * * *</span>
          </p>
        </div>
        <div className="flex gap-[7px]">
          {["24h", "7d", "30d"].map((r) => (
            <button
              key={r}
              aria-label={`Time range ${r}`}
              onClick={() => setRange(r)}
              className={`h-[29px] px-[11px] rounded-[8px] border text-[11.5px] font-semibold transition-colors ${
                range === r
                  ? "border-[var(--indigo)] bg-[var(--tint)] text-[var(--indigo)]"
                  : "border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] hover:border-[var(--bd2)]"
              }`}
            >
              {r}
            </button>
          ))}
          <button
            aria-label="Export report"
            onClick={() => alert("Exported executive CSV report.")}
            className="h-[29px] px-[11px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)]"
          >
            Export
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[12px]">
        {metrics.map((m, idx) => (
          <MetricCard key={idx} {...m} />
        ))}
      </div>

      {/* Real-Time Worker Pipeline Flow */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="flex items-center gap-[10px] p-[12px_14px] border-b border-[var(--bd)]">
          <span className="text-[13px] font-bold text-[var(--fg)]">
            Real-time worker pipeline
          </span>
          <span className="font-mono text-[10px] font-medium p-[2px_6px] rounded-[6px] bg-[var(--card2)] text-[var(--mut)]">
            BullMQ · Redis
          </span>
          <span className="ml-auto text-[11px] text-[var(--mut)]">
            Updated 4s ago
          </span>
          <Link
            href="/dashboard/workers"
            className="h-[26px] px-[10px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--bd2)] transition-colors flex items-center"
          >
            Inspect queues
          </Link>
        </div>
        <div className="p-[16px_14px] flex items-stretch gap-0 overflow-x-auto">
          {stages.map((s, idx) => (
            <div key={idx} className="flex-1 min-w-[132px] flex items-center gap-0">
              <div
                className="flex-1 border rounded-[11px] p-[10px] transition-colors"
                style={{ borderColor: s.bd, background: s.bg }}
              >
                <div className="flex items-center gap-[6px]">
                  <span
                    className={`w-[6px] h-[6px] rounded-full ${s.anim}`}
                    style={{ background: s.dot }}
                  />
                  <span className="text-[11.5px] font-bold tracking-tight text-[var(--fg)]">
                    {s.name}
                  </span>
                </div>
                <div className="mt-[8px] h-[4px] rounded-[3px] bg-[var(--bd)] overflow-hidden">
                  <div
                    className="h-full rounded-[3px]"
                    style={{ width: s.pct, background: s.dot }}
                  />
                </div>
                <div className="mt-[7px] flex items-baseline justify-between">
                  <span className="font-mono text-[14px] font-semibold tracking-tight text-[var(--fg)]">
                    {s.count}
                  </span>
                  <span className="text-[9.5px] text-[var(--mut)]">{s.state}</span>
                </div>
                <div className="mt-[3px] text-[9.5px] text-[var(--faint)]">
                  {s.rate}
                </div>
              </div>

              {s.arrow === "block" && (
                <svg
                  width="22"
                  height="12"
                  viewBox="0 0 22 12"
                  fill="none"
                  stroke="var(--bd2)"
                  strokeWidth="1.6"
                  className="flex-none"
                >
                  <path
                    d="M1 6h14"
                    strokeDasharray="4 4"
                    className="animate-dkflow"
                  />
                  <path
                    d="M14 2.5L18.5 6 14 9.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Split Row: Recent Generations + Token Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[12px] items-start">
        {/* Recent Blogs Table */}
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
          <div className="flex items-center gap-[10px] p-[12px_14px] border-b border-[var(--bd)]">
            <span className="text-[13px] font-bold text-[var(--fg)]">
              Recent AI generations
            </span>
            <span className="ml-auto text-[11px] text-[var(--mut)]">
              Today · 14 runs
            </span>
            <Link
              href="/dashboard/blogs"
              className="h-[26px] px-[10px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--bd2)] flex items-center"
            >
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-[var(--card2)] text-[var(--mut)]">
                  <th className="text-left p-[8px_14px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                    Title
                  </th>
                  <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                    Category
                  </th>
                  <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                    Trend
                  </th>
                  <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                    Quality
                  </th>
                  <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                    Status
                  </th>
                  <th className="p-[8px_14px] border-b border-[var(--bd)]" />
                </tr>
              </thead>
              <tbody>
                {recentBlogs.map((b, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors"
                  >
                    <td className="p-[9px_14px] max-w-[290px]">
                      <div className="font-semibold text-[12px] leading-snug text-[var(--fg)] truncate">
                        {b.title}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--faint)] mt-[2px] truncate">
                        {b.slug}
                      </div>
                    </td>
                    <td className="p-[9px_8px]">
                      <span className="text-[10.5px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--card2)] text-[var(--fg2)] whitespace-nowrap">
                        {b.cat}
                      </span>
                    </td>
                    <td className="p-[9px_8px] text-right font-mono font-semibold text-[11.5px] text-[var(--fg2)]">
                      {b.trend}
                    </td>
                    <td className="p-[9px_8px] text-right">
                      <span
                        className="font-mono font-bold text-[11px] p-[2px_7px] rounded-[6px]"
                        style={{ background: b.qBg, color: b.qFg }}
                      >
                        {b.quality}
                      </span>
                    </td>
                    <td className="p-[9px_8px]">
                      <span
                        className="text-[10.5px] font-semibold p-[2.5px_8px] rounded-full border whitespace-nowrap"
                        style={{ background: b.sBg, color: b.sFg, borderColor: b.sBd }}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="p-[9px_14px] text-right">
                      <button
                        aria-label="Open blog detail"
                        onClick={() => onOpenBlogModal && onOpenBlogModal(b)}
                        className="h-[24px] px-[9px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-colors"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Token & Cost Analytics */}
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
          <div className="p-[12px_14px] border-b border-[var(--bd)]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-[var(--fg)]">
                Token & cost analytics
              </span>
              <span className="font-mono font-bold text-[13px] text-[var(--fg)]">
                $47.86
              </span>
            </div>
            <div className="flex gap-[12px] mt-[8px] flex-wrap">
              {[
                { name: "Gemini 2.5 Pro", val: "$31.40", color: "var(--indigo)" },
                { name: "Gemini 2.5 Flash", val: "$11.20", color: "var(--emerald)" },
                { name: "Imagen 4", val: "$5.26", color: "var(--amber)" },
              ].map((l, idx) => (
                <span key={idx} className="flex items-center gap-[5px] text-[10.5px] text-[var(--mut)]">
                  <span
                    className="w-[8px] h-[8px] rounded-[2px]"
                    style={{ background: l.color }}
                  />
                  {l.name}
                  <span className="font-mono font-semibold text-[10px] text-[var(--fg2)]">
                    {l.val}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <div className="p-[14px]">
            {/* Cost Analytics Bar Chart */}
            <div className="w-full h-[160px] flex items-end justify-between gap-[6px] pt-[10px] pb-[4px] border-b border-[var(--bd)]">
              {[
                { day: "Mon", pro: 60, flash: 25, img: 15 },
                { day: "Tue", pro: 75, flash: 30, img: 20 },
                { day: "Wed", pro: 50, flash: 20, img: 12 },
                { day: "Thu", pro: 90, flash: 40, img: 25 },
                { day: "Fri", pro: 110, flash: 45, img: 30 },
                { day: "Sat", pro: 85, flash: 35, img: 22 },
                { day: "Sun", pro: 95, flash: 38, img: 24 },
              ].map((bar, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full justify-end">
                  <div className="w-full max-w-[24px] flex flex-col gap-[2px]">
                    <div className="w-full rounded-[2px] bg-[var(--amber)]" style={{ height: `${bar.img}px` }} />
                    <div className="w-full rounded-[2px] bg-[var(--emerald)]" style={{ height: `${bar.flash}px` }} />
                    <div className="w-full rounded-[2px] bg-[var(--indigo)]" style={{ height: `${bar.pro}px` }} />
                  </div>
                  <span className="font-mono text-[9px] text-[var(--faint)]">{bar.day}</span>
                </div>
              ))}
            </div>

            {/* Quick Metrics Grid */}
            <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">
                  Input tokens
                </div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  8.42M
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">
                  Output tokens
                </div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  2.19M
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">
                  Cost / blog
                </div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  $0.244
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">
                  Imagen 4 calls
                </div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  58
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
