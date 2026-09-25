"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useLiveNow } from "./WorldClocks";

type Schedule = {
  id: string;
  label: string;
  pattern: string | null;
  tz: string | null;
  /** Null when the slot isn't registered right now (no publish time configured for it). */
  next: number | null;
};

type LastRun = {
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  dispatchedCount: number | null;
  reason: string | null;
  error: string | null;
};

type QueueCounts = {
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  completed: number;
};

type RunContext = {
  schedules: Schedule[];
  lastRun: LastRun | null;
  queues: Record<string, QueueCounts>;
  stageOrder: string[];
  runInFlight: boolean;
  workersConnected: number;
  dailyTarget: {
    target: number;
    publishedToday: number;
    inFlight: number;
    remaining: number;
    backlogAvailable: number;
    backlogPending: number;
    backlogCancelled: number;
    backlogFailed: number;
  };
  estimate: {
    costUsd: number;
    costLabel: string;
    durationMs: number;
    durationLabel: string;
    basedOnRuns: number;
  };
};

type RunResult = {
  dispatched: number;
  reason: string;
  blogInputId?: string;
  title?: string;
  pickedStatus?: string;
  targetPublishAt?: string;
  target: number;
  publishedToday: number;
  inFlight: number;
  remaining: number;
  backlogAvailable: number;
};

interface RunPipelineModalProps {
  onClose: () => void;
}

