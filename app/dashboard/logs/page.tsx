"use client";

import React, { useEffect, useState } from "react";

export default function SystemLogsPage() {
  const [levelFilter, setLevelFilter] = useState("All levels");
  const [logs, setLogs] = useState<{
    time: string;
    level: string;
    worker: string;
    msg: string;
    color: string;
  }[]>([]);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => setLogs([]));
  }, []);

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
          Streaming · pipeline namespace · {logs.length} lines buffered
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
          {filteredLogs.length > 0 ? filteredLogs.map((l, idx) => (
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
          )) : (
            <div className="p-[32px_14px] text-center text-[12px] text-[var(--mut)]">
              No log entries yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
