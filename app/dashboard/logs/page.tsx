"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LogRow = {
  id: string;
  timestamp: string;
  level: string;
  worker: string | null;
  message: string;
  stack: string | null;
  meta: unknown;
  workflowRunId: string | null;
  trendId: string | null;
  blogId: string | null;
};

type Filters = {
  /** Uppercase level codes. Empty = no filter (show every level). */
  levels: string[];
  worker: string;
  range: string;
  /** Debounced - see searchInput below for the raw, per-keystroke value. */
  q: string;
};

const DEFAULT_FILTERS: Filters = { levels: [], worker: "all", range: "1h", q: "" };

const LEVELS = ["ERROR", "WARN", "INFO", "DEBUG"] as const;

const LEVEL_STYLES: Record<string, { fg: string; bg: string; bd: string }> = {
  ERROR: { fg: "var(--rose)", bg: "rgba(244,63,94,0.12)", bd: "rgba(244,63,94,0.32)" },
  WARN: { fg: "var(--amber)", bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.32)" },
  INFO: { fg: "var(--indigo)", bg: "rgba(99,102,241,0.12)", bd: "rgba(99,102,241,0.32)" },
  DEBUG: { fg: "var(--mut)", bg: "var(--card2)", bd: "var(--bd)" },
};

/** Every value logger.child({ worker: "..." }) is actually called with, plus the one non-worker writer (manual-override). */
const WORKERS = [
  "research-worker",
  "planning-worker",
  "outline-worker",
  "writing-worker",
  "image-worker",
  "quality-worker",
  "publish-worker",
  "manual-override",
  "start",
];

const RANGES: { value: string; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "3h", label: "3h" },
  { value: "24h", label: "24h" },
  { value: "3d", label: "3d" },
  { value: "7d", label: "7d" },
  { value: "all", label: "All" },
];

const AUTO_REFRESH_MS = 5000;

function buildSearchParams(filters: Filters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.levels.length > 0) params.set("level", filters.levels.join(","));
  if (filters.worker !== "all") params.set("worker", filters.worker);
  if (filters.range !== "all") params.set("range", filters.range);
  if (filters.q) params.set("q", filters.q);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", "50");
  return params;
}

/** Same filters, minus cursor/limit - used to sync the address bar so a filtered view is bookmarkable/shareable. */
function urlForFilters(filters: Filters): string {
  const params = buildSearchParams(filters);
  params.delete("limit");
  const qs = params.toString();
  return qs ? `/dashboard/logs?${qs}` : "/dashboard/logs";
}

function readInitialFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const levels = (params.get("level") ?? "")
    .split(",")
    .map((l) => l.trim().toUpperCase())
    .filter(Boolean);
  return {
    levels,
    worker: params.get("worker") ?? DEFAULT_FILTERS.worker,
    range: params.get("range") ?? DEFAULT_FILTERS.range,
    q: params.get("q") ?? "",
  };
}

