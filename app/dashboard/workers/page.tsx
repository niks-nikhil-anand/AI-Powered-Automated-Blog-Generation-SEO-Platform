"use client";

import React, { useCallback, useEffect, useState } from "react";
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

// ---------------------------------------------------------------------
// Types mirror the /api/dashboard payload (docs/workers-page-uiux-plan.md)
// ---------------------------------------------------------------------

type Notice = {
  title: string;
  message: string;
  tone: "amber" | "indigo";
};

type QueueCard = {
  name: string;
  key: string;
  waiting: string;
  active: string;
  completed: string;
  failed: string;
  dot: string;
  anim: string;
  rate: string;
  p95: string;
  paused: boolean;
  live: boolean;
  failedColor: string;
};

type WorkerHealth = {
  key: string;
  worker: string;
  queue: string;
  live: boolean;
  consumers: number;
  paused: boolean;
  state: "active" | "queued" | "failed" | "idle";
  lastRanAt: string | null;
  lastStatus: string | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  scheduled: boolean;
};

type JobRow = {
  kind: "failedJob" | "attempt";
  id: string;
  queue: string;
  payload: string;
  attempts: number;
  duration: string;
  state: string;
  sBg: string;
  sFg: string;
  sBd: string;
  errBtn: string;
  stack?: string;
  retryable: boolean;
  started: string;
};

const NOTICE_TONE_STYLES: Record<Notice["tone"], { fg: string; bg: string; bd: string }> = {
  amber: { fg: "var(--amber)", bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.3)" },
  indigo: { fg: "var(--indigo)", bg: "rgba(99,102,241,0.12)", bd: "rgba(99,102,241,0.3)" },
};

const JOBS_PAGE_SIZE = 10;

type JobStateFilter = "all" | "failed" | "running" | "passed";

const JOB_STATE_FILTERS: { key: JobStateFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "failed", label: "Failed" },
  { key: "running", label: "Running" },
  { key: "passed", label: "Passed" },
];

