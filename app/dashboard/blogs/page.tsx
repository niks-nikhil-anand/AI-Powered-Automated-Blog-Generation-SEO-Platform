"use client";

import React, { useEffect, useState } from "react";
import { BlogDetailModal, BlogItem } from "../../../components/shared/BlogDetailModal";
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
import { getPaginationRange } from "@/lib/utils";

const BLOGS_PAGE_SIZE = 10;

export default function BlogManagementPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [blogRows, setBlogRows] = useState<(BlogItem & { words: string; cost: string })[]>([]);
  const [selectedBlog, setSelectedBlog] = useState<BlogItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isLoadingBlogs, setIsLoadingBlogs] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    const loadBlogs = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (mounted) setBlogRows(data.blogRows ?? data.blogs ?? []);
        })
        .catch(() => {
          if (mounted) setBlogRows([]);
        })
        .finally(() => {
          if (mounted) setIsLoadingBlogs(false);
        });
    };
    loadBlogs();
    const timer = window.setInterval(loadBlogs, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const blogTabs = [
    { key: "all", label: "All articles", count: String(blogRows.length) },
    { key: "pipeline", label: "In Pipeline", count: String(blogRows.filter((row) => row.status === "Review").length) },
    { key: "published", label: "Published", count: String(blogRows.filter((row) => row.status === "Published").length) },
    { key: "drafts", label: "Drafts", count: String(blogRows.filter((row) => row.status === "Draft").length) },
    { key: "failed", label: "Failed QA", count: String(blogRows.filter((row) => row.status === "Failed QA").length) },
  ];
  const categories = Array.from(new Set(blogRows.map((row) => row.cat).filter(Boolean))).sort();

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredRows.map((r) => r.id!));
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

  const openBlogDetail = (blog: BlogItem) => {
    setSelectedBlog(blog);
    setDetailOpen(true);
  };

  const filteredRows = blogRows.filter((row) => {
    const matchesSearch =
      row.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      row.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (row.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCat = categoryFilter === "All categories" || row.cat === categoryFilter;
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "published" && row.status === "Published") ||
      (activeTab === "failed" && row.status === "Failed QA") ||
      (activeTab === "drafts" && row.status === "Draft") ||
      (activeTab === "pipeline" && row.status === "Review");
    return matchesSearch && matchesCat && matchesTab;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / BLOGS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * BLOGS_PAGE_SIZE,
    currentPage * BLOGS_PAGE_SIZE
  );

  // Render-time reset rather than an effect: setState-in-effect is a lint
  // error in this repo's config.
  const filterKey = `${activeTab}|${searchQuery}|${categoryFilter}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div className="flex flex-col gap-[12px] sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Blog Management & Pipeline
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            {blogRows.length} articles · {blogRows.filter((row) => row.status === "Review").length} in pipeline · {blogRows.filter((row) => row.status === "Failed QA").length} failed QA gate
          </p>
        </div>
        {selectedIds.length > 0 && (
        <div aria-label={`${selectedIds.length} selected articles`} className="flex w-full gap-[7px] sm:w-auto">
          <button
            aria-label="Publish selected"
            onClick={() => alert(`Publishing ${selectedIds.length} selected articles`)}
            className="h-[44px] flex-1 px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[11.5px] font-semibold text-[var(--fg2)] transition-colors hover:border-[var(--emerald)] hover:text-[var(--emerald)] sm:h-[34px] sm:flex-none"
          >
            Publish selected
          </button>
          <button
            aria-label="Re-run QA on selected"
            onClick={() => alert(`Re-running QA on ${selectedIds.length} selected articles`)}
            className="h-[44px] flex-1 px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[11.5px] font-semibold text-[var(--fg2)] transition-colors hover:border-[var(--bd2)] sm:h-[34px] sm:flex-none"
          >
            Re-run QA
          </button>
          <button
            aria-label="Delete selected"
            onClick={() => alert(`Deleted ${selectedIds.length} selected articles`)}
            className="h-[44px] flex-1 px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[11.5px] font-semibold text-[var(--rose)] transition-colors hover:border-[var(--rose)] sm:h-[34px] sm:flex-none"
          >
            Delete
          </button>
        </div>
        )}
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
                className={`h-[38px] px-[12px] border-b-2 text-[12px] font-semibold whitespace-nowrap flex items-center gap-[6px] transition-colors ${isActive
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
          <div className="flex h-[44px] w-full items-center gap-[7px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[10px] text-[var(--faint)] sm:h-[34px] sm:min-w-[230px] sm:flex-1">
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
            className="h-[44px] min-w-0 flex-1 rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[8px] text-[11.5px] font-semibold text-[var(--fg2)] outline-none sm:h-[34px] sm:flex-none"
          >
            <option>All categories</option>
            {categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>

          <span className="ml-auto whitespace-nowrap text-[11px] text-[var(--mut)]">
            {selectedIds.length} selected · {filteredRows.length} rows
          </span>
        </div>

        {/* Table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-[680px] w-full border-collapse text-[12px] min-[1200px]:min-w-[920px]">
            <thead>
              <tr className="bg-[var(--card)] text-[var(--mut)]">
                <th className="w-[34px] p-[8px_0_8px_12px] border-b border-[var(--bd)]">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={filteredRows.length > 0 && selectedIds.length === filteredRows.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Article
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Category
                </th>
                <th className="hidden min-[1200px]:table-cell text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Words
                </th>
                <th className="hidden min-[1200px]:table-cell text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
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
              {isLoadingBlogs && blogRows.length === 0 ? (
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx} className="border-b border-[var(--bd)]">
                    <td className="p-[9px_0_9px_12px]">
                      <Skeleton className="h-[13px] w-[13px] rounded-[3px]" />
                    </td>
                    <td className="p-[9px_8px]">
                      <Skeleton className="h-[13px] w-[220px]" />
                      <Skeleton className="h-[10px] w-[140px] mt-[6px]" />
                    </td>
                    <td className="p-[9px_8px]">
                      <Skeleton className="h-[16px] w-[70px] rounded-[6px]" />
                    </td>
                    <td className="p-[9px_8px] text-right">
                      <Skeleton className="h-[12px] w-[40px] ml-auto" />
                    </td>
                    <td className="p-[9px_8px] text-right">
                      <Skeleton className="h-[16px] w-[40px] ml-auto rounded-[6px]" />
                    </td>
                    <td className="p-[9px_8px] text-right">
                      <Skeleton className="h-[12px] w-[36px] ml-auto" />
                    </td>
                    <td className="p-[9px_8px]">
                      <Skeleton className="h-[16px] w-[64px] rounded-full" />
                    </td>
                    <td className="p-[9px_8px]">
                      <Skeleton className="h-[12px] w-[56px]" />
                    </td>
                    <td className="p-[9px_12px] text-right">
                      <Skeleton className="h-[28px] w-[28px] rounded-[7px] ml-auto" />
                    </td>
                  </tr>
                ))
              ) : pageRows.length > 0 ? pageRows.map((b) => (
                <tr
                  key={b.id}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button, input, a, select, textarea, label")) return;
                    openBlogDetail(b);
                  }}
                  className="cursor-pointer border-b border-[var(--bd)] hover:bg-[var(--card2)] focus-within:bg-[var(--card2)] transition-colors"
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
                    <button
                      type="button"
                      aria-label={`View details for ${b.title}`}
                      aria-haspopup="dialog"
                      onClick={() => openBlogDetail(b)}
                      className="cursor-pointer rounded-sm text-left font-semibold text-[12px] leading-snug text-[var(--fg)] hover:text-[var(--indigo)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--indigo)]"
                    >
                      {b.title}
                    </button>
                    <div className="font-mono text-[10px] text-[var(--faint)] mt-[2px] truncate">
                      {b.slug}
                    </div>
                  </td>
                  <td className="p-[9px_8px]">
                    <span className="text-[10.5px] font-semibold p-[2px_7px] rounded-[6px] bg-[var(--card2)] text-[var(--fg2)] whitespace-nowrap">
                      {b.cat}
                    </span>
                  </td>
                  <td className="hidden min-[1200px]:table-cell p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--mut)]">
                    {b.words}
                  </td>
                  <td className="p-[9px_8px] text-right">
                    <span
                      className="font-mono font-bold text-[11px] p-[2px_7px] rounded-[6px]"
                      style={{ background: b.qBg, color: b.qFg }}
                    >
                      {b.quality}
                    </span>
                  </td>
                  <td className="hidden min-[1200px]:table-cell p-[9px_8px] text-right font-mono text-[11.5px] text-[var(--mut)]">
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
                      aria-label={`Open details for ${b.title}`}
                      title="View details"
                      onClick={() => openBlogDetail(b)}
                      className="w-[28px] h-[28px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] inline-flex items-center justify-center hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-colors"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={9} className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
                    No articles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-[var(--bd)] md:hidden">
          {isLoadingBlogs && blogRows.length === 0 ? (
            Array.from({ length: 4 }).map((_, index) => <div key={index} className="p-4"><Skeleton className="h-5 w-4/5" /><Skeleton className="mt-3 h-4 w-full" /></div>)
          ) : pageRows.length > 0 ? pageRows.map((blog) => (
            <article
              key={blog.id}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button, input, a, select, textarea, label")) return;
                openBlogDetail(blog);
              }}
              className="cursor-pointer p-4 transition-colors hover:bg-[var(--card2)]"
            >
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label={`Select ${blog.title}`} checked={selectedIds.includes(blog.id!)} onChange={() => handleToggleRow(blog.id!)} className="mt-1 size-5" />
                <div className="min-w-0 flex-1">
                  <button type="button" aria-haspopup="dialog" onClick={() => openBlogDetail(blog)} className="text-left text-[14px] font-semibold leading-snug text-[var(--fg)]">{blog.title}</button>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--faint)]">{blog.slug}</p>
                </div>
                <span className="shrink-0 rounded-full border px-2 py-1 text-[10.5px] font-semibold" style={{ background: blog.sBg, color: blog.sFg, borderColor: blog.sBd }}>{blog.status}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--mut)]">
                <span>Category <strong className="ml-1 font-semibold text-[var(--fg2)]">{blog.cat}</strong></span>
                <span>Updated <strong className="ml-1 font-semibold text-[var(--fg2)]">{blog.updated}</strong></span>
                <span>Words <strong className="ml-1 font-mono text-[var(--fg2)]">{blog.words}</strong></span>
                <span>Quality <strong className="ml-1 font-mono text-[var(--fg2)]">{blog.quality}</strong></span>
              </div>
            </article>
          )) : <p className="p-8 text-center text-[12px] text-[var(--mut)]">No articles yet.</p>}
        </div>

        {/* Footer Pagination */}
        <div className="flex items-center justify-between gap-[10px] flex-wrap p-[9px_12px] text-[11px] text-[var(--mut)] border-t border-[var(--bd)]">
          <span>
            {filteredRows.length > 0
              ? `Showing ${(currentPage - 1) * BLOGS_PAGE_SIZE + 1}–${Math.min(currentPage * BLOGS_PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`
              : "No rows"}{" "}
            · Page {currentPage} of {totalPages}
          </span>
          <Pagination className="justify-end w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={currentPage === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                />
              </PaginationItem>
              {getPaginationRange(currentPage, totalPages).map((entry, idx) =>
                entry === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${idx}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={entry}>
                    <PaginationLink
                      isActive={entry === currentPage}
                      onClick={() => setPage(entry)}
                    >
                      {entry}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  disabled={currentPage === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>
      <BlogDetailModal
        blog={selectedBlog}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
