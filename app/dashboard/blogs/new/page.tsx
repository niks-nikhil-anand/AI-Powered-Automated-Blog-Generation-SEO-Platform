"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  blogInputSchema,
  CATEGORIES,
  PRIORITIES,
  slugifyTitle,
  splitKeywords,
  TONES,
  type BlogInputFormData,
} from "./types";
import { submitBlogInput } from "./actions";

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
  currentStage: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: "rgba(148,163,184,0.16)", fg: "var(--mut)" },
  PROCESSING: { bg: "rgba(99,102,241,0.14)", fg: "var(--indigo)" },
  COMPLETED: { bg: "rgba(16,185,129,0.14)", fg: "var(--emerald)" },
  FAILED: { bg: "rgba(244,63,94,0.14)", fg: "var(--rose)" },
  CANCELLED: { bg: "rgba(245,158,11,0.14)", fg: "var(--amber)" },
};

const OUTLINE_PLACEHOLDER = `{
  "sections": [
    {
      "heading": "What are React Hooks?",
      "intent": "Define hooks and why they matter",
      "bullets": ["Introduced in React 16.8", "State in function components"]
    }
  ],
  "faqs": [
    { "question": "Can I use hooks in class components?", "answer": "No." }
  ]
}`;

const SOURCES_PLACEHOLDER = `[
  {
    "url": "https://example.com/post",
    "title": "The announcement",
    "evidence": ["Ships in v4.2", "Cuts cold starts to 80ms"]
  }
]`;

const inputClass =
  "w-full px-[10px] py-[7px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--indigo)]";
const labelClass = "block text-[11px] font-semibold text-[var(--fg2)] mb-[5px]";
const hintClass = "text-[10.5px] text-[var(--mut)] mt-[4px]";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="border border-[var(--bd)] rounded-[12px] bg-[var(--card)] p-[16px]">
      <h2 className="text-[13px] font-bold text-[var(--fg)]">{title}</h2>
      {subtitle && <p className="text-[11px] text-[var(--mut)] mt-[3px] mb-[12px]">{subtitle}</p>}
      <div className={subtitle ? "flex flex-col gap-[12px]" : "flex flex-col gap-[12px] mt-[12px]"}>{children}</div>
    </section>
  );
}

