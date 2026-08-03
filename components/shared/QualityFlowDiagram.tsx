"use client";

import React from "react";

export interface QualityFlowData {
  writing: { active: number; queued: number; failed: number };
  quality: { active: number; queued: number; failed: number };
  publish: { active: number; queued: number; failed: number; published: number };
  regenerating: number;
  failed: number;
}

interface QualityFlowDiagramProps {
  flow: QualityFlowData;
  avgAttemptsToPass: number;
  retryLimit: number;
}

function StageNode({
  name,
  dotColor,
  pulse,
  bigValue,
  bigLabel,
  footLine,
}: {
  name: string;
  dotColor: string;
  pulse: boolean;
  bigValue: number | string;
  bigLabel: string;
  footLine: string;
}) {
  return (
    <div className="border border-[var(--bd)] rounded-[11px] p-[11px] bg-[var(--card2)] min-w-[132px]">
      <div className="flex items-center gap-[6px]">
        <span
          className={`w-[6px] h-[6px] rounded-full ${pulse ? "animate-dkpulse" : ""}`}
          style={{ background: dotColor }}
        />
        <span className="text-[11.5px] font-bold tracking-tight text-[var(--fg)]">{name}</span>
      </div>
      <div className="mt-[8px] flex items-baseline gap-[5px]">
        <span className="font-mono text-[18px] font-extrabold tracking-tight" style={{ color: dotColor }}>
          {bigValue}
        </span>
        <span className="text-[9.5px] text-[var(--mut)]">{bigLabel}</span>
      </div>
      <div className="mt-[3px] text-[9.5px] text-[var(--faint)]">{footLine}</div>
    </div>
  );
}

function ForwardArrow({ label, dashed = false }: { label: string; dashed?: boolean }) {
  return (
    <div className="flex-none flex flex-col items-center justify-center px-[6px] min-w-[70px]">
      <svg width="60" height="14" viewBox="0 0 60 14" fill="none" stroke="var(--bd2)" strokeWidth="1.6">
        <path d="M2 7h48" strokeDasharray={dashed ? "4 4" : undefined} className="animate-dkflow" />
        <path d="M44 3l6 4-6 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[9px] text-[var(--faint)] font-mono mt-[2px] whitespace-nowrap">{label}</span>
    </div>
  );
}

/**
 * The quality<->writing branch that the generic 7-stage strip on the
 * dashboard home page doesn't show: quality-worker either forwards to
 * publish, loops a failing blog back to writing-worker (max 4 attempts),
 * or - once that budget is exhausted - leaves it permanently FAILED for a
 * human to look at. Visual language (bordered node, pulsing dot, mono
 * counts) intentionally matches that existing strip.
 */
export function QualityFlowDiagram({ flow, avgAttemptsToPass, retryLimit }: QualityFlowDiagramProps) {
  return (
    <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
      <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between flex-wrap gap-[6px]">
        <span className="text-[13px] font-bold text-[var(--fg)]">Quality worker flow</span>
        <span className="text-[11px] text-[var(--mut)]">
          avg {avgAttemptsToPass} attempt{avgAttemptsToPass === 1 ? "" : "s"} to pass · retry budget {retryLimit}
        </span>
      </div>
      <div className="p-[16px_14px] overflow-x-auto">
        <div className="flex items-center gap-0 min-w-[560px]">
          <StageNode
            name="Writing"
            dotColor="var(--indigo)"
            pulse={flow.writing.active > 0}
            bigValue={flow.writing.active + flow.writing.queued}
            bigLabel="in flight"
            footLine={`${flow.writing.active} active · ${flow.writing.queued} queued`}
          />
          <ForwardArrow label={`retry loop`} dashed />
          <StageNode
            name="Quality Gate"
            dotColor="var(--amber)"
            pulse={flow.quality.active > 0}
            bigValue={flow.quality.active + flow.quality.queued}
            bigLabel="checking"
            footLine="score >= 90 to pass"
          />
          <ForwardArrow label="score >= 90" />
          <StageNode
            name="Publish"
            dotColor="var(--emerald)"
            pulse={flow.publish.active > 0}
            bigValue={flow.publish.published}
            bigLabel="published"
            footLine={`${flow.publish.active} active · ${flow.publish.queued} queued`}
          />
        </div>

        {/* Branch: quality gate loops back to writing, or falls to permanently failed */}
        <div className="mt-[14px] grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
          <div className="flex items-center gap-[10px] rounded-[10px] border border-[rgba(99,102,241,0.25)] bg-[var(--tint)] p-[10px_12px]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
              <path d="M17 2.1l4 4-4 4" />
              <path d="M3 12.7V12a4 4 0 0 1 4-4h14" />
              <path d="M7 21.9l-4-4 4-4" />
              <path d="M21 11.3V12a4 4 0 0 1-4 4H3" />
            </svg>
            <div className="min-w-0">
              <div className="text-[11.5px] font-bold text-[var(--indigo)]">
                {flow.regenerating} regenerating
              </div>
              <div className="text-[10px] text-[var(--fg2)] mt-[1px]">
                Failed the gate but under {retryLimit} attempts - looping back to writing-worker automatically.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-[10px] rounded-[10px] border border-[rgba(244,63,94,0.25)] bg-[rgba(244,63,94,0.08)] p-[10px_12px]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rose)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <div className="min-w-0">
              <div className="text-[11.5px] font-bold text-[var(--rose)]">
                {flow.failed} needs manual action
              </div>
              <div className="text-[10px] text-[var(--fg2)] mt-[1px]">
                Used all {retryLimit} writing attempts - will not retry again on its own. Regenerate or override below.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
