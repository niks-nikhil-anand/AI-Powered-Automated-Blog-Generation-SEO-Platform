"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownUp,
  CalendarClock,
  Check,
  ChevronDown,
  Filter,
  FolderKanban,
  ListFilter,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
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
import { blogInputSchema, CATEGORIES, slugifyTitle } from "./types";

type SubmissionRow = {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  status: string;
  priority: string;
  failureReason: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  processedAt: string | null;
  blog: { id: string; slug: string; status: string } | null;
  planStatus: string;
  outlineStatus: string;
  blogStatus: string | null;
  currentStage: string | null;
  specs: unknown;
};

type ContentPlanListResponse = {
  rows: SubmissionRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  statuses: { status: string; count: number }[];
  categories: string[];
};

type SortKey = "createdAt" | "title" | "category" | "status" | "priority" | "stage";
type SortDirection = "asc" | "desc";
type GroupKey = "none" | "status" | "category" | "priority";

const PAGE_SIZES = [10, 25, 50] as const;

const STATUS_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  PENDING: { bg: "rgba(148,163,184,0.16)", fg: "var(--mut)", bd: "rgba(148,163,184,0.28)" },
  PROCESSING: { bg: "rgba(99,102,241,0.14)", fg: "var(--indigo)", bd: "rgba(99,102,241,0.26)" },
  COMPLETED: { bg: "rgba(16,185,129,0.14)", fg: "var(--emerald)", bd: "rgba(16,185,129,0.26)" },
  FAILED: { bg: "rgba(244,63,94,0.14)", fg: "var(--rose)", bd: "rgba(244,63,94,0.26)" },
  CANCELLED: { bg: "rgba(245,158,11,0.14)", fg: "var(--amber)", bd: "rgba(245,158,11,0.26)" },
};

const JSON_PLACEHOLDER = `{
  "focusKeyword": "ai content planning",
  "primaryKeywords": ["content plan", "blog workflow"],
  "audience": "Marketing teams and editors",
  "searchIntent": "Help readers understand how to plan a blog before writing",
  "tone": "professional",
  "contentLength": 1800,
  "priority": "NORMAL",
  "outlineJson": {
    "sections": [
      { "heading": "Why content plans matter" },
      { "heading": "How to structure the workflow" }
    ]
  }
}`;

const inputClass =
  "w-full h-[34px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[12px] text-[var(--fg)] outline-none transition-colors focus:border-[var(--indigo)]";
const labelClass = "block text-[11px] font-semibold text-[var(--fg2)] mb-[5px]";

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusStyle(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
}