async function fetchLogs(filters: Filters, cursor?: string): Promise<{ logs: LogRow[]; nextCursor: string | null }> {
  const params = buildSearchParams(filters, cursor);
  const res = await fetch(`/api/logs?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function SystemLogsPage() {
  // Always starts from DEFAULT_FILTERS (not readInitialFilters()) so the
  // first client render matches the server-rendered HTML exactly - reading
  // window.location.search here directly caused a hydration mismatch, since
  // SSR always sees no window and would render the "server" branch while
  // the client's first render read the real URL and rendered differently.
  // The actual URL is applied in the mount-only effect below instead, which
  // only ever runs client-side, after hydration has already matched.
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedLog, setSelectedLog] = useState<LogRow | null>(null);
  const logsRef = useRef<LogRow[]>([]);
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  // Apply the real URL's filters once, right after mount (client-only).
  // Deferred to a microtask for the same reason as the fetch effect below -
  // not a direct synchronous setState call in the effect body.
  useEffect(() => {
    const initial = readInitialFilters();
    queueMicrotask(() => {
      setSearchInput(initial.q);
      setFilters((current) => {
        const unchanged =
          initial.worker === current.worker &&
          initial.range === current.range &&
          initial.q === current.q &&
          initial.levels.join(",") === current.levels.join(",");
        return unchanged ? current : initial;
      });
    });
  }, []);

  // Debounce free-text input into filters.q, which is what actually drives fetching/the URL.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === filters.q) return;
    const timer = window.setTimeout(() => {
      setFilters((current) => ({ ...current, q: trimmed }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput, filters.q]);

  // Fresh load whenever a filter changes; also keeps the address bar in sync.
  useEffect(() => {
    let mounted = true;
    // Deferred a microtask out so this isn't a direct synchronous setState
    // call in the effect body (react-hooks/set-state-in-effect) - genuinely
    // defers past the effect's own commit, not just a lint workaround.
    queueMicrotask(() => {
      if (mounted) {
        setLoading(true);
        setError(null);
      }
    });
    fetchLogs(filters)
      .then(({ logs: rows, nextCursor: cursor }) => {
        if (!mounted) return;
        setLogs(rows);
        setNextCursor(cursor);
      })
      .catch(() => {
        if (mounted) setError("Failed to load logs.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    window.history.replaceState(null, "", urlForFilters(filters));
    return () => {
      mounted = false;
    };
  }, [filters]);

  // Auto-refresh merges newly-arrived rows at the top; it never touches rows
  // already appended below via "Load older logs" - see the plan note on why
  // this isn't the numbered Pagination component used elsewhere in the app.
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      fetchLogs(filters)
        .then(({ logs: freshRows }) => {
          const existingIds = new Set(logsRef.current.map((row) => row.id));
          const newRows = freshRows.filter((row) => !existingIds.has(row.id));
          if (newRows.length > 0) setLogs((prev) => [...newRows, ...prev]);
        })
        .catch(() => {
          // Auto-refresh failures are silent - the explicit Refresh button surfaces errors instead.
        });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [filters, autoRefresh]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchLogs(filters)
      .then(({ logs: rows, nextCursor: cursor }) => {
        setLogs(rows);
        setNextCursor(cursor);
      })
      .catch(() => setError("Failed to load logs."))
      .finally(() => setLoading(false));
  }, [filters]);

  const handleLoadOlder = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetchLogs(filters, nextCursor)
      .then(({ logs: rows, nextCursor: cursor }) => {
        setLogs((prev) => [...prev, ...rows]);
        setNextCursor(cursor);
      })
      .catch(() => setError("Failed to load older logs."))
      .finally(() => setLoadingMore(false));
  }, [filters, nextCursor, loadingMore]);

  const toggleLevel = (level: string) => {
    setFilters((current) => ({
      ...current,
      levels: current.levels.includes(level)
        ? current.levels.filter((l) => l !== level)
        : [...current.levels, level],
    }));
  };

  const hasActiveFilters =
    filters.levels.length > 0 ||
    filters.worker !== DEFAULT_FILTERS.worker ||
    filters.range !== DEFAULT_FILTERS.range ||
    filters.q !== "";

  const clearFilters = () => {
    setSearchInput("");
    setFilters(DEFAULT_FILTERS);
  };

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div>
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          System Logs
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          {loading ? "Loading…" : `${logs.length} line${logs.length === 1 ? "" : "s"} loaded`}
          {error ? <span className="text-[var(--rose)]"> · {error}</span> : null}
        </p>
      </div>

      {/* Log Console Window */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-[7px] p-[10px_12px] border-b border-[var(--bd)] bg-[var(--card2)]">
          <span className="w-[6px] h-[6px] rounded-full bg-[var(--emerald)] animate-dkpulse flex-none" />

          {/* Level chips */}
          <div className="flex items-center gap-[5px]">
            {LEVELS.map((level) => {
              const active = filters.levels.includes(level);
              const style = LEVEL_STYLES[level];
              return (
                <button
                  key={level}
                  type="button"
                  aria-label={`Toggle ${level} level filter`}
                  aria-pressed={active}
                  onClick={() => toggleLevel(level)}
                  className="h-[26px] px-[9px] rounded-[7px] text-[10px] font-bold uppercase tracking-wide border transition-colors"
                  style={
                    active
                      ? { background: style.bg, color: style.fg, borderColor: style.bd }
                      : { background: "var(--card)", color: "var(--mut)", borderColor: "var(--bd)" }
                  }
                >
                  {level}
                </button>
              );
            })}
          </div>

          {/* Worker select */}
          <Select
            value={filters.worker}
            onValueChange={(val) => setFilters((current) => ({ ...current, worker: val ?? "all" }))}
          >
            <SelectTrigger className="h-[26px] min-w-[140px] text-[10.5px] font-semibold border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] rounded-[7px] outline-none">
              <SelectValue placeholder="All workers" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--card)] border border-[var(--bd)] text-[var(--fg)]">
              <SelectItem value="all">All workers</SelectItem>
              {WORKERS.map((worker) => (
                <SelectItem key={worker} value={worker}>
                  {worker}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Time range pills */}
          <div className="flex items-center gap-[3px]">
            {RANGES.map((r) => {
              const active = filters.range === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilters((current) => ({ ...current, range: r.value }))}
                  className="h-[26px] px-[8px] rounded-[7px] text-[10.5px] font-semibold border transition-colors"
                  style={
                    active
                      ? { background: "rgba(99,102,241,0.14)", color: "var(--indigo)", borderColor: "rgba(99,102,241,0.32)" }
                      : { background: "var(--card)", color: "var(--mut)", borderColor: "var(--bd)" }
                  }
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="flex items-center gap-[6px] h-[26px] px-[8px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] flex-1 min-w-[150px] max-w-[240px]">
            <Search size={12} className="text-[var(--faint)] flex-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter messages…"
              aria-label="Filter log messages"
              className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-[var(--fg2)] placeholder:text-[var(--faint)]"
            />
            {searchInput && (
              <button type="button" aria-label="Clear search" onClick={() => setSearchInput("")}>
                <X size={11} className="text-[var(--faint)] hover:text-[var(--fg)]" />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-[6px]">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-[26px] px-[8px] rounded-[7px] text-[10.5px] font-semibold text-[var(--mut)] hover:text-[var(--fg)] transition-colors"
              >
                Clear filters
              </button>
            )}
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              aria-pressed={autoRefresh}
              className="h-[26px] px-[9px] rounded-[7px] text-[10px] font-semibold flex items-center gap-[5px] border transition-colors"
              style={
                autoRefresh
                  ? { background: "rgba(16,185,129,0.12)", color: "var(--emerald)", borderColor: "rgba(16,185,129,0.3)" }
                  : { background: "var(--card)", color: "var(--mut)", borderColor: "var(--bd)" }
              }
            >
              <span
                className={`w-[5px] h-[5px] rounded-full flex-none ${autoRefresh ? "bg-[var(--emerald)] animate-dkpulse" : "bg-[var(--faint)]"}`}
              />
              Auto-refresh
            </button>
            <button
              type="button"
              aria-label="Refresh logs now"
              onClick={handleRefresh}
              disabled={loading}
              className="h-[26px] w-[26px] flex-none flex items-center justify-center rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] hover:border-[var(--bd2)] disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Console Stream */}
        <div className="p-[10px_0] max-h-[540px] overflow-y-auto bg-[var(--card)] font-mono text-[11px] leading-relaxed">
          {logs.length > 0 ? (
            logs.map((log) => {
              const style = LEVEL_STYLES[log.level] ?? LEVEL_STYLES.DEBUG;
              return (
                <div
                  key={log.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedLog(log)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelectedLog(log);
                  }}
                  className="flex gap-[10px] p-[4px_14px] hover:bg-[var(--card2)] transition-colors border-b border-transparent cursor-pointer"
                >
                  <span className="flex-none text-[var(--faint)] w-[64px]">{log.timestamp.slice(11, 19)}</span>
                  <span className="flex-none w-[48px] font-bold" style={{ color: style.fg }}>
                    {log.level}
                  </span>
                  <span className="flex-none w-[130px] text-[var(--mut)] truncate">{log.worker ?? "-"}</span>
                  <span className="text-[var(--fg2)] min-w-0 flex-1 truncate">{log.message}</span>
                </div>
              );
            })
          ) : (
            <div className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
              {loading ? "Loading…" : "No log entries match these filters."}
            </div>
          )}
        </div>

        {/* Load older */}
        <div className="p-[10px_14px] border-t border-[var(--bd)] flex items-center justify-center">
          {nextCursor ? (
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingMore}
              className="h-[28px] px-[14px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--bd2)] disabled:opacity-60 transition-colors"
            >
              {loadingMore ? "Loading…" : "Load older logs"}
            </button>
          ) : (
            <span className="text-[11px] text-[var(--faint)]">
              {logs.length > 0 ? "No more logs in this range." : ""}
            </span>
          )}
        </div>
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.6)] backdrop-blur-sm flex items-center justify-center p-[16px] animate-dkfade"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="w-full max-w-[640px] max-h-[80vh] overflow-y-auto bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] p-[16px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-[10px] border-b border-[var(--bd)] mb-[12px]">
              <div className="flex items-center gap-[9px]">
                <span
                  className="font-bold text-[12px] uppercase tracking-wide"
                  style={{ color: (LEVEL_STYLES[selectedLog.level] ?? LEVEL_STYLES.DEBUG).fg }}
                >
                  {selectedLog.level}
                </span>
                <span className="text-[11px] text-[var(--mut)] font-mono">
                  {selectedLog.worker ?? "unknown"}
                </span>
                <span className="text-[10.5px] text-[var(--faint)] font-mono">
                  {new Date(selectedLog.timestamp).toLocaleString()}
                </span>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-[12px] font-bold text-[var(--mut)] hover:text-[var(--fg)]"
              >
                ✕
              </button>
            </div>

            <div className="text-[12.5px] text-[var(--fg2)] mb-[10px] leading-relaxed">
              {selectedLog.message}
            </div>

            {selectedLog.stack && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--mut)] mb-[5px]">
                  Stack trace
                </div>
                <pre className="font-mono text-[11px] leading-relaxed p-[12px] rounded-[8px] bg-[var(--card2)] text-[var(--rose)] overflow-x-auto whitespace-pre-wrap mb-[10px]">
                  {selectedLog.stack}
                </pre>
              </>
            )}

            {selectedLog.meta != null && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--mut)] mb-[5px]">
                  Metadata
                </div>
                <pre className="font-mono text-[11px] leading-relaxed p-[12px] rounded-[8px] bg-[var(--card2)] text-[var(--fg2)] overflow-x-auto whitespace-pre-wrap mb-[10px]">
                  {JSON.stringify(selectedLog.meta, null, 2)}
                </pre>
              </>
            )}

            {(selectedLog.blogId || selectedLog.trendId || selectedLog.workflowRunId) && (
              <div className="flex flex-wrap gap-[14px] text-[10.5px] text-[var(--faint)] font-mono pt-[8px] border-t border-[var(--bd)]">
                {selectedLog.blogId && <span>blogId: {selectedLog.blogId}</span>}
                {selectedLog.trendId && <span>trendId: {selectedLog.trendId}</span>}
                {selectedLog.workflowRunId && <span>workflowRunId: {selectedLog.workflowRunId}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
