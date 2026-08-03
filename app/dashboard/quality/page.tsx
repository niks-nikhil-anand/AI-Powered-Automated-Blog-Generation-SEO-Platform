"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { BlogDetailModal, BlogItem } from "@/components/shared/BlogDetailModal";
import { QualityFlowDiagram, type QualityFlowData } from "@/components/shared/QualityFlowDiagram";
import { DataTable } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPaginationRange } from "@/lib/utils";
import {
  META_DESCRIPTION_BUDGET,
  META_TITLE_BUDGET,
  checkJsonLd,
  keywordHitRatio,
  lengthStatus,
  lengthStatusColor,
} from "@/lib/seo";

const EXPLORER_PAGE_SIZE = 8;
const QUEUE_PAGE_SIZE = 6;

type QualityData = {
  avgQuality: number;
  failedCount: number;
  checkedCount: number;
  blocked: BlogItem[];
  regenerating: BlogItem[];
  reports: BlogItem[];
  distribution: { label: string; h: number; count: number; fill: string }[];
  checkRates: { name: string; value: string; color: string }[];
  avgAttemptsToPass: number;
  retryLimit: number;
  flow: QualityFlowData;
};

const EMPTY_FLOW: QualityFlowData = {
  writing: { active: 0, queued: 0, failed: 0 },
  quality: { active: 0, queued: 0, failed: 0 },
  publish: { active: 0, queued: 0, failed: 0, published: 0 },
  regenerating: 0,
  failed: 0,
};

const EMPTY_QUALITY: QualityData = {
  avgQuality: 0,
  failedCount: 0,
  checkedCount: 0,
  blocked: [],
  regenerating: [],
  reports: [],
  distribution: [],
  checkRates: [],
  avgAttemptsToPass: 1,
  retryLimit: 4,
  flow: EMPTY_FLOW,
};