function jobMatchesFilter(j: JobRow, filter: JobStateFilter) {
  if (filter === "all") return true;
  if (filter === "failed") return j.state === "FAILED";
  if (filter === "running") return j.state === "RUNNING";
  return j.state === "PASSED";
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** State annotation for a health card - merges liveness with queue counts. */
function stateLabel(w: WorkerHealth, q: QueueCard | undefined): { text: string; color: string } {
  if (!w.live) return { text: "down", color: "var(--rose)" };
  if (w.state === "active") return { text: `active · ${q?.active ?? "0"}`, color: "var(--indigo)" };
  if (w.state === "queued") return { text: `${q?.waiting ?? "0"} queued`, color: "var(--amber)" };
  if (w.state === "failed") return { text: `${q?.failed ?? "0"} failed`, color: "var(--rose)" };
  return { text: "idle", color: "var(--mut)" };
}

export default function WorkersPage() {
  const [selectedStack, setSelectedStack] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [queues, setQueues] = useState<QueueCard[]>([]);
  const [workers, setWorkers] = useState<WorkerHealth[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [fetchError, setFetchError] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [jobsPage, setJobsPage] = useState(1);
  const [stateFilter, setStateFilter] = useState<JobStateFilter>("all");

  const loadWorkers = useCallback(() => {
    fetch("/api/dashboard", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setFetchError(false);
        setQueues(data.queues ?? []);
        setWorkers(data.workerHealth ?? []);
        setJobs(data.jobs ?? []);
      })
      .catch(() => {
        setFetchError(true);
      });
  }, []);

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      if (mounted) loadWorkers();
    };
    tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [loadWorkers]);

  /** Fires a mutation at /api/workers/actions and shows the real result. */
  const runAction = useCallback(
    async (action: string, extra?: Record<string, string>, doneTitle = "Done") => {
      if (busyAction) return;
      setBusyAction(action);
      try {
        const res = await fetch("/api/workers/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setNotice({ title: doneTitle, message: data.detail ?? "Done.", tone: "indigo" });
        } else {
          setNotice({
            title: "Action failed",
            message: data.error ?? `Request failed (${res.status})`,
            tone: "amber",
          });
        }
      } catch {
        setNotice({
          title: "Action failed",
          message: "Could not reach /api/workers/actions - is the dev server up?",
          tone: "amber",
        });
      } finally {
        setBusyAction(null);
        loadWorkers();
      }
    },
    [busyAction, loadWorkers]
  );

  const liveCount = workers.filter((w) => w.live).length;
  const allDown = workers.length > 0 && liveCount === 0;
  const allPaused = queues.length > 0 && queues.every((q) => q.paused);

  // Job inspector: filter pills + client-side pagination over the rows the
  // API sends (up to 10 failed BullMQ jobs + 100 latest attempts). Page is
  // clamped, not reset, when the 3s poll changes the row count.
  const filteredJobs = jobs.filter((j) => jobMatchesFilter(j, stateFilter));
  const totalJobPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PAGE_SIZE));
  const currentJobPage = Math.min(jobsPage, totalJobPages);
  const pagedJobs = filteredJobs.slice(
    (currentJobPage - 1) * JOBS_PAGE_SIZE,
    currentJobPage * JOBS_PAGE_SIZE
  );
  const jobCounts: Record<JobStateFilter, number> = {
    all: jobs.length,
    failed: jobs.filter((j) => j.state === "FAILED").length,
    running: jobs.filter((j) => j.state === "RUNNING").length,
    passed: jobs.filter((j) => j.state === "PASSED").length,
  };

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Queue & Worker Operations
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            BullMQ · {queues.length} queues ·{" "}
            <span style={{ color: liveCount === workers.length ? "var(--emerald)" : "var(--rose)" }}>
              {liveCount}/{workers.length} workers live
            </span>
          </p>
        </div>
        <div className="flex gap-[7px]">
          <button
            aria-label={allPaused ? "Resume all queues" : "Pause all queues"}
            disabled={busyAction !== null}
            onClick={() =>
              runAction(allPaused ? "resume-all" : "pause-all", undefined, allPaused ? "Queues resumed" : "Queues paused")
            }
            className="h-[30px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--amber)] text-[11.5px] font-semibold hover:border-[var(--amber)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busyAction === "pause-all" || busyAction === "resume-all"
              ? "Working…"
              : allPaused
                ? "Resume all"
                : "Pause all"}
          </button>
          <button
            aria-label="Retry all failed jobs"
            disabled={busyAction !== null}
            onClick={() => runAction("retry-all-failed", undefined, "Failed jobs re-queued")}
            className="h-[30px] px-[12px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:bg-[#4f46e5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busyAction === "retry-all-failed" ? "Working…" : "Retry all failed"}
          </button>
        </div>
      </div>

      {/* Fetch error banner - the dashboard API itself is unreachable */}
      {fetchError && (
        <div className="rounded-[10px] border border-[rgba(244,63,94,0.3)] bg-[rgba(244,63,94,0.08)] p-[10px_12px] text-[12px] text-[var(--rose)] font-semibold">
          Cannot reach /api/dashboard - check that the dev server and Redis are up.
        </div>
      )}

      {/* All-workers-down banner - the single most useful sentence on this page */}
      {!fetchError && allDown && (
        <div className="rounded-[10px] border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] p-[10px_12px] text-[12px] text-[var(--amber)]">
          <span className="font-bold">No worker processes are connected to Redis.</span> Start them
          with <code className="font-mono text-[11px]">npm run worker:dev</code> (local, all-in-one)
          or <code className="font-mono text-[11px]">docker compose up</code> (one container per
          worker).
        </div>
      )}

      {/* Worker Health strip - one card per worker process, pipeline order */}
      <div>
        <div className="flex items-center justify-between mb-[7px]">
          <span className="text-[13px] font-bold text-[var(--fg)]">Worker health</span>
          <span className="text-[10.5px] text-[var(--faint)] font-mono">
            live = consuming from Redis right now
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-[9px]">
          {workers.map((w) => {
            const queue = queues.find((q) => q.key === w.key);
            const status = stateLabel(w, queue);
            return (
              <div
                key={w.key}
                className="bg-[var(--card)] border border-[var(--bd)] rounded-[10px] p-[10px] shadow-[var(--shadow)]"
              >
                <div className="flex items-center gap-[5px]">
                  <span
                    className={`w-[6px] h-[6px] rounded-full flex-none ${w.live && w.state === "active" ? "animate-dkpulse" : ""}`}
                    style={{ background: w.live ? "var(--emerald)" : "var(--rose)" }}
                  />
                  <span className="font-mono font-semibold text-[10.5px] text-[var(--fg)] tracking-tight truncate">
                    {w.key}
                  </span>
                  {w.scheduled && (
                    <span
                      className="ml-auto text-[8.5px] font-bold px-[4px] py-[1px] rounded-full border flex-none"
                      style={{
                        color: "var(--sky)",
                        borderColor: "rgba(56,189,248,0.35)",
                        background: "rgba(56,189,248,0.1)",
                      }}
                      title="Also runs on cron (3 slots) - see Settings"
                    >
                      cron
                    </span>
                  )}
                </div>
                <div className="mt-[7px] text-[11px] font-bold" style={{ color: status.color }}>
                  {w.live ? "Live" : "Down"}
                  <span className="font-semibold text-[var(--mut)]"> · {status.text}</span>
                </div>
                <div className="mt-[5px] text-[9.5px] text-[var(--faint)] font-mono leading-[1.5]">
                  <div>
                    last {ago(w.lastRanAt)}
                    {w.lastStatus ? ` · ${w.lastStatus.toLowerCase()}` : ""}
                  </div>
                  <div>
                    avg {fmtMs(w.avgDurationMs)} · p95 {fmtMs(w.p95DurationMs)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Queues Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[11px]">
        {queues.map((q) => (
          <div
            key={q.key}
            className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[12px] shadow-[var(--shadow)]"
          >
            <div className="flex items-center gap-[6px]">
              <span
                className={`w-[6px] h-[6px] rounded-full ${q.anim}`}
                style={{ background: q.dot }}
                title={q.live ? "A worker is consuming this queue" : "No worker connected"}
              />
              <span className="font-mono font-semibold text-[11px] text-[var(--fg)] tracking-tight">
                {q.name}
              </span>
              {!q.live && (
                <span
                  className="text-[8.5px] font-bold px-[4px] py-[1px] rounded-full border"
                  style={{
                    color: "var(--rose)",
                    borderColor: "rgba(244,63,94,0.35)",
                    background: "rgba(244,63,94,0.1)",
                  }}
                >
                  unmanned
                </span>
              )}
              {q.paused && (
                <span
                  className="ml-auto text-[8.5px] font-bold px-[4px] py-[1px] rounded-full border"
                  style={{
                    color: "var(--amber)",
                    borderColor: "rgba(245,158,11,0.35)",
                    background: "rgba(245,158,11,0.1)",
                  }}
                >
                  paused
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-[7px] mt-[10px]">
              <div className="rounded-[8px] bg-[var(--card2)] p-[6px_8px]">
                <div className="text-[9.5px] text-[var(--mut)] font-semibold">Waiting</div>
                <div className="font-mono text-[14px] font-bold text-[var(--fg)]">{q.waiting}</div>
              </div>
              <div className="rounded-[8px] bg-[var(--card2)] p-[6px_8px]">
                <div className="text-[9.5px] text-[var(--mut)] font-semibold">Active</div>
                <div className="font-mono text-[14px] font-bold text-[var(--indigo)]">{q.active}</div>
              </div>
              <div className="rounded-[8px] bg-[var(--card2)] p-[6px_8px]">
                <div className="text-[9.5px] text-[var(--mut)] font-semibold">Completed</div>
                <div className="font-mono text-[14px] font-bold text-[var(--emerald)]">{q.completed}</div>
              </div>
              <div className="rounded-[8px] bg-[var(--card2)] p-[6px_8px]">
                <div className="text-[9.5px] text-[var(--mut)] font-semibold">Failed</div>
                <div className="font-mono text-[14px] font-bold" style={{ color: q.failedColor }}>{q.failed}</div>
              </div>
            </div>
            <div className="mt-[9px] flex items-center justify-between text-[10px] text-[var(--faint)] font-mono">
              <span>
                {q.rate} · p95 {q.p95}
              </span>
              <button
                aria-label={`${q.paused ? "Resume" : "Pause"} ${q.name}`}
                disabled={busyAction !== null}
                onClick={() =>
                  runAction(
                    q.paused ? "resume-queue" : "pause-queue",
                    { queue: q.name },
                    q.paused ? "Queue resumed" : "Queue paused"
                  )
                }
                className="h-[20px] px-[7px] rounded-[5px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[9.5px] font-semibold hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-sans"
              >
                {q.paused ? "Resume" : "Pause"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Job Inspector Table */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between flex-wrap gap-[8px]">
          <span className="text-[13px] font-bold text-[var(--fg)]">
            Job inspector
          </span>
          <div className="flex gap-[5px]">
            {JOB_STATE_FILTERS.map((f) => (
              <button
                key={f.key}
                aria-label={`Filter by ${f.label}`}
                onClick={() => {
                  setStateFilter(f.key);
                  setJobsPage(1);
                }}
                className={`h-[23px] px-[9px] rounded-full border text-[10.5px] font-semibold transition-colors ${
                  stateFilter === f.key
                    ? "border-[rgba(99,102,241,0.3)] bg-[var(--tint)] text-[var(--indigo)]"
                    : "border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--fg)]"
                }`}
              >
                {f.label} · {jobCounts[f.key]}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] min-w-[900px]">
            <thead>
              <tr className="bg-[var(--card2)] text-[var(--mut)]">
                <th className="text-left p-[8px_14px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  ID
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Worker / Queue
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Payload
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Att.
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Duration
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  When
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  State
                </th>
                <th className="p-[8px_14px] border-b border-[var(--bd)]" />
              </tr>
            </thead>
            <tbody>
              {pagedJobs.length > 0 ? pagedJobs.map((j) => (
                <tr
                  key={`${j.kind}-${j.id}`}
                  className="border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors"
                >
                  <td className="p-[9px_14px] font-mono font-semibold text-[11px] text-[var(--fg)]" title={j.id}>
                    {j.id.length > 12 ? `${j.id.slice(0, 10)}…` : j.id}
                  </td>
                  <td className="p-[9px_8px] font-mono text-[11px] text-[var(--fg2)]">
                    {j.queue}
                  </td>
                  <td className="p-[9px_8px] max-w-[260px]">
                    <span className="font-mono text-[10.5px] text-[var(--mut)] truncate block">
                      {j.payload || "—"}
                    </span>
                  </td>
                  <td className="p-[9px_8px] text-right font-mono font-semibold text-[11px] text-[var(--fg2)]">
                    {j.attempts}
                  </td>
                  <td className="p-[9px_8px] text-right font-mono text-[11px] text-[var(--mut)]">
                    {j.duration}
                  </td>
                  <td className="p-[9px_8px] text-right font-mono text-[11px] text-[var(--mut)] whitespace-nowrap">
                    {j.started}
                  </td>
                  <td className="p-[9px_8px]">
                    <span
                      className="text-[10.5px] font-semibold p-[2.5px_8px] rounded-full border whitespace-nowrap"
                      style={{ background: j.sBg, color: j.sFg, borderColor: j.sBd }}
                    >
                      {j.state}
                    </span>
                  </td>
                  <td className="p-[9px_14px] text-right whitespace-nowrap">
                    {j.errBtn !== "none" && (
                      <button
                        aria-label="View error stack trace"
                        onClick={() => setSelectedStack(j.stack || "Unknown error")}
                        className="h-[24px] px-[9px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold mr-[5px] hover:border-[var(--rose)] hover:text-[var(--rose)] transition-colors"
                      >
                        Stack
                      </button>
                    )}
                    {j.retryable && (
                      <button
                        aria-label="Retry job"
                        disabled={busyAction !== null}
                        onClick={() =>
                          runAction("retry-job", { queue: j.queue, jobId: j.id }, "Job re-queued")
                        }
                        className="h-[24px] px-[9px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
                    {jobs.length === 0
                      ? "No failed jobs and no worker attempts yet."
                      : "No rows match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredJobs.length > 0 && (
          <div className="p-[9px_14px] border-t border-[var(--bd)] flex items-center justify-between flex-wrap gap-[8px]">
            <span className="text-[10.5px] text-[var(--faint)] font-mono">
              {(currentJobPage - 1) * JOBS_PAGE_SIZE + 1}–
              {Math.min(currentJobPage * JOBS_PAGE_SIZE, filteredJobs.length)} of{" "}
              {filteredJobs.length}
            </span>
            {totalJobPages > 1 && (
              <Pagination className="w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      disabled={currentJobPage === 1}
                      onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                    />
                  </PaginationItem>
                  {getPaginationRange(currentJobPage, totalJobPages).map((entry, idx) =>
                    entry === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${idx}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={entry}>
                        <PaginationLink
                          isActive={entry === currentJobPage}
                          onClick={() => setJobsPage(entry)}
                        >
                          {entry}
                        </PaginationLink>
                      </PaginationItem>
                    )
                  )}
                  <PaginationItem>
                    <PaginationNext
                      disabled={currentJobPage === totalJobPages}
                      onClick={() => setJobsPage((p) => Math.min(totalJobPages, p + 1))}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        )}
      </div>

      {/* Action Notice Modal - reports the real result from /api/workers/actions */}
      {notice && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.6)] backdrop-blur-sm flex items-center justify-center p-[16px] animate-dkfade"
          onClick={() => setNotice(null)}
        >
          <div
            className="w-full max-w-[380px] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] overflow-hidden p-[16px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-[10px]">
              <span
                className="w-[30px] h-[30px] rounded-[9px] flex-none flex items-center justify-center text-[15px] font-bold"
                style={{
                  background: NOTICE_TONE_STYLES[notice.tone].bg,
                  color: NOTICE_TONE_STYLES[notice.tone].fg,
                  border: `1px solid ${NOTICE_TONE_STYLES[notice.tone].bd}`,
                }}
              >
                {notice.tone === "amber" ? "!" : "✓"}
              </span>
              <div className="flex-1 pt-[2px]">
                <div className="font-bold text-[13px] text-[var(--fg)]">{notice.title}</div>
                <div className="text-[12px] text-[var(--fg2)] mt-[3px]">{notice.message}</div>
              </div>
              <button
                onClick={() => setNotice(null)}
                className="text-[12px] font-bold text-[var(--mut)] hover:text-[var(--fg)]"
              >
                ✕
              </button>
            </div>
            <button
              onClick={() => setNotice(null)}
              className="w-full h-[32px] mt-[14px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:bg-[#4f46e5] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Stack Trace Modal */}
      {selectedStack && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.6)] backdrop-blur-sm flex items-center justify-center p-[16px] animate-dkfade"
          onClick={() => setSelectedStack(null)}
        >
          <div
            className="w-full max-w-[600px] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] overflow-hidden p-[16px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-[10px] border-b border-[var(--bd)] mb-[12px]">
              <span className="font-bold text-[13px] text-[var(--rose)]">Error Stack Trace</span>
              <button
                onClick={() => setSelectedStack(null)}
                className="text-[12px] font-bold text-[var(--mut)] hover:text-[var(--fg)]"
              >
                ✕
              </button>
            </div>
            <pre className="font-mono text-[11px] leading-relaxed p-[12px] rounded-[8px] bg-[var(--card2)] text-[var(--rose)] overflow-x-auto whitespace-pre-wrap">
              {selectedStack}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
