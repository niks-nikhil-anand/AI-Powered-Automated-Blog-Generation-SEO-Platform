"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MetricCard } from "../../components/ui/MetricCard";
import { BlogItem } from "../../components/shared/BlogDetailModal";

interface DashboardPageProps {
  onOpenBlogModal?: (blog: BlogItem) => void;
}

type StageKey = "research" | "planning" | "outline" | "writing" | "image" | "quality" | "publish";

type StageStatus = {
  total: number;
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  completed: number;
  state: "idle" | "running" | "queued" | "scheduled" | "failed" | "done";
  dot: string;
  anim: string;
};

const emptyStageStatus: Record<StageKey, StageStatus> = {
  research: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle", dot: "var(--mut)", anim: "none" },
  planning: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle", dot: "var(--mut)", anim: "none" },
  outline: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle", dot: "var(--mut)", anim: "none" },
  writing: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle", dot: "var(--mut)", anim: "none" },
  image: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle", dot: "var(--mut)", anim: "none" },
  quality: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle", dot: "var(--mut)", anim: "none" },
  publish: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle", dot: "var(--mut)", anim: "none" },
};

type ModelUsage = {
  model: string;
  cost: number;
  costLabel: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalTokensLabel: string;
  avgLatencyMs: number;
  sharePct: number;
  color: string;
};

type WorkerUsage = {
  worker: string;
  label: string;
  cost: number;
  costLabel: string;
  calls: number;
  totalTokens: number;
  totalTokensLabel: string;
  avgLatencyMs: number;
  sharePct: number;
  color: string;
};

type DailyUsage = {
  day: string;
  date: string;
  cost: number;
  costLabel: string;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  heightPct: number;
  models: { model: string; cost: number; color: string }[];
};

type Analytics = {
  cost: {
    today: number;
    todayLabel: string;
    yesterday: number;
    yesterdayLabel: string;
    deltaPct: number | null;
    week: number;
    weekLabel: string;
    perBlog: number;
    perBlogLabel: string;
    projectedMonth: number;
    projectedMonthLabel: string;
  };
  tokens: {
    prompt: number;
    promptLabel: string;
    completion: number;
    completionLabel: string;
    total: number;
    totalLabel: string;
    ratio: number;
    perBlog: number;
  };
  models: ModelUsage[];
  workers: WorkerUsage[];
  daily: DailyUsage[];
  maxDailyCost: number;
  calls: number;
  avgLatencyMs: number;
};

const emptyAnalytics: Analytics = {
  cost: {
    today: 0,
    todayLabel: "$0.00",
    yesterday: 0,
    yesterdayLabel: "$0.00",
    deltaPct: null,
    week: 0,
    weekLabel: "$0.00",
    perBlog: 0,
    perBlogLabel: "$0.00",
    projectedMonth: 0,
    projectedMonthLabel: "$0.00",
  },
  tokens: { prompt: 0, promptLabel: "0", completion: 0, completionLabel: "0", total: 0, totalLabel: "0", ratio: 0, perBlog: 0 },
  models: [],
  workers: [],
  daily: [],
  maxDailyCost: 0,
  calls: 0,
  avgLatencyMs: 0,
};

