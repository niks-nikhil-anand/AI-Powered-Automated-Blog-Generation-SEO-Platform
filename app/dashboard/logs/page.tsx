"use client";

import React, { useState } from "react";

export default function SystemLogsPage() {
  const [levelFilter, setLevelFilter] = useState("All levels");

  const logs = [
    { time: "11:42:15.102", level: "INFO", worker: "publish_worker", msg: "Blog successfully published to DevKit Market CMS (id: b-4910)", color: "var(--emerald)" },
    { time: "11:42:14.890", level: "INFO", worker: "publish_worker", msg: "Pinged Google Search Console Indexing API (URL: https://devkit.market/blog/nextjs-15-ppr)", color: "var(--emerald)" },
    { time: "11:42:10.450", level: "INFO", worker: "quality_worker", msg: "Quality Analysis completed for b-4910. Score: 94/100 -> Gate Passed", color: "var(--emerald)" },
    { time: "11:41:58.210", level: "WARN", worker: "quality_worker", msg: "Flesch Reading Ease score 62/100 slightly below recommended threshold 70", color: "var(--amber)" },
    { time: "11:41:45.312", level: "INFO", worker: "image_worker", msg: "Vertex Imagen 4 image generation complete: hero.webp (1920x1080, 342KB)", color: "var(--emerald)" },
    { time: "11:41:12.801", level: "INFO", worker: "image_worker", msg: "Uploading generated image to GCS bucket gs://devkit-market-media/blogs/2026/08/", color: "var(--indigo)" },
    { time: "11:41:02.110", level: "INFO", worker: "writing_worker", msg: "Gemini 2.5 Pro completed article synthesis (2,840 words, 14,200 tokens)", color: "var(--emerald)" },
    { time: "11:40:48.904", level: "ERROR", worker: "image_worker", msg: "Imagen API Rate Limit Exceeded (429 Too Many Requests) - Retrying job 89239 in 30s", color: "var(--rose)" },
    { time: "11:40:32.400", level: "INFO", worker: "outline_worker", msg: "Generated 6 H2 headings and FAQ section for 'Next.js 15 PPR'", color: "var(--indigo)" },
    { time: "11:40:14.220", level: "INFO", worker: "planning_worker", msg: "Planned SEO metadata: title, description, and keywords extracted", color: "var(--indigo)" },
    { time: "11:40:02.100", level: "INFO", worker: "research_worker", msg: "Crawled 42 signals across Google Trends, HN, GitHub Trending, and Reddit", color: "var(--emerald)" },
    { time: "11:39:45.090", level: "INFO", worker: "cron_scheduler", msg: "Cron job 'daily_blog_generator' triggered scheduled pipeline run", color: "var(--mut)" },
  ];

  const filteredLogs = levelFilter === "All levels"
    ? logs
    : logs.filter((l) => l.level.toLowerCase() === levelFilter.toLowerCase());

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div>
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          System Logs
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          Streaming · pipeline namespace · 1,204 lines buffered
        </p>
      </div>

      {/* Log Console Window */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        {/* Console Header */}
        <div className="flex items-center gap-[7px] p-[10px_12px] border-b border-[var(--bd)] bg-[var(--card2)]">
          <span className="w-[6px] h-[6px] rounded-full bg-[var(--emerald)] animate-dkpulse" />
          <span className="text-[11.5px] font-semibold text-[var(--fg)]">
            Live tail stream
          </span>
          <select
            id="select-log-level"
            aria-label="Filter log level"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="ml-auto h-[27px] px-[8px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold outline-none"
          >
            <option>All levels</option>
            <option>Error</option>
            <option>Warn</option>
            <option>Info</option>
          </select>
        </div>

        {/* Console Stream */}
        <div className="p-[10px_0] max-h-[540px] overflow-y-auto bg-[var(--card)] font-mono text-[11px] leading-relaxed">
          {filteredLogs.map((l, idx) => (
            <div
              key={idx}
              className="flex gap-[10px] p-[4px_14px] hover:bg-[var(--card2)] transition-colors border-b border-transparent"
            >
              <span className="flex-none text-[var(--faint)]">{l.time}</span>
              <span
                className="flex-none w-[48px] font-bold"
                style={{ color: l.color }}
              >
                {l.level}
              </span>
              <span className="flex-none w-[130px] text-[var(--mut)] truncate">
                {l.worker}
              </span>
              <span className="text-[var(--fg2)] min-w-0 flex-1">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
