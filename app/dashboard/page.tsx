"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MetricCard } from "../../components/ui/MetricCard";
import { BlogItem } from "../../components/shared/BlogDetailModal";

interface DashboardPageProps {
  onOpenBlogModal?: (blog: BlogItem) => void;
}

export default function ExecutiveDashboard({ onOpenBlogModal }: DashboardPageProps) {
  const [range, setRange] = useState("24h");
  const [recentBlogs, setRecentBlogs] = useState<BlogItem[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState({
    blogCount: 0,
    publishedCount: 0,
    failedCount: 0,
    todayPublishedCount: 0,
    successRate: 0,
    totalCost: 0,
    avgQuality: 0,
  });
  const [stageCounts, setStageCounts] = useState({
    research: 0,
    planning: 0,
    outline: 0,
    writing: 0,
    image: 0,
    quality: 0,
    publish: 0,
  });

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => {
        setDashboardMetrics(data.metrics);
        setStageCounts(data.stages);
        setRecentBlogs((data.blogs ?? []).slice(0, 6));
      })
      .catch(() => { });
  }, []);

  const metrics = [
    {
      label: "Daily Blogs",
      value: `${dashboardMetrics.todayPublishedCount} / 20`,
      suffix: "published",
      delta: "0 vs yest",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: `${Math.min(100, (dashboardMetrics.todayPublishedCount / 20) * 100)}%`,
      color: "var(--indigo)",
      foot: "Goal: 20 blogs / day",
    },
    {
      label: "Success Rate",
      value: `${dashboardMetrics.successRate}%`,
      suffix: "passed QA",
      delta: "No runs",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: `${dashboardMetrics.successRate}%`,
      color: "var(--emerald)",
      foot: `${dashboardMetrics.failedCount} failed articles`,
    },
    {
      label: "AI Cost Today",
      value: `$${dashboardMetrics.totalCost.toFixed(2)}`,
      suffix: "total",
      delta: "No spend",
      deltaBg: "rgba(99,102,241,0.12)",
      deltaFg: "var(--indigo)",
      pct: "0%",
      color: "var(--sky)",
      foot: "Avg $0.00 per post",
    },
    {
      label: "Quality Score",
      value: String(dashboardMetrics.avgQuality),
      suffix: "/100 avg",
      delta: "No scores",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: `${dashboardMetrics.avgQuality}%`,
      color: "var(--amber)",
      foot: `${dashboardMetrics.blogCount} total articles`,
    },
  ];

  const stages = [
    { name: "Research", count: String(stageCounts.research), state: stageCounts.research ? "ready" : "idle", rate: "topics", pct: `${Math.min(100, stageCounts.research * 5)}%`, dot: stageCounts.research ? "var(--emerald)" : "var(--mut)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Planning", count: String(stageCounts.planning), state: stageCounts.planning ? "planned" : "idle", rate: "plans", pct: `${Math.min(100, stageCounts.planning * 10)}%`, dot: stageCounts.planning ? "var(--indigo)" : "var(--mut)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Outline", count: String(stageCounts.outline), state: stageCounts.outline ? "outlined" : "idle", rate: "outlines", pct: `${Math.min(100, stageCounts.outline * 10)}%`, dot: stageCounts.outline ? "var(--indigo)" : "var(--mut)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Writing", count: String(stageCounts.writing), state: stageCounts.writing ? "drafted" : "idle", rate: "drafts", pct: `${Math.min(100, stageCounts.writing * 10)}%`, dot: stageCounts.writing ? "var(--indigo)" : "var(--mut)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Image", count: String(stageCounts.image), state: stageCounts.image ? "assets" : "idle", rate: "files", pct: `${Math.min(100, stageCounts.image * 10)}%`, dot: stageCounts.image ? "var(--sky)" : "var(--mut)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Quality QA", count: String(stageCounts.quality), state: stageCounts.quality ? "scored" : "idle", rate: "checks", pct: `${Math.min(100, stageCounts.quality * 10)}%`, dot: stageCounts.quality ? "var(--amber)" : "var(--mut)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "block" },
    { name: "Publish", count: String(stageCounts.publish), state: stageCounts.publish ? "published" : "idle", rate: "published", pct: `${Math.min(100, stageCounts.publish * 10)}%`, dot: stageCounts.publish ? "var(--emerald)" : "var(--mut)", anim: "none", bg: "var(--card2)", bd: "var(--bd)", arrow: "none" },
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
              className={`h-[29px] px-[11px] rounded-[8px] border text-[11.5px] font-semibold transition-colors ${range === r
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
            No active jobs
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
              Today · 0 runs
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
                {recentBlogs.length > 0 ? recentBlogs.map((b, idx) => (
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
                )) : (
                  <tr>
                    <td colSpan={6} className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
                      No recent generations yet.
                    </td>
                  </tr>
                )}
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
                $0.00
              </span>
            </div>
            <div className="flex gap-[12px] mt-[8px] flex-wrap">
              {[
                { name: "Gemini 2.5 Pro", val: "$0.00", color: "var(--indigo)" },
                { name: "Gemini 2.5 Flash", val: "$0.00", color: "var(--emerald)" },
                { name: "Imagen 4", val: "$0.00", color: "var(--amber)" },
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
                { day: "Mon", pro: 0, flash: 0, img: 0 },
                { day: "Tue", pro: 0, flash: 0, img: 0 },
                { day: "Wed", pro: 0, flash: 0, img: 0 },
                { day: "Thu", pro: 0, flash: 0, img: 0 },
                { day: "Fri", pro: 0, flash: 0, img: 0 },
                { day: "Sat", pro: 0, flash: 0, img: 0 },
                { day: "Sun", pro: 0, flash: 0, img: 0 },
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
                  0
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">
                  Output tokens
                </div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  0
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">
                  Cost / blog
                </div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  $0.00
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">
                  Imagen 4 calls
                </div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  0
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