function groupValue(row: SubmissionRow, groupKey: GroupKey): string {
  if (groupKey === "category") return row.category ?? "Uncategorized";
  if (groupKey === "priority") return row.priority;
  if (groupKey === "status") return row.status;
  return "Content plans";
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-[4px] text-left text-[10px] font-bold uppercase tracking-wider transition-colors ${
        active ? "text-[var(--indigo)]" : "text-[var(--mut)] hover:text-[var(--fg)]"
      }`}
    >
      <span>{label}</span>
      <ArrowDownUp className={`size-[12px] ${active && direction === "asc" ? "rotate-180" : ""}`} />
    </button>
  );
}

function ContentPlanModal({
  open,
  mode,
  initialValues,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  initialValues?: { title: string; category: string; json: string };
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (data: { title: string; category: string; json: string; startNow: boolean }) => void;
}) {
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [category, setCategory] = useState(initialValues?.category ?? "");
  const [json, setJson] = useState(initialValues?.json ?? "");
  const [startNow, setStartNow] = useState(mode === "create");

  if (!open) return null;

  const handleJsonChange = (val: string) => {
    setJson(val);
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!title && typeof parsed.title === "string" && parsed.title.trim()) {
          setTitle(parsed.title.trim());
        }
        if (!category && typeof parsed.category === "string" && parsed.category.trim()) {
          setCategory(parsed.category.trim());
        }
      }
    } catch {
      // JSON still being typed/pasted
    }
  };

  const knownCategories = CATEGORIES.map((c) => c.value);
  const isCustomCategory = category && !knownCategories.includes(category as typeof knownCategories[number]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-[16px]">
      <div className="w-full max-w-[720px] rounded-[12px] border border-[var(--bd)] bg-[var(--card)] shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-[12px] border-b border-[var(--bd)] p-[14px_16px]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">
              {mode === "edit" ? "Update content plan" : "Create content plan"}
            </h2>
            <p className="mt-[2px] text-[11px] text-[var(--mut)]">Save a plan to the backlog without leaving this page.</p>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="inline-flex size-[30px] items-center justify-center rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] hover:border-[var(--bd2)]"
          >
            <X className="size-[15px]" />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ title, category, json, startNow });
          }}
          className="flex flex-col gap-[13px] p-[16px]"
        >
          <div className="grid grid-cols-1 gap-[12px] md:grid-cols-[1fr_190px]">
            <div>
              <label className={labelClass} htmlFor="content-plan-title">
                Blog title
              </label>
              <input
                id="content-plan-title"
                required
                minLength={10}
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. How to Build a Content Planning Workflow"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="content-plan-category">
                Category
              </label>
              <select
                id="content-plan-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className={inputClass}
              >
                <option value="">Select category</option>
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
                {isCustomCategory && <option value={category}>{category}</option>}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="content-plan-json">
              JSON field
            </label>
            <textarea
              id="content-plan-json"
              rows={13}
              spellCheck={false}
              value={json}
              onChange={(event) => handleJsonChange(event.target.value)}
              placeholder={JSON_PLACEHOLDER}
              className="w-full resize-y rounded-[8px] border border-[var(--bd)] bg-[var(--card)] p-[10px] font-mono text-[11.5px] leading-[1.55] text-[var(--fg)] outline-none transition-colors focus:border-[var(--indigo)]"
            />
            <p className="mt-[5px] text-[10.5px] text-[var(--mut)]">
              Optional. Add any valid content-plan fields such as keywords, outlineJson, audience, tone, priority, or sources.
            </p>
          </div>

          <label className="flex items-center gap-[8px] text-[11.5px] font-semibold text-[var(--fg2)] cursor-pointer">
            <input
              type="checkbox"
              checked={startNow}
              onChange={(e) => setStartNow(e.target.checked)}
              className="size-[14px] rounded border-[var(--bd)] text-[var(--indigo)] focus:ring-0"
            />
            <span>Start generation immediately (dispatch to workers now)</span>
          </label>

          {error && (
            <div className="rounded-[9px] border border-[rgba(244,63,94,0.28)] bg-[rgba(244,63,94,0.1)] p-[10px] text-[11.5px] text-[var(--rose)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-[8px] border-t border-[var(--bd)] pt-[13px]">
            <button
              type="button"
              onClick={onClose}
              className="h-[32px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[12px] text-[11.5px] font-semibold text-[var(--fg2)] hover:border-[var(--bd2)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-[32px] items-center gap-[6px] rounded-[8px] bg-[var(--indigo)] px-[13px] text-[11.5px] font-semibold text-white disabled:opacity-50"
            >
              <Check className="size-[13px]" />
              {saving ? (mode === "edit" ? "Updating..." : "Saving...") : mode === "edit" ? "Update plan" : "Save plan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeletePlanModal({
  row,
  deleting,
  onClose,
  onConfirm,
}: {
  row: SubmissionRow | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!row) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-[16px]">
      <div className="w-full max-w-[460px] rounded-[12px] border border-[var(--bd)] bg-[var(--card)] shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-[12px] border-b border-[var(--bd)] p-[14px_16px]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Delete content plan</h2>
            <p className="mt-[2px] text-[11px] text-[var(--mut)]">This removes the saved plan from the backlog.</p>
          </div>
          <button
            type="button"
            aria-label="Close delete confirmation"
            disabled={deleting}
            onClick={onClose}
            className="inline-flex size-[30px] items-center justify-center rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] hover:border-[var(--bd2)] disabled:opacity-50"
          >
            <X className="size-[15px]" />
          </button>
        </div>

        <div className="flex flex-col gap-[12px] p-[16px]">
          <div className="rounded-[9px] border border-[rgba(244,63,94,0.28)] bg-[rgba(244,63,94,0.08)] p-[11px]">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--rose)]">Plan</div>
            <div className="mt-[4px] text-[12.5px] font-semibold leading-snug text-[var(--fg)]">{row.title}</div>
            <div className="mt-[3px] truncate font-mono text-[10px] text-[var(--faint)]">{row.slug}</div>
          </div>
          <p className="text-[11.5px] leading-relaxed text-[var(--mut)]">
            Delete is allowed only before this submission has produced a blog. If a blog already exists, the API will keep it and show an error.
          </p>
        </div>

        <div className="flex items-center justify-end gap-[8px] border-t border-[var(--bd)] p-[13px_16px]">
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            className="h-[32px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[12px] text-[11.5px] font-semibold text-[var(--fg2)] hover:border-[var(--bd2)] disabled:opacity-50"
          >
            Keep plan
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirm}
            className="inline-flex h-[32px] items-center gap-[6px] rounded-[8px] bg-[var(--rose)] px-[13px] text-[11.5px] font-semibold text-white disabled:opacity-50"
          >
            <Trash2 className="size-[13px]" />
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function editableJsonForRow(row: SubmissionRow): string {
  const specs = row.specs && typeof row.specs === "object" && !Array.isArray(row.specs) ? { ...(row.specs as Record<string, unknown>) } : {};
  delete specs.title;
  delete specs.slug;
  delete specs.category;
  delete specs.startNow;
  return JSON.stringify(specs, null, 2);
}

export default function NewBlogPage() {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusCounts, setStatusCounts] = useState<{ status: string; count: number }[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalVersion, setModalVersion] = useState(0);
  const [editTarget, setEditTarget] = useState<SubmissionRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubmissionRow | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [page, setPage] = useState(1);

  const loadRows = useCallback(() => {
    const params = new URLSearchParams({
      paged: "1",
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey === "stage" ? "createdAt" : sortKey,
      dir: sortDirection,
    });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);

    fetch(`/api/blogs/input?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ContentPlanListResponse) => {
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setTotalRows(Number.isFinite(data.total) ? data.total : 0);
        setTotalPages(Number.isFinite(data.totalPages) ? data.totalPages : 1);
        setStatusCounts(Array.isArray(data.statuses) ? data.statuses : []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      })
      .catch(() => {
        setRows([]);
        setTotalRows(0);
        setTotalPages(1);
      })
      .finally(() => setRowsLoading(false));
  }, [categoryFilter, page, pageSize, searchQuery, sortDirection, sortKey, statusFilter]);

  useEffect(() => {
    loadRows();
    const timer = window.setInterval(loadRows, 5000);
    return () => window.clearInterval(timer);
  }, [loadRows]);

  const currentPage = Math.min(page, totalPages);
  const pageRows = rows;

  const filterKey = `${searchQuery}|${statusFilter}|${categoryFilter}|${groupBy}|${sortKey}|${sortDirection}|${pageSize}`;
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
  if (filterKey !== previousFilterKey) {
    setPreviousFilterKey(filterKey);
    setPage(1);
  }

  const groupedPageRows = useMemo(() => {
    if (groupBy === "none") return [{ label: "Content plans", rows: pageRows }];
    const groups = new Map<string, SubmissionRow[]>();
    pageRows.forEach((row) => {
      const label = groupValue(row, groupBy);
      groups.set(label, [...(groups.get(label) ?? []), row]);
    });
    return Array.from(groups.entries()).map(([label, groupRows]) => ({ label, rows: groupRows }));
  }, [groupBy, pageRows]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "createdAt" ? "desc" : "asc");
    }
  };

  const submitPlan = async ({
    title,
    category,
    json,
    startNow,
  }: {
    title: string;
    category: string;
    json: string;
    startNow: boolean;
  }) => {
    setModalError(null);
    setNotice(null);

    let jsonData: Record<string, unknown> = {};
    if (json.trim()) {
      try {
        const parsed = JSON.parse(json);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          setModalError("JSON field must be an object.");
          return;
        }
        jsonData = parsed as Record<string, unknown>;
      } catch {
        setModalError("JSON field is not valid JSON.");
        return;
      }
    }

    const finalTitle = title.trim() || (typeof jsonData.title === "string" ? jsonData.title.trim() : "");
    const finalCategory = (category && category.trim()) || (typeof jsonData.category === "string" ? jsonData.category.trim() : undefined);

    const payload = {
      tone: "professional",
      contentLength: 2000,
      priority: "NORMAL",
      primaryKeywords: [],
      secondaryKeywords: [],
      ...jsonData,
      title: finalTitle,
      slug: typeof jsonData.slug === "string" ? jsonData.slug : slugifyTitle(finalTitle),
      category: finalCategory,
      startNow,
    };

    const parsed = blogInputSchema.safeParse(payload);
    if (!parsed.success) {
      setModalError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join(" · "));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(editTarget ? `/api/blogs/input/${editTarget.id}` : "/api/blogs/input", {
        method: editTarget ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        setModalError(result.error ?? (editTarget ? "Failed to update content plan" : "Failed to save content plan"));
        return;
      }
      setModalOpen(false);
      setEditTarget(null);
      setNotice(
        editTarget
          ? `Content plan updated with status ${result.status}.`
          : `Content plan ${startNow ? "queued and processing" : "saved to BlogInput"} with status ${result.status}.`
      );
      loadRows();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : editTarget ? "Failed to update content plan" : "Failed to save content plan");
    } finally {
      setSaving(false);
    }
  };

  const rowAction = async (id: string, action: "cancel" | "start" | "retry") => {
    setNotice(null);
    const response = await fetch(`/api/blogs/input/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json().catch(() => ({}));
    setNotice(response.ok ? `Plan ${action === "start" ? "started" : `${action}ed`}.` : data.error ?? `Failed to ${action} plan`);
    loadRows();
  };

  const deletePlan = async () => {
    if (!deleteTarget) return;
    setNotice(null);
    setDeletingId(deleteTarget.id);
    try {
      const response = await fetch(`/api/blogs/input/${deleteTarget.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      setNotice(response.ok ? "Content plan deleted." : data.error ?? "Failed to delete content plan");
      if (response.ok) setDeleteTarget(null);
      loadRows();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to delete content plan");
    } finally {
      setDeletingId(null);
    }
  };

  const planStats = {
    total: totalRows,
    pending: statusCounts.find((row) => row.status === "PENDING")?.count ?? 0,
    processing: statusCounts.find((row) => row.status === "PROCESSING")?.count ?? 0,
    failed: statusCounts.find((row) => row.status === "FAILED")?.count ?? 0,
  };
  const statuses = statusCounts.map((row) => row.status).sort();

  return (
    <div className="flex w-full flex-col gap-[13px]">
      <div className="flex flex-wrap items-end justify-between gap-[14px]">
        <div>
          <h1 className="text-[19px] font-extrabold tracking-tight text-[var(--fg)]">Content Plan</h1>
          <p className="mt-[3px] text-[12px] text-[var(--mut)]">
            {planStats.total} plans · {planStats.pending} backlog · {planStats.processing} in progress · {planStats.failed} need attention
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalError(null);
            setEditTarget(null);
            setModalVersion((version) => version + 1);
            setModalOpen(true);
          }}
          className="inline-flex h-[34px] items-center gap-[7px] rounded-[8px] bg-[var(--indigo)] px-[13px] text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          <Plus className="size-[14px]" />
          Add content plan
        </button>
      </div>

      <div className="grid grid-cols-1 gap-[10px] md:grid-cols-4">
        {[
          { label: "Total plans", value: planStats.total, icon: FolderKanban },
          { label: "Backlog", value: planStats.pending, icon: ListFilter },
          { label: "Running", value: planStats.processing, icon: CalendarClock },
          { label: "Failed", value: planStats.failed, icon: RefreshCcw },
        ].map((stat) => (
          <div key={stat.label} className="rounded-[10px] border border-[var(--bd)] bg-[var(--card)] p-[12px]">
            <div className="flex items-center justify-between gap-[8px] text-[11px] font-semibold text-[var(--mut)]">
              <span>{stat.label}</span>
              <stat.icon className="size-[14px]" />
            </div>
            <div className="mt-[8px] font-mono text-[22px] font-bold text-[var(--fg)]">{stat.value}</div>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-[12px] border border-[var(--bd)] bg-[var(--card)] shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center gap-[8px] border-b border-[var(--bd)] bg-[var(--card2)] p-[10px_12px]">
          <div className="flex h-[30px] min-w-[260px] flex-1 items-center gap-[7px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[10px] text-[var(--faint)]">
            <Search className="size-[13px]" />
            <input
              aria-label="Search content plans"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search title, slug, stage, category"
              className="w-full border-0 bg-transparent text-[11.5px] text-[var(--fg)] outline-none"
            />
          </div>

          <label className="inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[8px] text-[11.5px] font-semibold text-[var(--fg2)]">
            <Filter className="size-[13px]" />
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="bg-transparent outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[8px] text-[11.5px] font-semibold text-[var(--fg2)]">
            <ChevronDown className="size-[13px]" />
            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="bg-transparent outline-none"
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[8px] text-[11.5px] font-semibold text-[var(--fg2)]">
            Group
            <select
              aria-label="Group content plans"
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as GroupKey)}
              className="bg-transparent outline-none"
            >
              <option value="none">None</option>
              <option value="status">Status</option>
              <option value="category">Category</option>
              <option value="priority">Priority</option>
            </select>
          </label>
        </div>

        {notice && (
          <div className="border-b border-[var(--bd)] px-[12px] py-[9px] text-[11.5px] text-[var(--fg2)]">{notice}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--bd)] text-[var(--mut)]">
                <th className="p-[9px_12px] text-left">
                  <SortButton label="Plan" active={sortKey === "title"} direction={sortDirection} onClick={() => setSort("title")} />
                </th>
                <th className="p-[9px_8px] text-left">
                  <SortButton label="Category" active={sortKey === "category"} direction={sortDirection} onClick={() => setSort("category")} />
                </th>
                <th className="p-[9px_8px] text-left">
                  <SortButton label="Status" active={sortKey === "status"} direction={sortDirection} onClick={() => setSort("status")} />
                </th>
                <th className="p-[9px_8px] text-left">
                  <SortButton label="Stage" active={sortKey === "stage"} direction={sortDirection} onClick={() => setSort("stage")} />
                </th>
                <th className="p-[9px_8px] text-left">
                  <SortButton label="Priority" active={sortKey === "priority"} direction={sortDirection} onClick={() => setSort("priority")} />
                </th>
                <th className="p-[9px_8px] text-left">
                  <SortButton label="Created" active={sortKey === "createdAt"} direction={sortDirection} onClick={() => setSort("createdAt")} />
                </th>
                <th className="p-[9px_12px] text-right text-[10px] font-bold uppercase tracking-wider text-[var(--mut)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rowsLoading && rows.length === 0 ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index} className="border-b border-[var(--bd)]">
                    <td className="p-[10px_12px]">
                      <Skeleton className="h-[13px] w-[260px]" />
                      <Skeleton className="mt-[6px] h-[10px] w-[160px]" />
                    </td>
                    <td className="p-[10px_8px]">
                      <Skeleton className="h-[18px] w-[78px] rounded-[6px]" />
                    </td>
                    <td className="p-[10px_8px]">
                      <Skeleton className="h-[18px] w-[86px] rounded-full" />
                    </td>
                    <td className="p-[10px_8px]">
                      <Skeleton className="h-[12px] w-[110px]" />
                    </td>
                    <td className="p-[10px_8px]">
                      <Skeleton className="h-[12px] w-[54px]" />
                    </td>
                    <td className="p-[10px_8px]">
                      <Skeleton className="h-[12px] w-[88px]" />
                    </td>
                    <td className="p-[10px_12px]">
                      <Skeleton className="ml-auto h-[28px] w-[96px] rounded-[7px]" />
                    </td>
                  </tr>
                ))
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-[34px_12px] text-center text-[12px] text-[var(--mut)]">
                    No content plans match the current filters.
                  </td>
                </tr>
              ) : (
                groupedPageRows.map((group) => (
                  <React.Fragment key={group.label}>
                    {groupBy !== "none" && (
                      <tr className="border-b border-[var(--bd)] bg-[var(--card2)]">
                        <td colSpan={7} className="p-[7px_12px] text-[10.5px] font-bold uppercase tracking-wider text-[var(--fg2)]">
                          {group.label} · {group.rows.length}
                        </td>
                      </tr>
                    )}
                    {group.rows.map((row) => {
                      const style = statusStyle(row.status);
                      return (
                        <tr key={row.id} className="border-b border-[var(--bd)] transition-colors hover:bg-[var(--card2)]">
                          <td className="max-w-[360px] p-[10px_12px]">
                            <Link href={`/dashboard/blogs/input/${row.id}`} className="font-semibold leading-snug text-[var(--fg)] hover:underline">
                              {row.title}
                            </Link>
                            <div className="mt-[2px] truncate font-mono text-[10px] text-[var(--faint)]">{row.slug}</div>
                            {row.failureReason && (
                              <div className="mt-[4px] truncate text-[10.5px] text-[var(--rose)]">{row.failureReason}</div>
                            )}
                          </td>
                          <td className="p-[10px_8px]">
                            <span className="rounded-[6px] bg-[var(--card2)] px-[7px] py-[2px] text-[10.5px] font-semibold text-[var(--fg2)]">
                              {row.category ?? "Uncategorized"}
                            </span>
                          </td>
                          <td className="p-[10px_8px]">
                            <span
                              className="rounded-full border px-[8px] py-[2px] text-[10.5px] font-bold"
                              style={{ background: style.bg, color: style.fg, borderColor: style.bd }}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="p-[10px_8px] text-[11px] text-[var(--mut)]">
                            <div>{row.currentStage ?? "-"}</div>
                            <div className="mt-[2px] font-mono text-[9.5px] text-[var(--faint)]">
                              plan:{row.planStatus} · outline:{row.outlineStatus}
                            </div>
                          </td>
                          <td className="p-[10px_8px] font-mono text-[11px] text-[var(--fg2)]">{row.priority}</td>
                          <td className="p-[10px_8px] text-[11px] text-[var(--mut)] whitespace-nowrap">{formatDate(row.createdAt)}</td>
                          <td className="p-[10px_12px]">
                            <div className="flex justify-end gap-[6px]">
                              {row.status === "PENDING" && (
                                <button
                                  type="button"
                                  onClick={() => rowAction(row.id, "start")}
                                  className="h-[27px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] px-[9px] text-[11px] font-semibold text-[var(--fg2)] hover:border-[var(--indigo)] hover:text-[var(--indigo)]"
                                >
                                  Start
                                </button>
                              )}
                              {row.status === "FAILED" && (
                                <button
                                  type="button"
                                  onClick={() => rowAction(row.id, "retry")}
                                  className="h-[27px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] px-[9px] text-[11px] font-semibold text-[var(--fg2)] hover:border-[var(--indigo)] hover:text-[var(--indigo)]"
                                >
                                  Retry
                                </button>
                              )}
                              {["PENDING", "PROCESSING"].includes(row.status) && (
                                <button
                                  type="button"
                                  onClick={() => rowAction(row.id, "cancel")}
                                  className="h-[27px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] px-[9px] text-[11px] font-semibold text-[var(--rose)] hover:border-[var(--rose)]"
                                >
                                  Cancel
                                </button>
                              )}
                              <button
                                type="button"
                                aria-label={`Edit ${row.title}`}
                                title="Edit content plan"
                                onClick={() => {
                                  setModalError(null);
                                  setEditTarget(row);
                                  setModalVersion((version) => version + 1);
                                  setModalOpen(true);
                                }}
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] transition-colors hover:border-[var(--indigo)] hover:text-[var(--indigo)]"
                              >
                                <Pencil className="size-[13px]" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${row.title}`}
                                title="Delete content plan"
                                disabled={deletingId === row.id}
                                onClick={() => setDeleteTarget(row)}
                                className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--rose)] transition-colors hover:border-[var(--rose)] disabled:opacity-50"
                              >
                                <Trash2 className="size-[13px]" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[10px] border-t border-[var(--bd)] p-[9px_12px] text-[11px] text-[var(--mut)]">
          <div className="flex flex-wrap items-center gap-[9px]">
            <span>
              {totalRows > 0
                ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalRows)} of ${totalRows}`
                : "No rows"}{" "}
              · Page {currentPage} of {totalPages}
            </span>
            <label className="inline-flex items-center gap-[5px]">
              Rows
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number])}
                className="h-[26px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] px-[6px] text-[11px] text-[var(--fg2)] outline-none"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Pagination className="w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} />
              </PaginationItem>
              {getPaginationRange(currentPage, totalPages).map((entry, index) =>
                entry === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={entry}>
                    <PaginationLink isActive={entry === currentPage} onClick={() => setPage(entry)}>
                      {entry}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </section>

      <ContentPlanModal
        key={modalVersion}
        open={modalOpen}
        mode={editTarget ? "edit" : "create"}
        initialValues={
          editTarget
            ? {
                title: editTarget.title,
                category: editTarget.category ?? "",
                json: editableJsonForRow(editTarget),
              }
            : undefined
        }
        saving={saving}
        error={modalError}
        onClose={() => {
          setModalOpen(false);
          setEditTarget(null);
        }}
        onSubmit={submitPlan}
      />
      <DeletePlanModal
        row={deleteTarget}
        deleting={Boolean(deleteTarget && deletingId === deleteTarget.id)}
        onClose={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
        onConfirm={deletePlan}
      />
    </div>
  );
}
