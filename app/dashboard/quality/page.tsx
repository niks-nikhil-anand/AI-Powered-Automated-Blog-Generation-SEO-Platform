"use client";

import React from "react";

export default function QualityAuditPage() {
  const qualityStats = [
    { label: "Median Quality", value: "93", foot: "target ≥ 90", color: "var(--emerald)" },
    { label: "Articles Blocked", value: "5", foot: "needs review", color: "var(--rose)" },
    { label: "Plagiarism Match", value: "0%", foot: "100% original", color: "var(--emerald)" },
    { label: "SEO Indexing Ready", value: "98%", foot: "JSON-LD valid", color: "var(--indigo)" },
  ];

  const checkRates = [
    { name: "Grammar & Structure", value: "99%", color: "var(--emerald)" },
    { name: "SEO Meta & Keywords", value: "96%", color: "var(--emerald)" },
    { name: "Code Example Verification", value: "94%", color: "var(--emerald)" },
    { name: "Readability (Flesch Index)", value: "92%", color: "var(--emerald)" },
    { name: "Image Alt Text Presence", value: "91%", color: "var(--emerald)" },
  ];

  const failedChecks = [
    {
      score: "84",
      scoreColor: "var(--rose)",
      title: "Rust vs Go in 2026: Microservices Benchmarks and Memory Safety Analysis",
      reasons: ["Low Keyword Density (0.4%)", "Flesch Reading Ease < 50 (Too Complex)"],
    },
    {
      score: "89",
      scoreColor: "var(--rose)",
      title: "TypeScript 5.6 Nullish Coalescing Performance and Type Inference",
      reasons: ["Image Alt Text Missing", "Meta Description > 160 Chars"],
    },
    {
      score: "86",
      scoreColor: "var(--rose)",
      title: "Kubernetes 1.32 Ingress Controllers & Envoy Proxy Migration",
      reasons: ["Code Snippet Syntax Error", "Duplicate Subheading H2"],
    },
    {
      score: "88",
      scoreColor: "var(--rose)",
      title: "GraphQL vs REST in 2026: Caching & Payload Overhead Analysis",
      reasons: ["Broken External Reference Link", "Low Word Count (1,200 words)"],
    },
    {
      score: "82",
      scoreColor: "var(--rose)",
      title: "WebAssembly System Interface (WASM/WASI) Microservices Guide",
      reasons: ["Fact Check Warning", "Missing JSON-LD Schema"],
    },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div>
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          Quality & SEO Audit Hub
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          Gate threshold: quality ≥ 90 · 5 articles currently blocked from publishing
        </p>
      </div>

      {/* Grid: Histogram + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-[12px] items-start">
        {/* Quality Histogram */}
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
          <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between">
            <span className="text-[13px] font-bold text-[var(--fg)]">
              Quality score distribution
            </span>
            <span className="text-[11px] text-[var(--mut)]">
              248 published articles · median 93
            </span>
          </div>
          <div className="p-[14px]">
            {/* SVG Histogram */}
            <div className="w-full h-[180px] flex items-end justify-between gap-[6px] border-b border-[var(--bd)] pb-[6px] relative">
              {/* Threshold Line at 90 */}
              <div className="absolute top-[20px] bottom-[26px] left-[70%] border-l-2 border-dashed border-[var(--rose)] z-10">
                <span className="text-[9px] font-mono text-[var(--rose)] font-bold bg-[var(--card)] px-[3px] -ml-[20px] -mt-[14px] block">
                  Gate ≥ 90
                </span>
              </div>

              {[
                { label: "< 80", h: 20, fill: "var(--rose)" },
                { label: "80-84", h: 35, fill: "var(--rose)" },
                { label: "85-89", h: 50, fill: "var(--rose)" },
                { label: "90-91", h: 80, fill: "var(--emerald)" },
                { label: "92-93", h: 140, fill: "var(--emerald)" },
                { label: "94-95", h: 120, fill: "var(--emerald)" },
                { label: "96-97", h: 90, fill: "var(--emerald)" },
                { label: "98-100", h: 45, fill: "var(--emerald)" },
              ].map((bar, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full justify-end">
                  <div
                    className="w-full rounded-[2px]"
                    style={{ height: `${bar.h}px`, background: bar.fill }}
                  />
                  <span className="font-mono text-[9px] text-[var(--faint)]">{bar.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats + Pass Rates */}
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-2 gap-[12px]">
            {qualityStats.map((q, idx) => (
              <div
                key={idx}
                className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[12px] shadow-[var(--shadow)]"
              >
                <div className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
                  {q.label}
                </div>
                <div
                  className="font-mono text-[22px] font-extrabold tracking-tight mt-[6px]"
                  style={{ color: q.color }}
                >
                  {q.value}
                </div>
                <div className="text-[10.5px] text-[var(--faint)] mt-[3px]">
                  {q.foot}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[13px] shadow-[var(--shadow)]">
            <div className="text-[12.5px] font-bold text-[var(--fg)] mb-[10px]">
              Check pass rates
            </div>
            <div className="flex flex-col gap-[9px]">
              {checkRates.map((c, idx) => (
                <div key={idx}>
                  <div className="flex justify-between text-[11px] mb-[4px]">
                    <span className="text-[var(--fg2)] font-semibold">{c.name}</span>
                    <span className="font-mono text-[10.5px] font-semibold text-[var(--mut)]">
                      {c.value}
                    </span>
                  </div>
                  <div className="h-[5px] rounded-[3px] bg-[var(--card2)] overflow-hidden">
                    <div
                      className="h-full rounded-[3px]"
                      style={{ width: c.value, background: c.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Blocked Queue */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between">
          <div className="flex items-center gap-[10px]">
            <span className="text-[13px] font-bold text-[var(--fg)]">
              Failed checks queue
            </span>
            <span className="font-mono text-[10px] font-semibold p-[2px_6px] rounded-[6px] bg-[rgba(244,63,94,0.14)] text-[var(--rose)]">
              5 blocked
            </span>
          </div>
          <button
            aria-label="Auto-fix all with Gemini"
            onClick={() => alert("Triggered Gemini auto-fix worker for 5 blocked articles!")}
            className="h-[27px] px-[11px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:bg-[#4f46e5] transition-colors"
          >
            Auto-fix all with Gemini
          </button>
        </div>

        <div className="flex flex-col">
          {failedChecks.map((f, idx) => (
            <div
              key={idx}
              className="flex items-center gap-[12px] p-[11px_14px] border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors"
            >
              <div className="w-[46px] flex-none text-center">
                <div
                  className="font-mono text-[15px] font-extrabold"
                  style={{ color: f.scoreColor }}
                >
                  {f.score}
                </div>
                <div className="text-[9px] text-[var(--faint)]">score</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-[var(--fg)] leading-snug">
                  {f.title}
                </div>
                <div className="flex gap-[6px] flex-wrap mt-[5px]">
                  {f.reasons.map((r, rIdx) => (
                    <span
                      key={rIdx}
                      className="text-[10px] font-semibold p-[2px_7px] rounded-[6px] bg-[rgba(244,63,94,0.12)] text-[var(--rose)]"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-[7px] flex-none">
                <button
                  aria-label="Auto-fix with Gemini"
                  onClick={() => alert(`Auto-fixing "${f.title}" with Gemini 2.5 Pro...`)}
                  className="h-[27px] px-[11px] rounded-[8px] border border-[var(--indigo)] bg-[var(--tint)] text-[var(--indigo)] text-[11px] font-semibold hover:bg-[var(--indigo)] hover:text-white transition-colors"
                >
                  Auto-fix
                </button>
                <button
                  aria-label="Manual override and publish"
                  onClick={() => alert(`Overriding QA gate for "${f.title}"`)}
                  className="h-[27px] px-[11px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--emerald)] hover:text-[var(--emerald)] transition-colors"
                >
                  Override & publish
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