export default function NewBlogPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOutlineInput, setShowOutlineInput] = useState(false);
  const [showSourcesInput, setShowSourcesInput] = useState(false);
  const [showJsonPreview, setShowJsonPreview] = useState(false);

  // Raw textarea text is kept separately from the parsed value so a
  // half-typed JSON object doesn't wipe what the editor already typed.
  const [outlineText, setOutlineText] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const [form, setForm] = useState<Partial<BlogInputFormData>>({
    tone: "professional",
    contentLength: 2000,
    priority: "NORMAL",
    startNow: true,
  });

  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);

  const loadRows = useCallback(() => {
    fetch("/api/blogs/input?limit=25", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setRowsLoading(false));
  }, []);

  useEffect(() => {
    loadRows();
    const timer = window.setInterval(loadRows, 5000);
    return () => window.clearInterval(timer);
  }, [loadRows]);

  const set = <K extends keyof BlogInputFormData>(key: K, value: BlogInputFormData[K] | undefined) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  /**
   * The exact payload that goes to the server - also what "Preview JSON"
   * shows, so the preview can never drift from what is actually submitted.
   */
  const buildPayload = (): { payload: Record<string, unknown>; jsonError: string | null } => {
    let outlineJson: unknown;
    let sources: unknown;
    let jsonError: string | null = null;

    if (showOutlineInput && outlineText.trim()) {
      try {
        outlineJson = JSON.parse(outlineText);
      } catch {
        jsonError = "Outline JSON is not valid JSON.";
      }
    }
    if (showSourcesInput && sourcesText.trim()) {
      try {
        sources = JSON.parse(sourcesText);
      } catch {
        jsonError = jsonError ? `${jsonError} Reference sources JSON is not valid JSON.` : "Reference sources JSON is not valid JSON.";
      }
    }

    return {
      jsonError,
      payload: {
        title: form.title ?? "",
        slug: form.slug || undefined,
        category: form.category || undefined,
        focusKeyword: form.focusKeyword || undefined,
        primaryKeywords: splitKeywords(keywordsText),
        secondaryKeywords: splitKeywords(secondaryText),
        metaTitle: form.metaTitle || undefined,
        metaDescription: form.metaDescription || undefined,
        audience: form.audience || undefined,
        searchIntent: form.searchIntent || undefined,
        tone: form.tone ?? "professional",
        contentLength: form.contentLength ?? 2000,
        priority: form.priority ?? "NORMAL",
        startNow: form.startNow ?? true,
        ...(outlineJson !== undefined ? { outlineJson } : {}),
        ...(sources !== undefined ? { sources } : {}),
      },
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const { payload, jsonError } = buildPayload();
    if (jsonError) {
      setError(jsonError);
      return;
    }

    const parsed = blogInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join(" · "));
      return;
    }

    setIsLoading(true);
    try {
      const result = await submitBlogInput(parsed.data);
      if (result.success) {
        router.push(`/dashboard/blogs/input/${result.id}`);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit blog specification");
    } finally {
      setIsLoading(false);
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
    if (!response.ok) setNotice(data.error ?? `Failed to ${action} submission`);
    loadRows();
  };

  const previewJson = JSON.stringify(buildPayload().payload, null, 2);

  return (
    <div className="flex flex-col gap-[16px] max-w-[1100px]">
      <header>
        <h1 className="text-[18px] font-bold tracking-tight text-[var(--fg)]">New blog submission</h1>
        <p className="text-[11.5px] text-[var(--mut)] mt-[3px]">
          Describe the article you want. The pipeline plans it, outlines it, writes it, illustrates it, scores it, and
          publishes it.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
        <Section title="Basic info">
          <div>
            <label className={labelClass} htmlFor="blog-title">
              Title <span className="text-[var(--rose)]">*</span>
            </label>
            <input
              id="blog-title"
              type="text"
              required
              minLength={10}
              maxLength={200}
              placeholder="e.g. How to Master React Hooks: A Complete Guide"
              value={form.title ?? ""}
              onChange={(event) => {
                set("title", event.target.value);
                if (!slugTouched) set("slug", slugifyTitle(event.target.value));
              }}
              className={inputClass}
            />
            <p className={hintClass}>10-200 characters. Must be unique across submissions.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div>
              <label className={labelClass} htmlFor="blog-slug">
                Slug
              </label>
              <input
                id="blog-slug"
                type="text"
                placeholder="auto-generated from title"
                value={form.slug ?? ""}
                onChange={(event) => {
                  setSlugTouched(true);
                  set("slug", event.target.value);
                }}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="blog-category">
                Category
              </label>
              <select
                id="blog-category"
                value={form.category ?? ""}
                onChange={(event) => set("category", event.target.value || undefined)}
                className={inputClass}
              >
                <option value="">Select category</option>
                {CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        <Section title="SEO & keywords" subtitle="Every keyword listed here must appear verbatim in the finished article.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div>
              <label className={labelClass} htmlFor="blog-focus">
                Focus keyword
              </label>
              <input
                id="blog-focus"
                type="text"
                placeholder="Main keyword to target"
                value={form.focusKeyword ?? ""}
                onChange={(event) => set("focusKeyword", event.target.value)}
                className={inputClass}
              />
              <p className={hintClass}>Becomes the content plan&apos;s primary keyword.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="blog-keywords">
                Primary keywords
              </label>
              <input
                id="blog-keywords"
                type="text"
                placeholder="keyword one, keyword two, keyword three"
                value={keywordsText}
                onChange={(event) => setKeywordsText(event.target.value)}
                className={inputClass}
              />
              <p className={hintClass}>Comma-separated.</p>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="blog-secondary">
              Secondary keywords
            </label>
            <input
              id="blog-secondary"
              type="text"
              placeholder="supporting phrases, LSI terms"
              value={secondaryText}
              onChange={(event) => setSecondaryText(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div>
              <label className={labelClass} htmlFor="blog-metatitle">
                Meta title
              </label>
              <input
                id="blog-metatitle"
                type="text"
                maxLength={60}
                value={form.metaTitle ?? ""}
                onChange={(event) => set("metaTitle", event.target.value)}
                className={inputClass}
              />
              <p className={hintClass}>{(form.metaTitle ?? "").length}/60</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="blog-metadesc">
                Meta description
              </label>
              <textarea
                id="blog-metadesc"
                maxLength={160}
                rows={2}
                value={form.metaDescription ?? ""}
                onChange={(event) => set("metaDescription", event.target.value)}
                className={inputClass}
              />
              <p className={hintClass}>{(form.metaDescription ?? "").length}/160</p>
            </div>
          </div>
        </Section>

        <Section title="Content specifications">
          <div>
            <label className={labelClass} htmlFor="blog-audience">
              Target audience
            </label>
            <input
              id="blog-audience"
              type="text"
              placeholder="e.g. Junior developers, CTOs, engineering managers"
              value={form.audience ?? ""}
              onChange={(event) => set("audience", event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="blog-intent">
              Search intent
            </label>
            <textarea
              id="blog-intent"
              rows={3}
              placeholder="What problem does this solve? What should readers walk away knowing?"
              value={form.searchIntent ?? ""}
              onChange={(event) => set("searchIntent", event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div>
              <span className={labelClass}>Tone</span>
              <div className="flex gap-[14px] mt-[6px]">
                {TONES.map((tone) => (
                  <label key={tone} className="flex items-center gap-[6px] text-[12px] text-[var(--fg2)]">
                    <input
                      type="radio"
                      name="tone"
                      value={tone}
                      checked={(form.tone ?? "professional") === tone}
                      onChange={() => set("tone", tone)}
                    />
                    {tone.charAt(0).toUpperCase() + tone.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="blog-length">
                Target word count
              </label>
              <input
                id="blog-length"
                type="number"
                min={500}
                max={5000}
                step={100}
                value={form.contentLength ?? 2000}
                onChange={(event) => set("contentLength", Number(event.target.value))}
                className={inputClass}
              />
              <p className={hintClass}>500-5000. Recommended: 1500-2500.</p>
            </div>
          </div>
        </Section>

        <Section
          title="Optional: pre-structured outline"
          subtitle="Supplied outlines are used verbatim - no outline is generated. Only section headings are required."
        >
          <label className="flex items-center gap-[7px] text-[12px] text-[var(--fg2)]">
            <input
              type="checkbox"
              checked={showOutlineInput}
              onChange={(event) => setShowOutlineInput(event.target.checked)}
            />
            Provide a custom outline (JSON)
          </label>
          {showOutlineInput && (
            <textarea
              rows={12}
              spellCheck={false}
              placeholder={OUTLINE_PLACEHOLDER}
              value={outlineText}
              onChange={(event) => setOutlineText(event.target.value)}
              className={`${inputClass} font-mono text-[11.5px]`}
            />
          )}
        </Section>

        <Section
          title="Optional: reference sources"
          subtitle="Supplying sources switches the pipeline into grounded mode: every factual claim must map to one of them, the draft cites them inline, and QA fact-checks against them."
        >
          <label className="flex items-center gap-[7px] text-[12px] text-[var(--fg2)]">
            <input
              type="checkbox"
              checked={showSourcesInput}
              onChange={(event) => setShowSourcesInput(event.target.checked)}
            />
            Provide reference sources (JSON)
          </label>
          {showSourcesInput && (
            <>
              <textarea
                rows={10}
                spellCheck={false}
                placeholder={SOURCES_PLACEHOLDER}
                value={sourcesText}
                onChange={(event) => setSourcesText(event.target.value)}
                className={`${inputClass} font-mono text-[11.5px]`}
              />
              <p className={hintClass}>
                Each source needs a <code>url</code>, a <code>title</code> and at least one atomic fact in{" "}
                <code>evidence</code>. A title and URL on their own do not count as evidence.
              </p>
            </>
          )}
        </Section>

        <Section title="Scheduling">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div>
              <label className={labelClass} htmlFor="blog-priority">
                Backlog priority
              </label>
              <select
                id="blog-priority"
                value={form.priority ?? "NORMAL"}
                onChange={(event) => set("priority", event.target.value as BlogInputFormData["priority"])}
                className={inputClass}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority.charAt(0) + priority.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <p className={hintClass}>Highest priority drains from the backlog first.</p>
            </div>
            <div>
              <span className={labelClass}>When to run</span>
              <div className="flex flex-col gap-[6px] mt-[6px]">
                <label className="flex items-center gap-[6px] text-[12px] text-[var(--fg2)]">
                  <input
                    type="radio"
                    name="startNow"
                    checked={form.startNow !== false}
                    onChange={() => set("startNow", true)}
                  />
                  Start now
                </label>
                <label className="flex items-center gap-[6px] text-[12px] text-[var(--fg2)]">
                  <input
                    type="radio"
                    name="startNow"
                    checked={form.startNow === false}
                    onChange={() => set("startNow", false)}
                  />
                  Queue for the next publish slot
                </label>
              </div>
            </div>
          </div>
        </Section>

        {error && (
          <div className="p-[12px] rounded-[10px] border border-[rgba(244,63,94,0.3)] bg-[rgba(244,63,94,0.10)] text-[12px] text-[var(--rose)]">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-[10px] items-center">
          <button
            type="button"
            onClick={() => setShowJsonPreview((previous) => !previous)}
            className="px-[14px] py-[8px] rounded-[9px] border border-[var(--bd)] bg-[var(--card)] text-[12px] font-semibold text-[var(--fg2)] hover:bg-[var(--card2)]"
          >
            {showJsonPreview ? "Hide JSON" : "Preview JSON"}
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-[18px] py-[8px] rounded-[9px] bg-[var(--indigo)] text-white text-[12px] font-semibold disabled:opacity-50"
          >
            {isLoading ? "Submitting…" : "Submit for processing"}
          </button>
        </div>

        {showJsonPreview && (
          <pre className="p-[12px] rounded-[10px] border border-[var(--bd)] bg-[var(--card2)] text-[11px] font-mono text-[var(--fg2)] overflow-x-auto">
            {previewJson}
          </pre>
        )}
      </form>

      {/* ---------------------------------------------------------------- */}
      <section className="border border-[var(--bd)] rounded-[12px] bg-[var(--card)] overflow-hidden">
        <div className="flex items-center gap-[10px] p-[12px_14px] border-b border-[var(--bd)]">
          <h2 className="text-[13px] font-bold text-[var(--fg)]">Recent submissions</h2>
          <span className="ml-auto text-[11px] text-[var(--mut)]">{rows.length} rows</span>
        </div>

        {notice && (
          <div className="p-[10px_14px] text-[11.5px] text-[var(--amber)] border-b border-[var(--bd)]">{notice}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] min-w-[760px]">
            <thead>
              <tr className="text-[var(--mut)]">
                {["Title", "Status", "Stage", "Submitted", ""].map((heading, index) => (
                  <th
                    key={heading || index}
                    className="text-left p-[8px_12px] text-[10px] font-bold tracking-wider uppercase border-b border-[var(--bd)]"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-[20px_12px] text-center text-[11.5px] text-[var(--mut)]">
                    Loading submissions…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-[20px_12px] text-center text-[11.5px] text-[var(--mut)]">
                    No submissions yet. Fill in the form above to queue your first article.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.PENDING;
                  return (
                    <tr key={row.id} className="border-b border-[var(--bd)]">
                      <td className="p-[9px_12px]">
                        <Link href={`/dashboard/blogs/input/${row.id}`} className="font-semibold text-[var(--fg)] hover:underline">
                          {row.title}
                        </Link>
                        <div className="text-[10.5px] text-[var(--mut)] mt-[2px]">
                          {row.category ?? "uncategorized"} · {row.priority.toLowerCase()}
                          {row.failureReason ? ` · ${row.failureReason.slice(0, 80)}` : ""}
                        </div>
                      </td>
                      <td className="p-[9px_12px]">
                        <span
                          className="inline-block px-[7px] py-[2px] rounded-[6px] text-[10px] font-bold tracking-wide"
                          style={{ background: style.bg, color: style.fg }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="p-[9px_12px] text-[11px] text-[var(--mut)]">{row.currentStage ?? "-"}</td>
                      <td className="p-[9px_12px] text-[11px] text-[var(--mut)]">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="p-[9px_12px] text-right whitespace-nowrap">
                        {row.blog && (
                          <Link
                            href="/dashboard/blogs"
                            className="text-[11px] font-semibold text-[var(--indigo)] hover:underline mr-[10px]"
                          >
                            View blog
                          </Link>
                        )}
                        {row.status === "PENDING" && (
                          <button
                            type="button"
                            onClick={() => rowAction(row.id, "start")}
                            className="text-[11px] font-semibold text-[var(--indigo)] hover:underline mr-[10px]"
                          >
                            Start now
                          </button>
                        )}
                        {row.status === "FAILED" && (
                          <button
                            type="button"
                            onClick={() => rowAction(row.id, "retry")}
                            className="text-[11px] font-semibold text-[var(--indigo)] hover:underline mr-[10px]"
                          >
                            Retry
                          </button>
                        )}
                        {row.status !== "COMPLETED" && row.status !== "CANCELLED" && (
                          <button
                            type="button"
                            onClick={() => rowAction(row.id, "cancel")}
                            className="text-[11px] font-semibold text-[var(--rose)] hover:underline"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
