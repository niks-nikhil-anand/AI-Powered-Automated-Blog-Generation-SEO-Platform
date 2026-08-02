"use client";

import React, { useEffect, useState } from "react";

export default function QualityAuditPage() {
  const [quality, setQuality] = useState({
    avgQuality: 0,
    failedCount: 0,
    checkedCount: 0,
    blocked: [] as {
      id: string;
      title: string;
      quality: string;
      qFg?: string;
      qualityReport?: {
        checks?: {
          label: string;
          score: number;
          maxScore: number;
          notes: string[];
        }[];
      };
    }[],
    distribution: [] as {
      label: string;
      h: number;
      count: number;
      fill: string;
    }[],
    checkRates: [] as {
      name: string;
      value: string;
      color: string;
    }[],
  });

  useEffect(() => {
    let mounted = true;
    const loadQuality = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (mounted && data.quality) setQuality(data.quality);
        })
        .catch(() => {});
    };
    loadQuality();
    const timer = window.setInterval(loadQuality, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const qualityStats = [
    { label: "Median Quality", value: String(quality.avgQuality), foot: "target >= 90", color: quality.avgQuality >= 90 ? "var(--emerald)" : "var(--mut)" },
    { label: "Articles Blocked", value: String(quality.blocked.length), foot: "needs review", color: quality.blocked.length ? "var(--rose)" : "var(--mut)" },
    { label: "Checked Articles", value: String(quality.checkedCount), foot: "SEO records", color: "var(--indigo)" },
    { label: "Failed Articles", value: String(quality.failedCount), foot: "failed status", color: quality.failedCount ? "var(--rose)" : "var(--mut)" },
  ];

  const checkRates = quality.checkRates.length > 0 ? quality.checkRates : [
    { name: "SEO Structure", value: "0%", color: "var(--mut)" },
    { name: "Content Completeness", value: "0%", color: "var(--mut)" },
    { name: "Readability", value: "0%", color: "var(--mut)" },
    { name: "Content Quality", value: "0%", color: "var(--mut)" },
    { name: "Keyword Optimization", value: "0%", color: "var(--mut)" },
    { name: "Technical SEO", value: "0%", color: "var(--mut)" },
    { name: "Formatting & UX", value: "0%", color: "var(--mut)" },
    { name: "Media Quality", value: "0%", color: "var(--mut)" },
    { name: "AI & Fact Quality", value: "0%", color: "var(--mut)" },
    { name: "Publishing Readiness", value: "0%", color: "var(--mut)" },
  ];
  const distribution = quality.distribution.length > 0 ? quality.distribution : [
    { label: "< 80", h: 0, count: 0, fill: "var(--rose)" },
    { label: "80-84", h: 0, count: 0, fill: "var(--rose)" },
    { label: "85-89", h: 0, count: 0, fill: "var(--amber)" },
    { label: "90-91", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "92-93", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "94-95", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "96-97", h: 0, count: 0, fill: "var(--emerald)" },
    { label: "98-100", h: 0, count: 0, fill: "var(--emerald)" },
  ];

  const failedChecks: {
    score: string;
    scoreColor: string;
    title: string;
    reasons: string[];
  }[] = quality.blocked.map((row) => ({
    score: row.quality,
    scoreColor: row.qFg ?? "var(--rose)",
    title: row.title,
    reasons:
      row.qualityReport?.checks
        ?.filter((check) => check.score < 9)
        .slice(0, 3)
        .map((check) => `${check.label}: ${check.score}/${check.maxScore}`) ??
      ["Quality score is below publishing threshold"],
  }));

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div>
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          Quality & SEO Audit Hub
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          Gate threshold: quality {" >= "} 90 · {failedChecks.length} articles currently blocked from publishing
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
              {quality.checkedCount} checked articles · median {quality.avgQuality}
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

              {distribution.map((bar, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full justify-end">
                  <div
                    className="w-full rounded-[2px]"
                    style={{ height: `${bar.h}px`, background: bar.fill }}
                    title={`${bar.count} articles`}
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
              {failedChecks.length} blocked
            </span>
          </div>
          <button
            aria-label="Auto-fix all with Gemini"
            onClick={() => alert("No blocked articles to auto-fix.")}
            className="h-[27px] px-[11px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:bg-[#4f46e5] transition-colors"
          >
            Auto-fix all with Gemini
          </button>
        </div>

        <div className="flex flex-col">
          {failedChecks.length > 0 ? failedChecks.map((f, idx) => (
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
          )) : (
            <div className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
              No failed checks yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
