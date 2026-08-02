"use client";

import React, { useEffect, useState } from "react";

export default function WorkersPage() {
  const [selectedStack, setSelectedStack] = useState<string | null>(null);
  const [queues, setQueues] = useState<{
    name: string;
    waiting: string;
    active: string;
    completed: string;
    failed: string;
    dot: string;
    anim: string;
    rate: string;
    p95: string;
    failedColor: string;
  }[]>([]);
  const [jobs, setJobs] = useState<{
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
  }[]>([]);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => {
        setQueues(data.queues ?? []);
        setJobs(data.jobs ?? []);
      })
      .catch(() => {
        setQueues([]);
        setJobs([]);
      });
  }, []);

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Queue & Worker Operations
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            BullMQ · {queues.length} queues · database-backed activity
          </p>
        </div>
        <div className="flex gap-[7px]">
          <button
            aria-label="Pause all queues"
            onClick={() => alert("Paused all 7 BullMQ queues!")}
            className="h-[30px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--amber)] text-[11.5px] font-semibold hover:border-[var(--amber)] transition-colors"
          >
            Pause all
          </button>
          <button
            aria-label="Retry all failed jobs"
            onClick={() => alert("Retrying all failed BullMQ jobs...")}
            className="h-[30px] px-[12px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:bg-[#4f46e5] transition-colors"
          >
            Retry all failed
          </button>
        </div>
      </div>

      {/* Queues Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[11px]">
        {queues.map((q, idx) => (
          <div
            key={idx}
            className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[12px] shadow-[var(--shadow)]"
          >
            <div className="flex items-center gap-[6px]">
              <span
                className={`w-[6px] h-[6px] rounded-full ${q.anim}`}
                style={{ background: q.dot }}
              />
              <span className="font-mono font-semibold text-[11px] text-[var(--fg)] tracking-tight">
                {q.name}
              </span>
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
              <span>{q.rate}</span>
              <span>p95 {q.p95}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Job Inspector Table */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between">
          <span className="text-[13px] font-bold text-[var(--fg)]">
            Job inspector
          </span>
          <span className="text-[11px] text-[var(--mut)]">
            latest {jobs.length} jobs
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] min-w-[860px]">
            <thead>
              <tr className="bg-[var(--card2)] text-[var(--mut)]">
                <th className="text-left p-[8px_14px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Job ID
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Queue
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Payload
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Attempts
                </th>
                <th className="text-right p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  Duration
                </th>
                <th className="text-left p-[8px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]">
                  State
                </th>
                <th className="p-[8px_14px] border-b border-[var(--bd)]" />
              </tr>
            </thead>
            <tbody>
              {jobs.length > 0 ? jobs.map((j) => (
                <tr
                  key={j.id}
                  className="border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors"
                >
                  <td className="p-[9px_14px] font-mono font-semibold text-[11px] text-[var(--fg)]">
                    {j.id}
                  </td>
                  <td className="p-[9px_8px] font-mono text-[11px] text-[var(--fg2)]">
                    {j.queue}
                  </td>
                  <td className="p-[9px_8px] max-w-[300px]">
                    <span className="font-mono text-[10.5px] text-[var(--mut)] truncate block">
                      {j.payload}
                    </span>
                  </td>
                  <td className="p-[9px_8px] text-right font-mono font-semibold text-[11px] text-[var(--fg2)]">
                    {j.attempts}
                  </td>
                  <td className="p-[9px_8px] text-right font-mono text-[11px] text-[var(--mut)]">
                    {j.duration}
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
                    <button
                      aria-label="Retry job"
                      onClick={() => alert(`Retried job ${j.id}`)}
                      className="h-[24px] px-[9px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-colors"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
                    No jobs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
