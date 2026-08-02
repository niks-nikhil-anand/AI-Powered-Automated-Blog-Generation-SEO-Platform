"use client";

import React from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  suffix?: string;
  delta?: string;
  deltaBg?: string;
  deltaFg?: string;
  pct?: string;
  color?: string;
  foot?: string;
}

export function MetricCard({
  label,
  value,
  suffix = "",
  delta = "+0%",
  deltaBg = "var(--card2)",
  deltaFg = "var(--mut)",
  pct = "70%",
  color = "var(--indigo)",
  foot,
}: MetricCardProps) {
  return (
    <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[13px_14px] shadow-[var(--shadow)] relative overflow-hidden flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[var(--mut)]">
          {label}
        </span>
        <span
          className="font-mono text-[10px] font-semibold p-[2px_6px] rounded-[6px]"
          style={{ background: deltaBg, color: deltaFg }}
        >
          {delta}
        </span>
      </div>

      <div className="flex items-baseline gap-[6px] mt-[9px]">
        <span className="text-[27px] font-extrabold tracking-tight leading-none text-[var(--fg)]">
          {value}
        </span>
        {suffix && (
          <span className="text-[12px] font-semibold text-[var(--faint)]">
            {suffix}
          </span>
        )}
      </div>

      <div className="mt-[11px] h-[4px] rounded-[3px] bg-[var(--card2)] overflow-hidden">
        <div
          className="h-full rounded-[3px] transition-all duration-300"
          style={{ width: pct, background: color }}
        />
      </div>

      {foot && (
        <div className="mt-[7px] text-[10.5px] text-[var(--faint)]">
          {foot}
        </div>
      )}
    </div>
  );
}