function currentTimeIn(tz: string, now: number) {
  return new Date(now).toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fullScheduleTime(ms: number, tz: string) {
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function countdown(target: number, from: number) {
  const diff = target - from;
  if (diff <= 0) return "due now";
  const totalMinutes = Math.floor(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h`;
  }
  if (hours === 0) return `in ${minutes}m`;
  return `in ${hours}h ${minutes}m`;
}

function timeAgo(iso: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

const LABEL_CLASS =
  "text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--mut)]";

/**
 * Rendered only while open - the parent mounts and unmounts it - so all state
 * resets naturally and there is no SSR pass over the live clocks.
 */
export function RunPipelineModal({ onClose }: RunPipelineModalProps) {
  const [context, setContext] = useState<RunContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const now = useLiveNow();

  useEffect(() => {
    let mounted = true;
    const load = () => {
      fetch("/api/pipeline/run-context", { cache: "no-store" })
        .then((res) => res.json())
        .then((data: RunContext) => {
          if (!mounted) return;
          setContext(data);
          setLoading(false);
        })
        .catch(() => {
          if (mounted) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore Escape mid-submit so an in-flight request isn't abandoned.
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submitting, onClose]);

  const handleRun = useCallback(async () => {
    setSubmitting(true);
    setError("");
    setRunResult(null);
    try {
      const res = await fetch("/api/pipeline/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to run the pipeline");
      setRunResult(data as RunResult);
      const nextContext = await fetch("/api/pipeline/run-context", { cache: "no-store" }).then((response) => response.json());
      setContext(nextContext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run the pipeline");
    } finally {
      setSubmitting(false);
    }
  }, []);

  const noWorkers = context !== null && context.workersConnected === 0;
  const runInFlight = context?.runInFlight ?? false;
  const runDisabled = submitting || loading || runInFlight;
  // run-context always returns the three canonical slots; ones with next ===
  // null aren't registered right now (schedule cleared via a Daily Blog Goal
  // change) and have no countdown to show.
  const configuredSchedules = (context?.schedules ?? []).filter(
    (schedule): schedule is Schedule & { next: number } => schedule.next !== null
  );
  const nextSchedule = configuredSchedules
    .slice()
    .sort((a, b) => a.next - b.next)[0];
  const dailyTarget = context?.dailyTarget;

  return (
    <div
      className="fixed inset-0 z-[80] bg-[rgba(0,0,0,0.45)] flex items-start justify-center p-[24px] overflow-y-auto"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Run pipeline"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[460px] my-auto bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden"
      >
        {/* Header */}
        <div className="p-[14px_16px] border-b border-[var(--bd)] flex items-start gap-[10px]">
          <div className="flex-1">
            <div className="text-[14px] font-bold text-[var(--fg)]">Run pipeline</div>
            <div className="text-[11.5px] text-[var(--mut)] mt-[2px]">
              Dispatch queued blog submissions now
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={submitting}
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[13px] leading-none hover:border-[var(--bd2)] disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {/* Dispatch status */}
        <div className="p-[12px_16px] border-b border-[var(--bd)]">
          <div className={LABEL_CLASS}>Run status</div>
          <div className="mt-[9px] grid grid-cols-1 gap-[8px]">
            <div className="rounded-[9px] border border-[var(--bd)] bg-[var(--card2)] p-[10px]">
              <div className="flex items-center justify-between gap-[12px]">
                <span className="text-[11px] text-[var(--mut)]">Current time</span>
                <span className="font-mono text-[13px] font-bold text-[var(--fg)]">
                  {currentTimeIn("Asia/Kolkata", now)} IST
                </span>
              </div>
              <div className="mt-[7px] flex items-center justify-between gap-[12px]">
                <span className="text-[11px] text-[var(--mut)]">Next scheduled run</span>
                <span className="text-right text-[11.5px] text-[var(--fg2)]">
                  {loading
                    ? "Loading..."
                    : nextSchedule
                      ? `${nextSchedule.label} · ${fullScheduleTime(nextSchedule.next, "Asia/Kolkata")} IST (${countdown(nextSchedule.next, now)})`
                      : "No schedule configured"}
                </span>
              </div>
            </div>

            <div className="rounded-[9px] border border-[var(--bd)] bg-[var(--card2)] p-[10px]">
              <div className="flex flex-wrap gap-[6px]">
                <span className="rounded-[5px] bg-[rgba(99,102,241,0.14)] px-[7px] py-[3px] text-[10.5px] font-semibold text-[var(--indigo)]">
                  goal {dailyTarget?.target ?? "—"}/day
                </span>
                <span className="rounded-[5px] bg-[var(--card)] px-[7px] py-[3px] text-[10.5px] text-[var(--fg2)]">
                  {dailyTarget?.publishedToday ?? "—"} published
                </span>
                <span className="rounded-[5px] bg-[var(--card)] px-[7px] py-[3px] text-[10.5px] text-[var(--fg2)]">
                  {dailyTarget?.inFlight ?? "—"} in flight
                </span>
                <span className="rounded-[5px] bg-[var(--card)] px-[7px] py-[3px] text-[10.5px] text-[var(--fg2)]">
                  {dailyTarget?.remaining ?? "—"} can start
                </span>
              </div>
              <div className="mt-[8px] text-[11px] text-[var(--mut)]">
                Manual run uses scheduled picker logic: pending first, cancelled next,
                failed last. Eligible backlog:{" "}
                <span className="text-[var(--fg2)]">
                  {dailyTarget
                    ? `${dailyTarget.backlogPending} pending · ${dailyTarget.backlogCancelled} cancelled · ${dailyTarget.backlogFailed} failed`
                    : "loading..."}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Last run */}
        <div className="p-[12px_16px] border-b border-[var(--bd)]">
          <div className="flex items-center gap-[8px]">
            <span className={`${LABEL_CLASS} flex-1`}>Last run</span>
            {context?.lastRun && (
              <>
                <span
                  className="text-[10.5px] font-semibold px-[8px] py-[2px] rounded-[5px]"
                  style={
                    context.lastRun.status === "PASSED"
                      ? { background: "rgba(16,185,129,0.12)", color: "var(--emerald)" }
                      : context.lastRun.status === "FAILED"
                        ? { background: "rgba(244,63,94,0.12)", color: "var(--rose)" }
                        : { background: "rgba(99,102,241,0.12)", color: "var(--indigo)" }
                  }
                >
                  {context.lastRun.status.toLowerCase()}
                </span>
                <span className="text-[10.5px] text-[var(--faint)]">
                  {timeAgo(context.lastRun.startedAt, now)}
                </span>
              </>
            )}
          </div>
          <div className="text-[12px] text-[var(--fg2)] mt-[6px]">
            {!context?.lastRun && (loading ? "Loading…" : "No scheduler run recorded yet")}
            {context?.lastRun && (
              <>
                {context.lastRun.dispatchedCount === null
                  ? "In progress"
                  : context.lastRun.dispatchedCount > 0
                    ? `${context.lastRun.dispatchedCount} topic${context.lastRun.dispatchedCount === 1 ? "" : "s"} dispatched`
                    : "No new topic above threshold"}
                {context.lastRun.durationMs !== null && ` · ${formatDuration(context.lastRun.durationMs)}`}
              </>
            )}
          </div>
          {context?.lastRun?.error && (
            <div className="text-[11px] text-[var(--rose)] mt-[5px] font-mono break-words">
              {context.lastRun.error}
            </div>
          )}
        </div>

        {/* Queue state */}
        <div className="p-[12px_16px] border-b border-[var(--bd)]">
          <div className={LABEL_CLASS}>Queue state</div>
          <div className="flex flex-wrap gap-[6px] mt-[9px]">
            {(context?.stageOrder ?? []).map((stage) => {
              const counts = context?.queues[stage];
              const busy = (counts?.active ?? 0) + (counts?.waiting ?? 0) + (counts?.delayed ?? 0);
              const failed = counts?.failed ?? 0;
              return (
                <span
                  key={stage}
                  className="font-mono text-[10.5px] font-medium px-[8px] py-[3px] rounded-[5px]"
                  style={
                    failed > 0
                      ? { background: "rgba(244,63,94,0.12)", color: "var(--rose)" }
                      : busy > 0
                        ? { background: "rgba(99,102,241,0.14)", color: "var(--indigo)" }
                        : { background: "var(--card2)", color: "var(--mut)" }
                  }
                >
                  {stage} {busy}
                  {failed > 0 ? ` · ${failed}✕` : ""}
                </span>
              );
            })}
            {loading && <span className="text-[11.5px] text-[var(--faint)]">Loading…</span>}
          </div>

          {runInFlight && (
            <div className="mt-[9px] flex items-center gap-[7px] rounded-[8px] p-[7px_9px] bg-[rgba(245,158,11,0.10)] border border-[rgba(245,158,11,0.25)]">
              <span className="text-[11.5px] text-[var(--amber)]">
                A scheduler run is already in progress.
              </span>
            </div>
          )}

          {noWorkers && (
            <div className="mt-[9px] flex items-center gap-[7px] rounded-[8px] p-[7px_9px] bg-[rgba(245,158,11,0.10)] border border-[rgba(245,158,11,0.25)]">
              <span className="text-[11.5px] text-[var(--amber)]">
                No worker is consuming scheduler_queue — the job will sit queued.
              </span>
            </div>
          )}
        </div>

        {/* Estimate */}
        <div className="p-[12px_16px] border-b border-[var(--bd)]">
          <div className={LABEL_CLASS}>This run</div>
          <div className="flex items-center gap-[10px] mt-[7px] flex-wrap">
            <span className="font-mono text-[14px] font-bold text-[var(--fg)]">
              {context?.estimate.costLabel ?? "—"}
            </span>
            <span className="text-[var(--bd2)]">·</span>
            <span className="text-[12px] text-[var(--fg2)]">
              {context?.estimate.durationLabel ?? "—"}
            </span>
            <span className="text-[var(--bd2)]">·</span>
            <span className="text-[12px] text-[var(--fg2)]">7 stages</span>
            <span className="text-[var(--bd2)]">·</span>
            <span className="text-[12px] text-[var(--fg2)]">up to 1 blog</span>
          </div>
          <div className="text-[10.5px] text-[var(--faint)] mt-[5px]">
            {context && context.estimate.basedOnRuns > 0
              ? `Typical run, averaged over ${context.estimate.basedOnRuns} blog${context.estimate.basedOnRuns === 1 ? "" : "s"}. A run that finds nothing costs ~$0.`
              : "Estimated — no completed runs to average yet. A run that finds nothing costs ~$0."}
          </div>
        </div>

        {/* Result banners */}
        {(runResult || error) && (
          <div className="p-[12px_16px] border-b border-[var(--bd)]">
            {error && (
              <div className="text-[11.5px] text-[var(--rose)] bg-[rgba(244,63,94,0.10)] border border-[rgba(244,63,94,0.25)] rounded-[8px] p-[9px_10px]">
                {error}
              </div>
            )}
            {runResult && (
              <div className="text-[11.5px] text-[var(--emerald)] bg-[rgba(16,185,129,0.10)] border border-[rgba(16,185,129,0.25)] rounded-[8px] p-[9px_10px]">
                {runResult.dispatched > 0
                  ? `Dispatched "${runResult.title}" from ${runResult.pickedStatus?.toLowerCase() ?? "eligible"} backlog.`
                  : runResult.reason === "daily_target_already_met"
                    ? `Nothing dispatched — daily goal is already covered (${runResult.publishedToday} published, ${runResult.inFlight} in flight).`
                    : "Nothing dispatched — no eligible blog is available."}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="p-[12px_16px] flex items-center gap-[10px]">
          <span className="text-[10.5px] text-[var(--mut)] flex-1">
            Workers must be running: <span className="font-mono">npm run worker:dev</span>
          </span>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-[31px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] disabled:opacity-60"
          >
            {runResult ? "Close" : "Cancel"}
          </button>
          {!runResult && (
            <button
              type="button"
              disabled={runDisabled}
              onClick={handleRun}
              className="h-[31px] px-[13px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-bold hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {submitting ? "Queueing…" : runInFlight ? "Run in progress" : "Run pipeline"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
