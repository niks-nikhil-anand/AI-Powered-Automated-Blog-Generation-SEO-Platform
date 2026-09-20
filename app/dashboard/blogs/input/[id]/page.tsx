"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Attempt = {
  id: string;
  worker: string;
  attempt: number;
  status: string;
  error: string | null;
  qualityReport: unknown;
  startedAt: string;
  finishedAt: string | null;
};

type WorkflowRun = {
  id: string;
  status: string;
  currentStage: string;
  failureReason: string | null;
  createdAt: string;
  attempts: Attempt[];
};

type Submission = {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  status: string;
  priority: string;
  failureReason: string | null;
  audience: string | null;
  searchIntent: string | null;
  tone: string | null;
  contentLength: number | null;
  focusKeyword: string | null;
  keywords: string[];
  secondaryKeywords: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  evidenceSummary: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  processedAt: string | null;
  specs: unknown;
  blog: { id: string; slug: string; status: string; title: string } | null;
  plan: { id: string; searchIntent: string; audience: string; angle: string; primaryKeyword: string } | null;
  outline: { id: string; title: string; sections: unknown; faqs: unknown } | null;
  workflowRuns: WorkflowRun[];
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: "rgba(148,163,184,0.16)", fg: "var(--mut)" },
  PROCESSING: { bg: "rgba(99,102,241,0.14)", fg: "var(--indigo)" },
  COMPLETED: { bg: "rgba(16,185,129,0.14)", fg: "var(--emerald)" },
  FAILED: { bg: "rgba(244,63,94,0.14)", fg: "var(--rose)" },
  CANCELLED: { bg: "rgba(245,158,11,0.14)", fg: "var(--amber)" },
};

/** The stages a submission walks through, in order. */
const STAGES = ["planning-worker", "outline-worker", "writing-worker", "image-worker", "quality-worker", "publish-worker"];
const STAGE_LABELS: Record<string, string> = {
  "planning-worker": "Planning",
  "outline-worker": "Outline",
  "writing-worker": "Writing",
  "image-worker": "Image",
  "quality-worker": "Quality",
  "publish-worker": "Publish",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-wider uppercase text-[var(--mut)]">{label}</div>
      <div className="text-[12.5px] text-[var(--fg)] mt-[3px] break-words">{value || <span className="text-[var(--faint)]">—</span>}</div>
    </div>
  );
}

