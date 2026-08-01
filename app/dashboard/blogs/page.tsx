"use client";

import React, { useState } from "react";
import { BlogItem } from "../../components/shared/BlogDetailModal";

interface BlogsPageProps {
  onOpenBlogModal?: (blog: BlogItem) => void;
}

export default function BlogManagementPage({ onOpenBlogModal }: BlogsPageProps) {
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const blogTabs = [
    { key: "all", label: "All articles", count: "0" },
    { key: "pipeline", label: "In Pipeline", count: "0" },
    { key: "published", label: "Published", count: "0" },
    { key: "drafts", label: "Drafts", count: "0" },
    { key: "failed", label: "Failed QA", count: "0" },
  ];

  const blogRows: (BlogItem & { words: string; cost: string })[] = [];

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(blogRows.map((r) => r.id!));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleRow = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const filteredRows = blogRows.filter((row) => {
    const matchesSearch =
      row.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      row.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = categoryFilter === "All categories" || row.cat === categoryFilter;
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "published" && row.status === "Published") ||
      (activeTab === "failed" && row.status === "Failed QA") ||
      (activeTab === "pipeline" && row.status === "Writing");
    return matchesSearch && matchesCat && matchesTab;
  });

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Blog Management & Pipeline
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            0 articles · 0 in pipeline · 0 failed QA gate
          </p>
        </div>
        <div className="flex gap-[7px]">
          <button
            aria-label="Publish selected"
            onClick={() => alert(`Publishing ${selectedIds.length} selected articles`)}
            className="h-[30px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--emerald)] hover:text-[var(--emerald)] transition-colors"
          >
            Publish selected
          </button>
          <button
            aria-label="Re-run QA on selected"
            onClick={() => alert(`Re-running QA on ${selectedIds.length} selected articles`)}
            className="h-[30px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] transition-colors"
          >
            Re-run QA
          </button>
          <button
            aria-label="Delete selected"
            onClick={() => alert(`Deleted ${selectedIds.length} selected articles`)}
            className="h-[30px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--rose)] text-[11.5px] font-semibold hover:border-[var(--rose)] transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        {/* Status Tabs */}
        <div className="flex items-center gap-[4px] px-[12px] border-b border-[var(--bd)] overflow-x-auto">
          {blogTabs.map((tb) => {
            const isActive = activeTab === tb.key;
            return (
              <button
                key={tb.key}
                aria-label={`Filter blogs by ${tb.label}`}
                onClick={() => setActiveTab(tb.key)}
                className={`h-[38px] px-[12px] border-b-2 text-[12px] font-semibold whitespace-nowrap flex items-center gap-[6px] transition-colors ${
                  isActive
                    ? "border-[var(--indigo)] text-[var(--indigo)] font-bold"
                    : "border-transparent text-[var(--mut)] hover:text-[var(--fg)]"
                }`}
              >
                {tb.label}
                <span className="font-mono text-[10px] px-[5px] py-[1px] rounded-[5px] bg-[var(--card2)]">
                  {tb.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filter Controls Bar */}
        <div className="flex items-center gap-[8px] p-[10px_12px] border-b border-[var(--bd)] bg-[var(--card2)] flex-wrap">
          <div className="flex items-center gap-[7px] h-[29px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--faint)] min-w-[230px]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              id="input-blog-search"
              aria-label="Search blogs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, slug, keyword…"
              className="border-0 outline-none bg-transparent text-[var(--fg)] text-[11.5px] w-full"
            />
          </div>

          <select
            id="select-blog-category"
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-[29px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold outline-none"
          >
            <option>All categories</option>
            <option>Frameworks</option>
            <option>Backend</option>
            <option>Runtime</option>
            <option>AI Tooling</option>
            <option>DevOps</option>
            <option>TypeScript</option>
          </select>

          <span className="ml-auto text-[11px] text-[var(--mut)]">
            {selectedIds.length} selected · {filteredRows.length} rows
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] min-w-[920px]">
            <thead>
              <tr className="bg-[var(--card)] text-[var(--mut)]">
                <th className="w-[34px] p-[8px_0_8px_12px] border-b border-[var(--bd)]">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={selectedIds.length === blogRows.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Article
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Category
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Words
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Trend
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Quality
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Cost
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Status
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Updated
                </th>
                <th className="p-[8px_12px] border-b border-[var(--bd)]" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.length > 0 ? filteredRows.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors"
                >
                  <td className="p-[9px_0_9px_12px]">
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={selectedIds.includes(b.id!)}
                      onChange={() => handleToggleRow(b.id!)}
                    />
                  </td>
                  <td className="p-[9px_8px] max-w-[330px]">
                    <div className="font-semibold text-[12px] leading-snug text-[var(--fg)]">
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
                  <td className="p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--mut)]">
                    {b.words}
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
                  <td className="p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--mut)]">
                    {b.cost}
                  </td>
                  <td className="p-[9px_8px]">
                    <span
                      className="text-[10.5px] font-semibold p-[2.5px_8px] rounded-full border whitespace-nowrap"
                      style={{ background: b.sBg, color: b.sFg, borderColor: b.sBd }}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="p-[9px_8px] text-[11px] text-[var(--mut)] whitespace-nowrap">
                    {b.updated}
                  </td>
                  <td className="p-[9px_12px] text-right">
                    <button
                      aria-label="Open blog detail"
                      onClick={() => onOpenBlogModal && onOpenBlogModal(b)}
                      className="h-[24px] px-[9px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-colors"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={10} className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
                    No articles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination */}
        <div className="flex items-center justify-between p-[9px_12px] text-[11px] text-[var(--mut)] border-t border-[var(--bd)]">
          <span>Page 1 of 1</span>
          <div className="flex gap-[6px]">
            <button
              aria-label="Previous page"
              className="h-[26px] px-[10px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--faint)] text-[11px] font-semibold"
            >
              Prev
            </button>
            <button
              aria-label="Next page"
              className="h-[26px] px-[10px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--bd2)]"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