export default function QualityAuditPage() {
  const [quality, setQuality] = useState<QualityData>(EMPTY_QUALITY);
  const [isLoading, setIsLoading] = useState(true);
  const [checkFilter, setCheckFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [queueTab, setQueueTab] = useState<"blocked" | "regenerating">("blocked");
  const [explorerPage, setExplorerPage] = useState(1);
  const [queuePage, setQueuePage] = useState(1);
  const [selectedBlog, setSelectedBlog] = useState<BlogItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"seo" | "quality">("quality");
  const [rowPending, setRowPending] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, { text: string; tone: "ok" | "error" }>>({});

  const refresh = () => {
    fetch("/api/dashboard", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.quality) setQuality({ ...EMPTY_QUALITY, ...data.quality });
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    let mounted = true;
    const load = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (mounted && data.quality) setQuality({ ...EMPTY_QUALITY, ...data.quality });
        })
        .catch(() => {})
        .finally(() => {
          if (mounted) setIsLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const openDetail = (blog: BlogItem, tab: "seo" | "quality" = "quality") => {
    setSelectedBlog(blog);
    setDetailTab(tab);
    setDetailOpen(true);
  };

  const setRowMessage = (id: string, text: string, tone: "ok" | "error") => {
    setRowMessages((current) => ({ ...current, [id]: { text, tone } }));
    window.setTimeout(() => {
      setRowMessages((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }, 6000);
  };

  const handleRegenerate = async (row: BlogItem) => {
    if (!row.id || rowPending) return;
    setRowPending(row.id);
    try {
      const res = await fetch(`/api/blogs/${row.id}/regenerate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to regenerate");
      setRowMessage(row.id, `Regeneration queued (attempt ${data.attempt}/${data.attemptLimit}).`, "ok");
      refresh();
    } catch (err) {
      setRowMessage(row.id, err instanceof Error ? err.message : "Failed to regenerate", "error");
    } finally {
      setRowPending(null);
    }
  };

  const handleOverride = async (row: BlogItem) => {
    if (!row.id || rowPending) return;
    const input = window.prompt(
      `Override the quality gate and publish "${row.title}" (score ${row.quality ?? 0}/100)? Enter a reason:`
    );
    if (!input || !input.trim()) return;
    setRowPending(row.id);
    try {
      const res = await fetch(`/api/blogs/${row.id}/override-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to publish");
      setRowMessage(row.id, "Published.", "ok");
      refresh();
    } catch (err) {
      setRowMessage(row.id, err instanceof Error ? err.message : "Failed to publish", "error");
    } finally {
      setRowPending(null);
    }
  };

  const qualityStats = [
    {
      label: "Median Quality",
      value: String(quality.avgQuality),
      foot: "target >= 90",
      color: quality.avgQuality >= 90 ? "var(--emerald)" : "var(--mut)",
    },
    {
      label: "Checked Articles",
      value: String(quality.checkedCount),
      foot: "SEO records",
      color: "var(--indigo)",
    },
    {
      label: "Regenerating",
      value: String(quality.regenerating.length),
      foot: `auto-retry, budget ${quality.retryLimit}`,
      color: quality.regenerating.length ? "var(--indigo)" : "var(--mut)",
    },
    {
      label: "Needs Action",
      value: String(quality.blocked.length),
      foot: "retry budget used",
      color: quality.blocked.length ? "var(--rose)" : "var(--mut)",
    },
  ];

  const checkRates = quality.checkRates.length > 0 ? quality.checkRates : [
    { name: "SEO Structure", value: "0%", color: "var(--mut)" },
    { name: "Content Completeness", value: "0%", color: "var(--mut)" },
    { name: "Readability", value: "0%", color: "var(--mut)" },
    { name: "Content Quality", value: "0%", color: "var(--mut)" },
    { name: "Keyword Optimization", value: "0%", color: "var(--mut)" },
    { name: "Technical SEO", value: "0%", color: "var(--mut)" },
    { name: "Formatting & UX", value: "0%", color: "var(--mut)" },
    { name: "Media Quality", value: "0%", color: "var(--mut)" },
    { name: "AI & Fact Quality", value: "0%", color: "var(--mut)" },
    { name: "Publishing Readiness", value: "0%", color: "var(--mut)" },
  ];
  const distribution = quality.distribution.length > 0 ? quality.distribution : [
    { label: "< 80", h: 0, count: 0, fill: "var(--rose)" },
    { label: "80-84", h: 0, count: 0, fill: "var(--rose)" },
    { label: "85-89", h: 0, count: 0, fill: "var(--amber)" },
    { label: "90-91", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "92-93", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "94-95", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "96-97", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "98-100", h: 0, count: 0, fill: "var(--emerald)" },
  ];

  const categories = useMemo(
    () => Array.from(new Set(quality.reports.map((row) => row.cat).filter(Boolean) as string[])).sort(),
    [quality.reports]
  );

  const explorerRows = useMemo(() => {
    return quality.reports.filter((row) => {
      const matchesCategory = categoryFilter === "All categories" || row.cat === categoryFilter;
      const matchesCheck =
        !checkFilter ||
        (row.qualityReport?.checks ?? []).some((check) => check.label === checkFilter && check.score < 9);
      return matchesCategory && matchesCheck;
    });
  }, [quality.reports, categoryFilter, checkFilter]);

  const explorerTotalPages = Math.max(1, Math.ceil(explorerRows.length / EXPLORER_PAGE_SIZE));
  const explorerCurrentPage = Math.min(explorerPage, explorerTotalPages);
  const explorerPageRows = explorerRows.slice(
    (explorerCurrentPage - 1) * EXPLORER_PAGE_SIZE,
    explorerCurrentPage * EXPLORER_PAGE_SIZE
  );

  // Render-time reset (not an effect) - setState-in-effect is a lint error
  // in this repo's config; see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const explorerFilterKey = `${categoryFilter}|${checkFilter}`;
  const [prevExplorerFilterKey, setPrevExplorerFilterKey] = useState(explorerFilterKey);
  if (explorerFilterKey !== prevExplorerFilterKey) {
    setPrevExplorerFilterKey(explorerFilterKey);
    setExplorerPage(1);
  }

  const queueRows = queueTab === "blocked" ? quality.blocked : quality.regenerating;
  const queueTotalPages = Math.max(1, Math.ceil(queueRows.length / QUEUE_PAGE_SIZE));
  const queueCurrentPage = Math.min(queuePage, queueTotalPages);
  const queuePageRows = queueRows.slice(
    (queueCurrentPage - 1) * QUEUE_PAGE_SIZE,
    queueCurrentPage * QUEUE_PAGE_SIZE
  );

  const [prevQueueTab, setPrevQueueTab] = useState(queueTab);
  if (queueTab !== prevQueueTab) {
    setPrevQueueTab(queueTab);
    setQueuePage(1);
  }

  const explorerColumns = [
    {
      key: "title",
      header: "Article",
      render: (row: BlogItem) => (
        <div className="min-w-0">
          <div className="font-semibold text-[12px] leading-snug text-[var(--fg)] truncate max-w-[260px]">
            {row.title}
          </div>
          <div className="font-mono text-[10px] text-[var(--faint)] truncate max-w-[260px]">{row.slug}</div>
        </div>
      ),
    },
    {
      key: "cat",
      header: "Category",
      render: (row: BlogItem) => (
        <span className="text-[10.5px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--card2)] text-[var(--fg2)] whitespace-nowrap">
          {row.cat || "General"}
        </span>
      ),
    },
    {
      key: "score",
      header: "Score",
      align: "right" as const,
      render: (row: BlogItem) => (
        <span
          className="font-mono font-bold text-[11px] p-[2px_7px] rounded-[6px]"
          style={{ background: row.qBg, color: row.qFg }}
        >
          {row.quality}
        </span>
      ),
    },
    {
      key: "metaTitle",
      header: "Meta Title",
      render: (row: BlogItem) => {
        const title = row.metaTitle || row.title;
        const status = lengthStatus(title.length, META_TITLE_BUDGET);
        return (
          <span className="font-mono text-[10.5px] font-semibold" style={{ color: lengthStatusColor(status) }}>
            {title.length}/{META_TITLE_BUDGET}
          </span>
        );
      },
    },
    {
      key: "metaDescription",
      header: "Meta Desc.",
      render: (row: BlogItem) => {
        const desc = row.metaDescription || "";
        const status = lengthStatus(desc.length, META_DESCRIPTION_BUDGET);
        return (
          <span className="font-mono text-[10.5px] font-semibold" style={{ color: lengthStatusColor(status) }}>
            {desc.length}/{META_DESCRIPTION_BUDGET}
          </span>
        );
      },
    },
    {
      key: "keywords",
      header: "Keywords",
      render: (row: BlogItem) => {
        const { hits, total } = keywordHitRatio(row.keywords ?? [], row.content ?? "");
        return (
          <span
            className="font-mono text-[10.5px] font-semibold"
            style={{ color: total === 0 ? "var(--mut)" : hits === total ? "var(--emerald)" : "var(--amber)" }}
          >
            {total === 0 ? "-" : `${hits}/${total}`}
          </span>
        );
      },
    },
    {
      key: "schema",
      header: "Schema",
      render: (row: BlogItem) => {
        const check = checkJsonLd(row.schema);
        return (
          <span
            className="text-[9.5px] font-bold px-[6px] py-[1.5px] rounded-[5px] whitespace-nowrap"
            style={{
              background: check.valid ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)",
              color: check.valid ? "var(--emerald)" : "var(--rose)",
            }}
          >
            {check.valid ? "Valid" : "Issues"}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row: BlogItem) => (
        <span
          className="text-[10.5px] font-semibold p-[2.5px_8px] rounded-full border whitespace-nowrap"
          style={{ background: row.sBg, color: row.sFg, borderColor: row.sBd }}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      render: (row: BlogItem) => (
        <button
          aria-label={`Open SEO detail for ${row.title}`}
          title="View SEO detail"
          onClick={(e) => {
            e.stopPropagation();
            openDetail(row, "seo");
          }}
          className="w-[26px] h-[26px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--indigo)] hover:border-[var(--indigo)] inline-flex items-center justify-center transition-colors"
        >
          <Eye size={12} />
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div>
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          Quality & SEO Audit Hub
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          Gate threshold: quality {" >= "} 90 · {quality.regenerating.length} auto-regenerating ·{" "}
          {quality.blocked.length} need manual action
        </p>
      </div>

      {/* Grid: Histogram + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-[12px] items-start">
        {/* Left column: histogram, then the worker flow diagram fills the
            leftover height under it instead of leaving dead space next to
            the taller 10-row check-rate card on the right. */}
        <div className="flex flex-col gap-[12px]">
          <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
            <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between">
              <span className="text-[13px] font-bold text-[var(--fg)]">
                Quality score distribution
              </span>
              <span className="text-[11px] text-[var(--mut)]">
                {quality.checkedCount} checked articles · median {quality.avgQuality}
              </span>
            </div>
            <div className="p-[14px]">
              <div className="w-full h-[180px] flex items-end justify-between gap-[6px] border-b border-[var(--bd)] pb-[6px] relative">
                <div className="absolute top-[20px] bottom-[26px] left-[70%] border-l-2 border-dashed border-[var(--rose)] z-10">
                  <span className="text-[9px] font-mono text-[var(--rose)] font-bold bg-[var(--card)] px-[3px] -ml-[20px] -mt-[14px] block">
                    Gate ≥ 90
                  </span>
                </div>

                {distribution.map((bar, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full justify-end">
                    <div
                      className="w-full rounded-[2px]"
                      style={{ height: `${bar.h}px`, background: bar.fill }}
                      title={`${bar.count} articles`}
                    />
                    <span className="font-mono text-[9px] text-[var(--faint)]">{bar.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <QualityFlowDiagram
            flow={quality.flow}
            avgAttemptsToPass={quality.avgAttemptsToPass}
            retryLimit={quality.retryLimit}
          />
        </div>

        {/* Stats + Pass Rates */}
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-2 gap-[12px]">
            {qualityStats.map((q, idx) => (
              <div
                key={idx}
                className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[12px] shadow-[var(--shadow)]"
              >
                <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                  {q.label}
                </div>
                <div
                  className="font-mono text-[22px] font-extrabold tracking-tight mt-[6px]"
                  style={{ color: q.color }}
                >
                  {q.value}
                </div>
                <div className="text-[10.5px] text-[var(--faint)] mt-[3px]">
                  {q.foot}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[13px] shadow-[var(--shadow)]">
            <div className="flex items-center justify-between mb-[10px]">
              <span className="text-[12.5px] font-bold text-[var(--fg)]">
                Check pass rates
              </span>
              {checkFilter && (
                <button
                  onClick={() => setCheckFilter(null)}
                  className="text-[10px] font-semibold text-[var(--indigo)] hover:underline"
                >
                  Clear filter
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-[8px]">
              {checkRates.map((c, idx) => {
                const active = checkFilter === c.name;
                return (
                  <button
                    key={idx}
                    onClick={() => setCheckFilter(active ? null : c.name)}
                    className={`text-left rounded-[9px] border p-[9px_10px] transition-colors ${
                      active
                        ? "border-[rgba(99,102,241,0.4)] bg-[var(--tint)]"
                        : "border-[var(--bd)] bg-[var(--card2)] hover:border-[var(--bd2)]"
                    }`}
                    title={`Filter the SEO explorer to articles failing "${c.name}"`}
                  >
                    <div className="text-[10px] font-semibold text-[var(--fg2)] truncate">
                      {c.name}
                    </div>
                    <div
                      className="font-mono text-[16px] font-extrabold tracking-tight mt-[3px]"
                      style={{ color: c.color }}
                    >
                      {c.value}
                    </div>
                    <div className="h-[4px] rounded-[3px] bg-[var(--card)] overflow-hidden mt-[6px]">
                      <div
                        className="h-full rounded-[3px]"
                        style={{ width: c.value, background: c.color }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* SEO Explorer */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between flex-wrap gap-[8px]">
          <div className="flex items-center gap-[10px]">
            <span className="text-[13px] font-bold text-[var(--fg)]">SEO detail explorer</span>
            <span className="font-mono text-[10px] font-semibold p-[2px_6px] rounded-[6px] bg-[var(--card2)] text-[var(--mut)]">
              {explorerRows.length} of {quality.reports.length} scored
            </span>
            {checkFilter && (
              <span className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--tint)] text-[var(--indigo)]">
                failing: {checkFilter}
              </span>
            )}
          </div>
          <Select value={categoryFilter} onValueChange={(val) => setCategoryFilter(val ?? "All categories")}>
            <SelectTrigger className="h-[28px] min-w-[130px] text-[11px] font-semibold border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] rounded-[8px] outline-none">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All categories">All categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading && quality.reports.length === 0 ? (
          <div>
            <div className="p-[8px_12px] border-b border-[var(--bd)] bg-[var(--card2)]">
              <Skeleton className="h-[10px] w-full max-w-[600px]" />
            </div>
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-[16px] p-[10px_14px] border-b border-[var(--bd)] last:border-b-0">
                <Skeleton className="h-[13px] flex-1 rounded-[4px]" />
                <Skeleton className="h-[16px] w-[64px] rounded-[6px]" />
                <Skeleton className="h-[16px] w-[40px] rounded-[5px]" />
                <Skeleton className="h-[12px] w-[48px]" />
                <Skeleton className="h-[12px] w-[48px]" />
                <Skeleton className="h-[12px] w-[36px]" />
                <Skeleton className="h-[16px] w-[54px] rounded-[6px]" />
              </div>
            ))}
          </div>
        ) : explorerPageRows.length > 0 ? (
          <DataTable
            columns={explorerColumns}
            data={explorerPageRows}
            onRowClick={(row) => openDetail(row as BlogItem, "seo")}
          />
        ) : (
          <div className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
            No scored articles match these filters.
          </div>
        )}

        {!isLoading && explorerRows.length > 0 && (
          <div className="flex items-center justify-between gap-[10px] flex-wrap p-[9px_12px] border-t border-[var(--bd)]">
            <span className="text-[11px] text-[var(--mut)]">
              Page {explorerCurrentPage} of {explorerTotalPages}
            </span>
            <Pagination className="justify-end w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={explorerCurrentPage === 1}
                    onClick={() => setExplorerPage((p) => Math.max(1, p - 1))}
                  />
                </PaginationItem>
                {getPaginationRange(explorerCurrentPage, explorerTotalPages).map((entry, idx) =>
                  entry === "ellipsis" ? (
                    <PaginationItem key={`e-${idx}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={entry}>
                      <PaginationLink isActive={entry === explorerCurrentPage} onClick={() => setExplorerPage(entry)}>
                        {entry}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    disabled={explorerCurrentPage === explorerTotalPages}
                    onClick={() => setExplorerPage((p) => Math.min(explorerTotalPages, p + 1))}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>

      {/* Queue: blocked (needs action) vs regenerating (auto-retry) */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center gap-[4px]">
          {[
            { key: "blocked" as const, label: "Needs manual action", count: quality.blocked.length },
            { key: "regenerating" as const, label: "Auto-regenerating", count: quality.regenerating.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setQueueTab(tab.key)}
              className={`h-[30px] px-[12px] rounded-[8px] text-[11.5px] font-semibold flex items-center gap-[6px] transition-colors ${
                queueTab === tab.key
                  ? "bg-[var(--tint)] text-[var(--indigo)]"
                  : "text-[var(--mut)] hover:text-[var(--fg)]"
              }`}
            >
              {tab.label}
              <span className="font-mono text-[10px] px-[5px] py-[1px] rounded-[5px] bg-[var(--card2)]">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col">
          {isLoading && quality.reports.length === 0 ? (
            Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-[12px] p-[11px_14px] border-b border-[var(--bd)] last:border-b-0">
                <Skeleton className="h-[15px] w-[36px]" />
                <Skeleton className="h-[13px] flex-1" />
                <Skeleton className="h-[26px] w-[80px] rounded-[8px]" />
              </div>
            ))
          ) : queuePageRows.length > 0 ? (
            queuePageRows.map((row) => {
              const reasons =
                row.qualityReport?.checks
                  ?.filter((check) => check.score < 9)
                  .slice(0, 3)
                  .map((check) => `${check.label}: ${check.score}/${check.maxScore}`) ??
                ["Quality score is below publishing threshold"];
              const attemptsUsed = row.workflow?.attempts.filter((a) => a.worker === "writing-worker").length ?? 0;
              const message = row.id ? rowMessages[row.id] : undefined;
              const pending = row.id === rowPending;
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-[12px] p-[11px_14px] border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors cursor-pointer last:border-b-0"
                  onClick={() => openDetail(row, "quality")}
                >
                  <div className="w-[46px] flex-none text-center">
                    <div className="font-mono text-[15px] font-extrabold" style={{ color: row.qFg ?? "var(--rose)" }}>
                      {row.quality}
                    </div>
                    <div className="text-[9px] text-[var(--faint)]">score</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-[var(--fg)] leading-snug">
                      {row.title}
                    </div>
                    <div className="flex gap-[6px] flex-wrap mt-[5px]">
                      {reasons.map((r, rIdx) => (
                        <span
                          key={rIdx}
                          className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[rgba(244,63,94,0.12)] text-[var(--rose)]"
                        >
                          {r}
                        </span>
                      ))}
                      {queueTab === "regenerating" && (
                        <span className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--tint)] text-[var(--indigo)]">
                          attempt {attemptsUsed}/{quality.retryLimit}
                        </span>
                      )}
                    </div>
                    {message && (
                      <div
                        className="mt-[5px] text-[10.5px] font-semibold"
                        style={{ color: message.tone === "ok" ? "var(--emerald)" : "var(--rose)" }}
                      >
                        {message.text}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-[7px] flex-none" onClick={(e) => e.stopPropagation()}>
                    <button
                      aria-label="Regenerate now"
                      disabled={pending}
                      onClick={() => handleRegenerate(row)}
                      className="h-[27px] px-[11px] rounded-[8px] border border-[var(--indigo)] bg-[var(--tint)] text-[var(--indigo)] text-[11px] font-semibold hover:bg-[var(--indigo)] hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {pending ? "Working…" : "Regenerate now"}
                    </button>
                    <button
                      aria-label="Manual override and publish"
                      disabled={pending}
                      onClick={() => handleOverride(row)}
                      className="h-[27px] px-[11px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--emerald)] hover:text-[var(--emerald)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Override & publish
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
              {queueTab === "blocked" ? "Nothing needs manual action right now." : "Nothing is auto-regenerating right now."}
            </div>
          )}
        </div>

        {!isLoading && queueRows.length > 0 && (
          <div className="flex items-center justify-between gap-[10px] flex-wrap p-[9px_12px] border-t border-[var(--bd)]">
            <span className="text-[11px] text-[var(--mut)]">
              Page {queueCurrentPage} of {queueTotalPages}
            </span>
            <Pagination className="justify-end w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={queueCurrentPage === 1}
                    onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                  />
                </PaginationItem>
                {getPaginationRange(queueCurrentPage, queueTotalPages).map((entry, idx) =>
                  entry === "ellipsis" ? (
                    <PaginationItem key={`e-${idx}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={entry}>
                      <PaginationLink isActive={entry === queueCurrentPage} onClick={() => setQueuePage(entry)}>
                        {entry}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    disabled={queueCurrentPage === queueTotalPages}
                    onClick={() => setQueuePage((p) => Math.min(queueTotalPages, p + 1))}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>

      <BlogDetailModal
        blog={selectedBlog}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        initialTab={detailTab}
        onActionComplete={refresh}
      />
    </div>
  );
}