export default function ExecutiveDashboard({ onOpenBlogModal }: DashboardPageProps) {
  const [range, setRange] = useState("24h");
  const [recentBlogs, setRecentBlogs] = useState<BlogItem[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>(emptyAnalytics);
  const [dashboardMetrics, setDashboardMetrics] = useState({
    blogCount: 0,
    publishedCount: 0,
    failedCount: 0,
    todayPublishedCount: 0,
    successRate: 0,
    totalCost: 0,
    avgQuality: 0,
    costDeltaPct: null as number | null,
    avgCostPerBlog: 0,
    totalTokensToday: 0,
    aiCallsToday: 0,
    avgLatencyToday: 0,
    dailyTarget: 3,
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
  const [stageStatus, setStageStatus] = useState<Record<StageKey, StageStatus>>(emptyStageStatus);
  const [pipeline, setPipeline] = useState({
    active: 0,
    waiting: 0,
    delayed: 0,
    failed: 0,
    completed: 0,
    state: "idle",
  });

  useEffect(() => {
    let mounted = true;
    const loadDashboard = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (!mounted) return;
          setDashboardMetrics(data.metrics);
          setAnalytics(data.analytics ?? emptyAnalytics);
          setStageCounts(data.stages);
          setStageStatus({ ...emptyStageStatus, ...(data.stageStatus ?? {}) });
          setPipeline(data.pipeline ?? { active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0, state: "idle" });
          setRecentBlogs((data.blogs ?? []).slice(0, 6));
        })
        .catch(() => { });
    };
    loadDashboard();
    const timer = window.setInterval(loadDashboard, 3000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const dailyTarget = Math.max(1, dashboardMetrics.dailyTarget || 3);
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const metrics = [
    {
      label: "Daily Blogs",
      value: `${dashboardMetrics.todayPublishedCount} / ${dailyTarget}`,
      suffix: "published",
      delta: `${Math.round((dashboardMetrics.todayPublishedCount / dailyTarget) * 100)}% of goal`,
      deltaBg:
        dashboardMetrics.todayPublishedCount >= dailyTarget
          ? "rgba(16,185,129,0.12)"
          : "rgba(245,158,11,0.12)",
      deltaFg:
        dashboardMetrics.todayPublishedCount >= dailyTarget ? "var(--emerald)" : "var(--amber)",
      pct: `${Math.min(100, (dashboardMetrics.todayPublishedCount / dailyTarget) * 100)}%`,
      color: "var(--indigo)",
      foot: `Goal: ${dailyTarget} blogs / day · 3 research runs`,
    },
    {
      label: "Success Rate",
      value: `${dashboardMetrics.successRate}%`,
      suffix: "passed QA",
      delta: dashboardMetrics.blogCount > 0 ? `${dashboardMetrics.publishedCount}/${dashboardMetrics.blogCount}` : "No runs",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: `${dashboardMetrics.successRate}%`,
      color: "var(--emerald)",
      foot: `${dashboardMetrics.failedCount} failed articles`,
    },
    {
      label: "AI Cost Today",
      value: analytics.cost.todayLabel,
      suffix: `${analytics.calls} calls`,
      delta:
        analytics.cost.deltaPct === null
          ? "No baseline"
          : `${analytics.cost.deltaPct >= 0 ? "+" : ""}${analytics.cost.deltaPct}% vs yest`,
      deltaBg:
        analytics.cost.deltaPct !== null && analytics.cost.deltaPct > 0
          ? "rgba(244,63,94,0.12)"
          : "rgba(16,185,129,0.12)",
      deltaFg:
        analytics.cost.deltaPct !== null && analytics.cost.deltaPct > 0 ? "var(--rose)" : "var(--emerald)",
      pct: `${analytics.cost.week > 0 ? Math.min(100, Math.round((analytics.cost.today / analytics.cost.week) * 100)) : 0}%`,
      color: "var(--sky)",
      foot: `${analytics.cost.perBlogLabel} per post · ${analytics.cost.projectedMonthLabel}/mo projected`,
    },
    {
      label: "Quality Score",
      value: String(dashboardMetrics.avgQuality),
      suffix: "/100 avg",
      delta: analytics.tokens.perBlog > 0 ? `${analytics.tokens.perBlog.toLocaleString()} tok/post` : "No scores",
      deltaBg: "rgba(16,185,129,0.12)",
      deltaFg: "var(--emerald)",
      pct: `${dashboardMetrics.avgQuality}%`,
      color: "var(--amber)",
      foot: `${dashboardMetrics.blogCount} total articles`,
    },
  ];

  const stageMeta: { key: StageKey; name: string; rate: string; doneLabel: string; arrow: "block" | "none" }[] = [
    { key: "research", name: "Research", rate: "topics", doneLabel: "ready", arrow: "block" },
    { key: "planning", name: "Planning", rate: "plans", doneLabel: "planned", arrow: "block" },
    { key: "outline", name: "Outline", rate: "outlines", doneLabel: "outlined", arrow: "block" },
    { key: "writing", name: "Writing", rate: "drafts", doneLabel: "drafted", arrow: "block" },
    { key: "image", name: "Image", rate: "files", doneLabel: "assets", arrow: "block" },
    { key: "quality", name: "Quality QA", rate: "checks", doneLabel: "scored", arrow: "block" },
    { key: "publish", name: "Publish", rate: "published", doneLabel: "published", arrow: "none" },
  ];
  const stages = stageMeta.map((meta) => {
    const live = stageStatus[meta.key] ?? emptyStageStatus[meta.key];
    const backlog = live.waiting + live.delayed;
    const count = live.active > 0 ? live.active : backlog > 0 ? backlog : live.total ?? stageCounts[meta.key];
    const state = live.state === "done" ? meta.doneLabel : live.state;
    const pct = live.active > 0 || backlog > 0 ? "100%" : `${Math.min(100, (live.total || stageCounts[meta.key]) * 10)}%`;
    return {
      ...meta,
      count: String(count),
      state,
      pct,
      dot: live.dot,
      anim: live.anim,
      bg:
        live.state === "running"
          ? "rgba(99,102,241,0.14)"
          : live.state === "queued" || live.state === "scheduled"
            ? "rgba(245,158,11,0.12)"
            : live.state === "failed"
              ? "rgba(244,63,94,0.12)"
              : "var(--card2)",
      bd:
        live.state === "running"
          ? "rgba(99,102,241,0.45)"
          : live.state === "queued" || live.state === "scheduled"
            ? "rgba(245,158,11,0.42)"
            : live.state === "failed"
              ? "rgba(244,63,94,0.42)"
              : "var(--bd)",
    };
  });
  const pipelineText =
    pipeline.active > 0
        ? `${pipeline.active} active jobs`
        : pipeline.waiting + pipeline.delayed > 0
          ? `${pipeline.waiting + pipeline.delayed} queued jobs`
          : pipeline.failed > 0
            ? `${pipeline.failed} failed jobs`
            : "No active jobs";

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Page Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Executive Dashboard
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            Automated blog generation pipeline · {today} · research runs{" "}
            <span className="font-mono text-[var(--fg2)]">06:30 · 14:00 · 23:30 IST</span>
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
          <span
            className="ml-auto text-[11px] font-medium"
            style={{
              color:
                pipeline.active > 0
                  ? "var(--indigo)"
                  : pipeline.waiting + pipeline.delayed > 0
                    ? "var(--amber)"
                    : pipeline.failed > 0
                      ? "var(--rose)"
                      : "var(--mut)",
            }}
          >
            {pipelineText}
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
                    Tokens
                  </th>
                  <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                    Cost
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
                    <td className="p-[9px_8px] text-right font-mono text-[11px] text-[var(--fg2)]">
                      {b.tokens ?? "-"}
                    </td>
                    <td className="p-[9px_8px] text-right font-mono font-semibold text-[11px] text-[var(--fg2)]">
                      {b.cost ?? "$0.00"}
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
                    <td colSpan={7} className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
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
                Token &amp; cost analytics
              </span>
              <span className="font-mono font-bold text-[13px] text-[var(--fg)]">
                {analytics.cost.todayLabel}
              </span>
            </div>
            <div className="flex gap-[12px] mt-[8px] flex-wrap">
              {analytics.models.length > 0 ? (
                analytics.models.map((m) => (
                  <span key={m.model} className="flex items-center gap-[5px] text-[10.5px] text-[var(--mut)]">
                    <span className="w-[8px] h-[8px] rounded-[2px]" style={{ background: m.color }} />
                    {m.model}
                    <span className="font-mono font-semibold text-[10px] text-[var(--fg2)]">
                      {m.costLabel}
                    </span>
                  </span>
                ))
              ) : (
                <span className="text-[10.5px] text-[var(--faint)]">No model calls recorded today</span>
              )}
            </div>
          </div>
          <div className="p-[14px]">
            {/* 7-day stacked cost chart */}
            <div className="w-full h-[160px] flex items-end justify-between gap-[6px] pt-[10px] pb-[4px] border-b border-[var(--bd)]">
              {analytics.daily.map((bar) => (
                <div key={bar.date} className="flex-1 flex flex-col items-center gap-[4px] h-full justify-end group relative">
                  <div
                    className="w-full max-w-[24px] flex flex-col-reverse gap-[2px] justify-start"
                    style={{ height: `${Math.round((bar.heightPct / 100) * 120)}px` }}
                    title={`${bar.date}: ${bar.costLabel} · ${bar.calls} calls`}
                  >
                    {bar.models.length > 0 ? (
                      bar.models.map((segment) => (
                        <div
                          key={segment.model}
                          className="w-full rounded-[2px]"
                          style={{
                            background: segment.color,
                            height: `${bar.cost > 0 ? Math.max(2, (segment.cost / bar.cost) * 100) : 0}%`,
                          }}
                        />
                      ))
                    ) : (
                      <div className="w-full rounded-[2px] bg-[var(--bd)]" style={{ height: "2px" }} />
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-[var(--faint)]">{bar.day}</span>
                </div>
              ))}
            </div>

            {/* Real token + cost metrics */}
            <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">Input tokens</div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  {analytics.tokens.promptLabel}
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">Output tokens</div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  {analytics.tokens.completionLabel}
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">Cost / blog</div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  {analytics.cost.perBlogLabel}
                </div>
              </div>
              <div className="border border-[var(--bd)] rounded-[9px] p-[8px_10px] bg-[var(--card2)]">
                <div className="text-[10px] text-[var(--mut)] font-semibold">Avg latency</div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)] mt-[2px]">
                  {analytics.avgLatencyMs > 0 ? `${(analytics.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                </div>
              </div>
            </div>

            {/* Cost per worker */}
            <div className="mt-[12px]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--mut)] mb-[7px]">
                Spend by worker
              </div>
              {analytics.workers.length > 0 ? (
                <div className="flex flex-col gap-[6px]">
                  {analytics.workers.map((w) => (
                    <div key={w.worker} className="flex items-center gap-[8px]">
                      <span className="text-[10.5px] text-[var(--fg2)] w-[58px] shrink-0">{w.label}</span>
                      <div className="flex-1 h-[6px] rounded-[3px] bg-[var(--bd)] overflow-hidden">
                        <div
                          className="h-full rounded-[3px]"
                          style={{ width: `${w.sharePct}%`, background: w.color }}
                        />
                      </div>
                      <span className="font-mono text-[10px] font-semibold text-[var(--fg)] w-[52px] text-right">
                        {w.costLabel}
                      </span>
                      <span className="font-mono text-[9.5px] text-[var(--faint)] w-[40px] text-right">
                        {w.totalTokensLabel}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10.5px] text-[var(--faint)]">No worker spend recorded today</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Model Performance Table */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="flex items-center gap-[10px] p-[12px_14px] border-b border-[var(--bd)]">
          <span className="text-[13px] font-bold text-[var(--fg)]">Model performance</span>
          <span className="font-mono text-[10px] font-medium p-[2px_6px] rounded-[6px] bg-[var(--card2)] text-[var(--mut)]">
            Vertex AI · today
          </span>
          <span className="ml-auto text-[11px] text-[var(--mut)]">
            {analytics.tokens.totalLabel} tokens · {analytics.calls} calls
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[var(--card2)] text-[var(--mut)]">
                <th className="text-left p-[8px_14px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Model
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Calls
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Input
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Output
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Avg latency
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Share
                </th>
                <th className="text-right p-[8px_14px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {analytics.models.length > 0 ? (
                analytics.models.map((m) => (
                  <tr key={m.model} className="border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors">
                    <td className="p-[9px_14px]">
                      <span className="flex items-center gap-[7px]">
                        <span className="w-[8px] h-[8px] rounded-[2px]" style={{ background: m.color }} />
                        <span className="font-mono text-[11.5px] font-semibold text-[var(--fg)]">{m.model}</span>
                      </span>
                    </td>
                    <td className="p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--fg2)]">{m.calls}</td>
                    <td className="p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--fg2)]">
                      {m.promptTokens.toLocaleString()}
                    </td>
                    <td className="p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--fg2)]">
                      {m.completionTokens.toLocaleString()}
                    </td>
                    <td className="p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--fg2)]">
                      {m.avgLatencyMs > 0 ? `${(m.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                    </td>
                    <td className="p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--fg2)]">{m.sharePct}%</td>
                    <td className="p-[9px_14px] text-right font-mono text-[11.5px] font-bold text-[var(--fg)]">
                      {m.costLabel}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
                    No AI calls recorded today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
