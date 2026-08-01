"use client";

import React, { useState } from "react";

export default function WorkersPage() {
  const [selectedStack, setSelectedStack] = useState<string | null>(null);

  const queues = [
    { name: "research_queue", waiting: "12", active: "2", completed: "142", failed: "0", dot: "var(--emerald)", anim: "animate-dkpulse", rate: "14/min", p95: "1.2s", failedColor: "var(--mut)" },
    { name: "planning_queue", waiting: "4", active: "1", completed: "138", failed: "1", dot: "var(--indigo)", anim: "none", rate: "8/min", p95: "2.4s", failedColor: "var(--rose)" },
    { name: "outline_queue", waiting: "2", active: "1", completed: "135", failed: "0", dot: "var(--indigo)", anim: "animate-dkpulse", rate: "6/min", p95: "4.8s", failedColor: "var(--mut)" },
    { name: "writing_queue", waiting: "3", active: "2", completed: "130", failed: "2", dot: "var(--indigo)", anim: "animate-dkpulse", rate: "2/min", p95: "14.2s", failedColor: "var(--rose)" },
    { name: "image_queue", waiting: "1", active: "1", completed: "128", failed: "0", dot: "var(--sky)", anim: "animate-dkpulse", rate: "4/min", p95: "8.1s", failedColor: "var(--mut)" },
    { name: "quality_queue", waiting: "2", active: "0", completed: "125", failed: "1", dot: "var(--amber)", anim: "none", rate: "10/min", p95: "3.2s", failedColor: "var(--rose)" },
    { name: "publish_queue", waiting: "0", active: "1", completed: "124", failed: "0", dot: "var(--emerald)", anim: "none", rate: "5/min", p95: "0.8s", failedColor: "var(--mut)" },
  ];

  const jobs = [
    { id: "job-89241", queue: "writing_queue", payload: '{"topic":"Next.js 15 PPR","words":3000,"model":"gemini-2.5-pro"}', attempts: 1, duration: "12.4s", state: "Active", sBg: "rgba(99,102,241,0.12)", sFg: "var(--indigo)", sBd: "rgba(99,102,241,0.3)", errBtn: "none" },
    { id: "job-89240", queue: "quality_queue", payload: '{"blogId":"b-4912","threshold":90,"checks":["seo","grammar"]}', attempts: 1, duration: "2.8s", state: "Active", sBg: "rgba(99,102,241,0.12)", sFg: "var(--indigo)", sBd: "rgba(99,102,241,0.3)", errBtn: "none" },
    { id: "job-89239", queue: "image_queue", payload: '{"prompt":"Hero image for Rust vs Go microservices","resolution":"1920x1080"}', attempts: 2, duration: "7.6s", state: "Failed", sBg: "rgba(244,63,94,0.12)", sFg: "var(--rose)", sBd: "rgba(244,63,94,0.3)", errBtn: "inline-block", stack: "Error: Imagen API Rate Limit Exceeded (429 Too Many Requests)\n    at VertexImagenService.generate (services/imagen.ts:42)\n    at ProcessJob (workers/image-worker.ts:18)" },
    { id: "job-89238", queue: "publish_queue", payload: '{"blogId":"b-4910","target":"DevKit CMS","pingGoogle":true}', attempts: 1, duration: "0.6s", state: "Completed", sBg: "rgba(16,185,129,0.12)", sFg: "var(--emerald)", sBd: "rgba(16,185,129,0.3)", errBtn: "none" },
    { id: "job-89237", queue: "research_queue", payload: '{"source":"Google Trends","category":"Frameworks"}', attempts: 1, duration: "1.1s", state: "Completed", sBg: "rgba(16,185,129,0.12)", sFg: "var(--emerald)", sBd: "rgba(16,185,129,0.3)", errBtn: "none" },
    { id: "job-89236", queue: "planning_queue", payload: '{"topic":"Bun 1.2 SQLite","targetKeywords":["bun","sqlite"]}', attempts: 1, duration: "2.1s", state: "Completed", sBg: "rgba(16,185,129,0.12)", sFg: "var(--emerald)", sBd: "rgba(16,185,129,0.3)", errBtn: "none" },
    { id: "job-89235", queue: "outline_queue", payload: '{"title":"DeepSeek-V3 Open Weights","sections":6}', attempts: 1, duration: "4.2s", state: "Completed", sBg: "rgba(16,185,129,0.12)", sFg: "var(--emerald)", sBd: "rgba(16,185,129,0.3)", errBtn: "none" },
    { id: "job-89234", queue: "writing_queue", payload: '{"topic":"Tailwind CSS v4","words":2500}', attempts: 3, duration: "16.8s", state: "Failed", sBg: "rgba(244,63,94,0.12)", sFg: "var(--rose)", sBd: "rgba(244,63,94,0.3)", errBtn: "inline-block", stack: "Error: Gemini Pro Token Limit Timeout after 15000ms\n    at VertexAIProvider.complete (services/vertex.ts:88)" },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Queue & Worker Operations
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            BullMQ · redis://cache-prod-01:6379 · 7 queues · concurrency 4
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
            latest 8 jobs
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
              {jobs.map((j) => (
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
              ))}
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
