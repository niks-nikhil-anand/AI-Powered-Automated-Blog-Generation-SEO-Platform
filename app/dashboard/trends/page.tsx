"use client";

import React, { useEffect, useState } from "react";
import { LayoutGrid, List, Eye } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { TrendDetailModal } from "@/components/shared/TrendDetailModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TrendsPageProps {
  onOpenManualTopic?: () => void;
}

export default function TrendResearchPage({ onOpenManualTopic }: TrendsPageProps) {
  const [activeFilter, setActiveFilter] = useState("All sources");
  const [selectedCategory, setSelectedCategory] = useState("All categories");
  const [sortBy, setSortBy] = useState("score-desc");
  const [groupBy, setGroupBy] = useState("none");
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [viewMode, setViewMode] = useState<"card" | "table">("table");
  const [selectedTrend, setSelectedTrend] = useState<TrendRow | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
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

  const categories = Array.from(new Set(trends.map((t) => t.cat).filter(Boolean))).sort();

  const filteredTrends = trends.filter((t) => {
    const matchesSource = activeFilter === "All sources" || t.source.toLowerCase().includes(activeFilter.toLowerCase());
    const matchesCategory = selectedCategory === "All categories" || t.cat === selectedCategory;
    return matchesSource && matchesCategory;
  });

  const sortedTrends = [...filteredTrends].sort((a, b) => {
    if (sortBy === "score-desc") {
      return Number(b.score) - Number(a.score);
    }
    if (sortBy === "score-asc") {
      return Number(a.score) - Number(b.score);
    }
    if (sortBy === "title-asc") {
      return a.title.localeCompare(b.title);
    }
    if (sortBy === "title-desc") {
      return b.title.localeCompare(a.title);
    }
    return 0;
  });

  const groups: { name: string; items: typeof sortedTrends }[] = [];
  if (groupBy === "none") {
    groups.push({ name: "", items: sortedTrends });
  } else if (groupBy === "source") {
    const sourceNames = Array.from(new Set(sortedTrends.map((t) => t.source))).sort();
    sourceNames.forEach((src) => {
      groups.push({
        name: src,
        items: sortedTrends.filter((t) => t.source === src),
      });
    });
  } else if (groupBy === "category") {
    const catNames = Array.from(new Set(sortedTrends.map((t) => t.cat))).sort();
    catNames.forEach((cat) => {
      groups.push({
        name: cat,
        items: sortedTrends.filter((t) => t.cat === cat),
      });
    });
  }

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

      {/* Filter Tabs & Selectors */}
      <div className="flex flex-wrap items-center justify-between gap-[10px] bg-[var(--card2)] border border-[var(--bd)] p-[8px_12px] rounded-[12px]">
        <div className="flex gap-[6px] flex-wrap items-center">
          {trendFilters.map((f, i) => {
            const isActive = activeFilter === f.label;
            return (
              <button
                key={i}
                aria-label="Filter trends"
                onClick={() => setActiveFilter(f.label)}
                className={`h-[26px] px-[10px] rounded-full border text-[11px] font-semibold transition-colors ${
                  isActive
                    ? "bg-[var(--tint)] text-[var(--indigo)] border-[rgba(99,102,241,0.3)]"
                    : "bg-[var(--card)] text-[var(--fg2)] border-[var(--bd)] hover:border-[var(--bd2)]"
                }`}
              >
                {f.label} ({f.count})
              </button>
            );
          })}
        </div>

        <div className="flex gap-[7px] items-center flex-wrap">
          {/* Category Filter */}
          <Select value={selectedCategory} onValueChange={(val) => setSelectedCategory(val ?? "All categories")}>
            <SelectTrigger className="h-[28px] min-w-[120px] text-[11px] font-semibold border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] rounded-[8px] outline-none">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--card)] border border-[var(--bd)] text-[var(--fg)]">
              <SelectItem value="All categories">All categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Group By Selector */}
          <Select value={groupBy} onValueChange={(val) => setGroupBy(val ?? "none")}>
            <SelectTrigger className="h-[28px] min-w-[110px] text-[11px] font-semibold border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] rounded-[8px] outline-none">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--card)] border border-[var(--bd)] text-[var(--fg)]">
              <SelectItem value="none">No Grouping</SelectItem>
              <SelectItem value="source">Group by Source</SelectItem>
              <SelectItem value="category">Group by Category</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort By Selector */}
          <Select value={sortBy} onValueChange={(val) => setSortBy(val ?? "score-desc")}>
            <SelectTrigger className="h-[28px] min-w-[120px] text-[11px] font-semibold border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] rounded-[8px] outline-none">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--card)] border border-[var(--bd)] text-[var(--fg)]">
              <SelectItem value="score-desc">Score: High to Low</SelectItem>
              <SelectItem value="score-asc">Score: Low to High</SelectItem>
              <SelectItem value="title-asc">Title: A to Z</SelectItem>
              <SelectItem value="title-desc">Title: Z to A</SelectItem>
            </SelectContent>
          </Select>

          {/* View Switcher */}
          <div className="flex bg-[var(--card)] border border-[var(--bd)] p-[2px] rounded-[8px] h-[28px] items-center">
            <button
              onClick={() => setViewMode("card")}
              className={`p-[3px_6px] rounded-[6px] transition-colors flex items-center gap-[3px] text-[10px] font-semibold ${
                viewMode === "card"
                  ? "bg-[var(--indigo)] text-white"
                  : "text-[var(--mut)] hover:text-[var(--fg)]"
              }`}
              title="Card View"
            >
              <LayoutGrid size={11} />
              Cards
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-[3px_6px] rounded-[6px] transition-colors flex items-center gap-[3px] text-[10px] font-semibold ${
                viewMode === "table"
                  ? "bg-[var(--indigo)] text-white"
                  : "text-[var(--mut)] hover:text-[var(--fg)]"
              }`}
              title="Table View"
            >
              <List size={11} />
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Columns Definition for Table View */}
      {(() => {
        const columns = [
          {
            key: "source",
            header: "Source",
            render: (row: TrendRow) => (
              <span className="text-[11.5px] font-semibold text-[var(--fg2)] flex items-center gap-[6px]">
                <span
                  className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center font-mono font-extrabold text-[8px] text-white"
                  style={{ background: row.srcColor }}
                >
                  {row.srcInitial}
                </span>
                {row.source}
              </span>
            )
          },
          {
            key: "title",
            header: "Topic / Title",
            render: (row: TrendRow) => (
              <span className="font-bold text-[var(--fg)] leading-snug">
                {row.title}
              </span>
            )
          },
          {
            key: "cat",
            header: "Category",
            render: (row: TrendRow) => (
              <span className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--card2)] text-[var(--fg2)]">
                {row.cat}
              </span>
            )
          },
          {
            key: "score",
            header: "Score",
            render: (row: TrendRow) => (
              <span
                className="font-mono text-[10.5px] font-bold px-[6px] py-[2px] rounded-[5px]"
                style={{ background: row.scoreBg, color: row.scoreFg }}
              >
                {row.score}%
              </span>
            )
          },
          {
            key: "volume",
            header: "Volume / Age",
            render: (row: TrendRow) => (
              <span className="text-[10.5px] text-[var(--mut)]">
                {row.volume}
              </span>
            )
          },
          {
            key: "rec",
            header: "Recommendation",
            render: (row: TrendRow) => (
              <span
                className="text-[10px] font-semibold px-[7px] py-[2.5px] rounded-[6px] whitespace-nowrap"
                style={{ background: row.recBg, color: row.recFg }}
              >
                {row.rec}
              </span>
            )
          },
          {
            key: "actions",
            header: "Actions",
            align: "right" as const,
            render: (row: TrendRow) => {
              const canApprove = Number(row.score) >= minWritingScore;
              return (
                <div className="flex gap-[6px] justify-end items-center">
                  {canApprove ? (
                    <button
                      aria-label="Approve topic and send to pipeline"
                      onClick={() => openApproveModal(row)}
                      className="h-[26px] px-[8px] rounded-[6px] border border-transparent bg-[var(--emerald)] text-white text-[10px] font-semibold hover:bg-[#059669] transition-colors whitespace-nowrap"
                    >
                      Approve
                    </button>
                  ) : (
                    <span className="h-[26px] px-[8px] rounded-[6px] border border-[rgba(244,63,94,0.25)] bg-[rgba(244,63,94,0.08)] text-[var(--rose)] text-[10px] font-semibold inline-flex items-center justify-center select-none whitespace-nowrap">
                      Low Score
                    </span>
                  )}
                  <button
                    aria-label="View trend details"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrend(row);
                      setIsDetailOpen(true);
                    }}
                    className="w-[26px] h-[26px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--indigo)] hover:border-[var(--indigo)] flex items-center justify-center transition-colors"
                    title="View Details"
                  >
                    <Eye size={12} />
                  </button>
                  <button
                    aria-label={`Delete trend ${row.title}`}
                    title="Delete trend"
                    onClick={() => {
                      setDeleteTarget(row);
                      setDeleteError("");
                    }}
                    className="w-[26px] h-[26px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] inline-flex items-center justify-center hover:border-[var(--rose)] hover:text-[var(--rose)] transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </div>
              );
            }
          }
        ];

        if (filteredTrends.length === 0) {
          return (
            <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[32px] text-center text-[12px] text-[var(--mut)] shadow-[var(--shadow)]">
              No trend signals found matching filters.
            </div>
          );
        }

        return (
          <div className="flex flex-col gap-[16px]">
            {groups.map((group, gIdx) => {
              if (group.items.length === 0) return null;
              return (
                <div key={gIdx} className="flex flex-col gap-[10px]">
                  {group.name && (
                    <h2 className="text-[12px] font-bold text-[var(--indigo)] mt-[6px] uppercase tracking-wider flex items-center gap-[6px]">
                      <span>{group.name}</span>
                      <span className="font-mono text-[10.5px] p-[1px_6px] rounded-full bg-[var(--tint)]">
                        {group.items.length}
                      </span>
                    </h2>
                  )}
                  {viewMode === "card" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[12px]">
                      {group.items.map((t, idx) => {
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
                                aria-label="View trend details"
                                onClick={() => {
                                  setSelectedTrend(t);
                                  setIsDetailOpen(true);
                                }}
                                className="w-[24px] h-[24px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] inline-flex items-center justify-center hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-colors"
                                title="View Details"
                              >
                                <Eye size={12} />
                              </button>
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
                              {canApprove ? (
                                <button
                                  aria-label="Approve topic and send to pipeline"
                                  onClick={() => openApproveModal(t)}
                                  className="flex-1 h-[28px] rounded-[8px] border border-transparent bg-[var(--emerald)] text-white text-[11px] font-semibold hover:bg-[#059669] transition-colors"
                                >
                                  Approve → Pipeline
                                </button>
                              ) : (
                                <span className="flex-1 h-[28px] rounded-[8px] border border-[rgba(244,63,94,0.25)] bg-[rgba(244,63,94,0.08)] text-[var(--rose)] text-[11px] font-semibold inline-flex items-center justify-center select-none text-center">
                                  Score too low
                                </span>
                              )}
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
                      })}
                    </div>
                  ) : (
                    <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
                      <DataTable
                        columns={columns}
                        data={group.items}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

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
              {/* Detailed Metadata Grid */}
              <div className="grid grid-cols-2 gap-[12px] rounded-[12px] border border-[var(--bd)] bg-[var(--card2)] p-[14px]">
                <div className="col-span-2">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[3px]">
                    Topic / Title
                  </span>
                  <span className="text-[13.5px] font-bold text-[var(--fg)] leading-snug">
                    {approveTarget.title}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[3px]">
                    Source
                  </span>
                  <span className="text-[11.5px] font-semibold text-[var(--fg2)] flex items-center gap-[6px]">
                    <span
                      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center font-mono font-extrabold text-[8px] text-white"
                      style={{ background: approveTarget.srcColor }}
                    >
                      {approveTarget.srcInitial}
                    </span>
                    {approveTarget.source}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[3px]">
                    Category
                  </span>
                  <span className="text-[11.5px] font-semibold text-[var(--fg2)]">
                    {approveTarget.cat}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[3px]">
                    Trend Score
                  </span>
                  <span
                    className="font-mono text-[10.5px] font-bold px-[6px] py-[2px] rounded-[5px] inline-block"
                    style={{ background: approveTarget.scoreBg, color: approveTarget.scoreFg }}
                  >
                    {approveTarget.score}%
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[3px]">
                    Volume / Age
                  </span>
                  <span className="text-[11.5px] font-medium text-[var(--fg2)]">
                    {approveTarget.volume}
                  </span>
                </div>

                {approveTarget.rec && (
                  <div className="col-span-2 border-t border-[var(--bd)] pt-[8px] mt-[4px]">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[3px]">
                      Recommendation
                    </span>
                    <span
                      className="text-[10px] font-semibold px-[7px] py-[2.5px] rounded-[6px] inline-block"
                      style={{ background: approveTarget.recBg, color: approveTarget.recFg }}
                    >
                      {approveTarget.rec}
                    </span>
                  </div>
                )}
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
            className="w-full max-w-[480px] bg-[var(--card)] border border-[var(--bd)] rounded-[16px] shadow-[var(--shadow)] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-[14px_16px] border-b border-[var(--bd)] flex items-center gap-[12px]">
              <div className="w-[34px] h-[34px] rounded-[10px] bg-[rgba(244,63,94,0.12)] text-[var(--rose)] flex items-center justify-center flex-none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-extrabold tracking-tight text-[var(--fg)]">
                  Delete trend signal
                </div>
                <div className="text-[11px] text-[var(--mut)] mt-[2px] leading-normal">
                  This removes the research topic and linked plan/outline.
                </div>
              </div>
              <button
                aria-label="Close delete modal"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="ml-auto w-[28px] h-[28px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] flex items-center justify-center hover:text-[var(--fg)] disabled:opacity-50 text-[10px]"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-[16px] flex flex-col gap-[12px]">
              <div className="border-l-[3.5px] border-[var(--rose)] bg-[var(--card2)] p-[12px_14px] rounded-[0_10px_10px_0] flex flex-col gap-[6px]">
                <div className="text-[13px] font-bold leading-snug text-[var(--fg)]">
                  {deleteTarget.title}
                </div>
                <div className="flex gap-[6px] flex-wrap items-center mt-[2px]">
                  <span className="text-[9.5px] font-semibold p-[2px_7px] rounded-[5px] bg-[var(--card)] border border-[var(--bd)] text-[var(--fg2)]">
                    {deleteTarget.source}
                  </span>
                  <span className="text-[9.5px] font-semibold p-[2px_7px] rounded-[5px] bg-[rgba(244,63,94,0.10)] border border-[rgba(244,63,94,0.2)] text-[var(--rose)]">
                    score {deleteTarget.score}
                  </span>
                </div>
              </div>

              {deleteError && (
                <div className="text-[11px] text-[var(--rose)] bg-[rgba(244,63,94,0.10)] border border-[rgba(244,63,94,0.25)] rounded-[9px] p-[9px_10px]">
                  {deleteError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-[12px_16px] border-t border-[var(--bd)] flex justify-end gap-[8px] bg-[var(--card2)]">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="h-[32px] px-[14px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[12px] font-semibold hover:border-[var(--bd2)] transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteTrend}
                className="h-[32px] px-[14px] rounded-[8px] border border-transparent bg-[var(--rose)] text-white text-[12px] font-bold hover:bg-rose-600 shadow-sm transition-colors disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Delete trend"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trend Detail Modal */}
      <TrendDetailModal
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedTrend(null);
        }}
        trend={selectedTrend}
        onApprove={openApproveModal}
        onSkip={(t) => alert(`Skipped topic "${t.title}"`)}
        onDelete={(t) => {
          setDeleteTarget(t);
          setDeleteError("");
        }}
        minWritingScore={minWritingScore}
      />
    </div>
  );
}