export default function BlogInputDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    fetch(`/api/blogs/input/${id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSubmission(data))
      .catch(() => setSubmission(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (action: "cancel" | "start" | "retry") => {
    setNotice(null);
    const response = await fetch(`/api/blogs/input/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setNotice(data.error ?? `Failed to ${action} submission`);
    load();
  };

  if (loading) {
    return <div className="text-[12px] text-[var(--mut)]">Loading submission…</div>;
  }

  if (!submission) {
    return (
      <div className="flex flex-col gap-[10px]">
        <p className="text-[13px] text-[var(--fg)]">That submission does not exist.</p>
        <Link href="/dashboard/blogs/new" className="text-[12px] font-semibold text-[var(--indigo)] hover:underline">
          Back to new submission
        </Link>
      </div>
    );
  }

  const style = STATUS_STYLE[submission.status] ?? STATUS_STYLE.PENDING;
  const attempts = submission.workflowRuns.flatMap((run) => run.attempts);
  const stageState = (worker: string) => {
    const relevant = attempts.filter((attempt) => attempt.worker === worker);
    if (relevant.length === 0) return "pending";
    if (relevant.some((attempt) => attempt.status === "PASSED")) return "passed";
    if (relevant.some((attempt) => attempt.status === "FAILED")) return "failed";
    return "running";
  };

  return (
    <div className="flex flex-col gap-[16px] max-w-[1100px]">
      <header className="flex flex-wrap items-start gap-[12px]">
        <div className="min-w-0">
          <Link href="/dashboard/blogs/new" className="text-[11px] font-semibold text-[var(--indigo)] hover:underline">
            ← New blog submission
          </Link>
          <h1 className="text-[18px] font-bold tracking-tight text-[var(--fg)] mt-[4px]">{submission.title}</h1>
          <p className="text-[11.5px] text-[var(--mut)] mt-[2px]">
            /{submission.slug} · submitted {new Date(submission.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-[8px]">
          <span
            className="inline-block px-[9px] py-[3px] rounded-[7px] text-[10.5px] font-bold tracking-wide"
            style={{ background: style.bg, color: style.fg }}
          >
            {submission.status}
          </span>
          {submission.status === "PENDING" && (
            <button
              type="button"
              onClick={() => act("start")}
              className="px-[12px] py-[6px] rounded-[8px] bg-[var(--indigo)] text-white text-[11.5px] font-semibold"
            >
              Start now
            </button>
          )}
          {submission.status === "FAILED" && (
            <button
              type="button"
              onClick={() => act("retry")}
              className="px-[12px] py-[6px] rounded-[8px] bg-[var(--indigo)] text-white text-[11.5px] font-semibold"
            >
              Retry
            </button>
          )}
          {submission.status !== "COMPLETED" && submission.status !== "CANCELLED" && (
            <button
              type="button"
              onClick={() => act("cancel")}
              className="px-[12px] py-[6px] rounded-[8px] border border-[var(--bd)] text-[11.5px] font-semibold text-[var(--rose)]"
            >
              Cancel
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div className="p-[10px_12px] rounded-[9px] border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.10)] text-[11.5px] text-[var(--amber)]">
          {notice}
        </div>
      )}

      {submission.failureReason && (
        <div className="p-[10px_12px] rounded-[9px] border border-[rgba(244,63,94,0.3)] bg-[rgba(244,63,94,0.10)] text-[11.5px] text-[var(--rose)]">
          Last failure: {submission.failureReason}
        </div>
      )}

      {/* Pipeline progress */}
      <section className="border border-[var(--bd)] rounded-[12px] bg-[var(--card)] p-[14px]">
        <h2 className="text-[13px] font-bold text-[var(--fg)] mb-[12px]">Pipeline</h2>
        <div className="flex flex-wrap gap-[8px]">
          {STAGES.map((stage) => {
            const state = stageState(stage);
            const colors =
              state === "passed"
                ? { bg: "rgba(16,185,129,0.12)", fg: "var(--emerald)", bd: "rgba(16,185,129,0.28)" }
                : state === "failed"
                  ? { bg: "rgba(244,63,94,0.12)", fg: "var(--rose)", bd: "rgba(244,63,94,0.28)" }
                  : state === "running"
                    ? { bg: "rgba(99,102,241,0.12)", fg: "var(--indigo)", bd: "rgba(99,102,241,0.28)" }
                    : { bg: "transparent", fg: "var(--faint)", bd: "var(--bd)" };
            return (
              <span
                key={stage}
                className="px-[10px] py-[5px] rounded-[8px] border text-[11px] font-semibold"
                style={{ background: colors.bg, color: colors.fg, borderColor: colors.bd }}
              >
                {STAGE_LABELS[stage]}
              </span>
            );
          })}
        </div>
        {submission.blog && (
          <p className="text-[11.5px] text-[var(--mut)] mt-[12px]">
            Produced blog: <span className="text-[var(--fg)] font-semibold">{submission.blog.title}</span> (
            {submission.blog.status}) ·{" "}
            <Link href="/dashboard/blogs" className="text-[var(--indigo)] hover:underline">
              open in Content Pipeline
            </Link>
          </p>
        )}
      </section>

      {/* Specification */}
      <section className="border border-[var(--bd)] rounded-[12px] bg-[var(--card)] p-[14px]">
        <h2 className="text-[13px] font-bold text-[var(--fg)] mb-[12px]">Specification</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[14px]">
          <Field label="Category" value={submission.category} />
          <Field label="Priority" value={submission.priority} />
          <Field label="Tone" value={submission.tone} />
          <Field label="Target length" value={submission.contentLength ? `${submission.contentLength} words` : null} />
          <Field label="Focus keyword" value={submission.focusKeyword} />
          <Field label="Primary keywords" value={submission.keywords.join(", ")} />
          <Field label="Secondary keywords" value={submission.secondaryKeywords.join(", ")} />
          <Field label="Audience" value={submission.audience} />
          <Field label="Search intent" value={submission.searchIntent} />
          <Field label="Meta title" value={submission.metaTitle} />
          <Field label="Meta description" value={submission.metaDescription} />
          <Field
            label="Reference sources"
            value={submission.evidenceSummary ? "Grounded (sources supplied)" : "Unsourced brief"}
          />
        </div>
      </section>

      {/* Generated plan */}
      {submission.plan && (
        <section className="border border-[var(--bd)] rounded-[12px] bg-[var(--card)] p-[14px]">
          <h2 className="text-[13px] font-bold text-[var(--fg)] mb-[12px]">Content plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
            <Field label="Primary keyword" value={submission.plan.primaryKeyword} />
            <Field label="Audience" value={submission.plan.audience} />
            <Field label="Search intent" value={submission.plan.searchIntent} />
            <Field label="Angle" value={submission.plan.angle} />
          </div>
        </section>
      )}

      {/* Attempt log */}
      <section className="border border-[var(--bd)] rounded-[12px] bg-[var(--card)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)]">
          <h2 className="text-[13px] font-bold text-[var(--fg)]">Worker attempts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] min-w-[640px]">
            <thead>
              <tr className="text-[var(--mut)]">
                {["Worker", "Attempt", "Status", "Started", "Error"].map((heading) => (
                  <th
                    key={heading}
                    className="text-left p-[8px_12px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-[18px_12px] text-center text-[11.5px] text-[var(--mut)]">
                    Nothing has run yet.
                  </td>
                </tr>
              ) : (
                attempts.map((attempt) => (
                  <tr key={attempt.id} className="border-b border-[var(--bd)]">
                    <td className="p-[9px_12px] font-semibold text-[var(--fg)]">{attempt.worker}</td>
                    <td className="p-[9px_12px] text-[var(--mut)]">#{attempt.attempt}</td>
                    <td className="p-[9px_12px]">
                      <span
                        className="text-[10.5px] font-bold"
                        style={{
                          color:
                            attempt.status === "PASSED"
                              ? "var(--emerald)"
                              : attempt.status === "FAILED"
                                ? "var(--rose)"
                                : "var(--indigo)",
                        }}
                      >
                        {attempt.status}
                      </span>
                    </td>
                    <td className="p-[9px_12px] text-[11px] text-[var(--mut)]">
                      {new Date(attempt.startedAt).toLocaleString()}
                    </td>
                    <td className="p-[9px_12px] text-[11px] text-[var(--rose)] max-w-[320px] truncate" title={attempt.error ?? ""}>
                      {attempt.error ?? ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
