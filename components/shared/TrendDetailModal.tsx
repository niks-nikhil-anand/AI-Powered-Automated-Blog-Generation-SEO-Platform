"use client";

import React from "react";
import { Eye, Trash2, CheckCircle, HelpCircle, X, ExternalLink, Calendar, Compass } from "lucide-react";

interface TrendRow {
  id: string;
  srcInitial: string;
  source: string;
  srcColor: string;
  score: string;
  scoreBg: string;
  scoreFg: string;
  title: string;
  cat: string;
  rec: string;
  recBg: string;
  recFg: string;
  volume: string;
  scorePct: string;
}

interface TrendDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  trend: TrendRow | null;
  onApprove: (trend: TrendRow) => void;
  onSkip: (trend: TrendRow) => void;
  onDelete: (trend: TrendRow) => void;
  minWritingScore?: number;
}

export function TrendDetailModal({
  isOpen,
  onClose,
  trend,
  onApprove,
  onSkip,
  onDelete,
  minWritingScore = 90,
}: TrendDetailModalProps) {
  if (!isOpen || !trend) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.6)] backdrop-blur-sm flex items-center justify-center p-[16px] animate-dkfade"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] bg-[var(--card)] border border-[var(--bd)] rounded-[16px] shadow-[var(--shadow)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[16px] h-[48px] border-b border-[var(--bd)] bg-[var(--card2)]">
          <span className="text-[13.5px] font-bold text-[var(--fg)] flex items-center gap-[6px]">
            <Eye size={14} className="text-[var(--indigo)]" /> Trend Signal Details
          </span>
          <button
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--fg)] flex items-center justify-center text-[11px] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-[18px] flex flex-col gap-[16px]">
          {/* Main Card View */}
          <div className="border-l-[4px] border-[var(--indigo)] bg-[var(--card2)] p-[14px] rounded-[0_12px_12px_0] flex flex-col gap-[8px]">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)]">
              Topic / Keyword Title
            </span>
            <div className="text-[14.5px] font-extrabold leading-snug text-[var(--fg)]">
              {trend.title}
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-[12px] bg-[var(--card2)] border border-[var(--bd)] rounded-[12px] p-[14px]">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                Source
              </span>
              <span className="text-[12px] font-semibold text-[var(--fg2)] flex items-center gap-[6px]">
                <span
                  className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center font-mono font-extrabold text-[8px] text-white"
                  style={{ background: trend.srcColor }}
                >
                  {trend.srcInitial}
                </span>
                {trend.source}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                Category
              </span>
              <span className="text-[12px] font-semibold text-[var(--fg2)]">
                {trend.cat}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                Trend Score
              </span>
              <span
                className="font-mono text-[10.5px] font-bold px-[8px] py-[2px] rounded-[6px]"
                style={{ background: trend.scoreBg, color: trend.scoreFg }}
              >
                {trend.score}%
              </span>
              {Number(trend.score) < minWritingScore && (
                <div className="text-[10px] text-[var(--amber)] mt-[4px]">
                  Below the {minWritingScore}% write threshold - approving will ask for a reason.
                </div>
              )}
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                Volume / Age
              </span>
              <span className="text-[11.5px] font-medium text-[var(--mut)]">
                {trend.volume}
              </span>
            </div>

            {trend.rec && (
              <div className="col-span-2 border-t border-[var(--bd)] pt-[10px] mt-[4px]">
                <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                  System Recommendation
                </span>
                <span
                  className="text-[10.5px] font-bold px-[8px] py-[3px] rounded-[6px] inline-block"
                  style={{ background: trend.recBg, color: trend.recFg }}
                >
                  {trend.rec}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-[12px_16px] border-t border-[var(--bd)] flex items-center justify-between gap-[8px] bg-[var(--card2)]">
          {/* Delete Action (Left Aligned) */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onDelete(trend);
            }}
            className="h-[32px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--rose)] hover:bg-[rgba(244,63,94,0.06)] hover:border-[var(--rose)] text-[12px] font-semibold flex items-center gap-[5px] transition-colors"
          >
            <Trash2 size={13} />
            Delete
          </button>

          {/* Right Aligned CTA Buttons */}
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={() => {
                onClose();
                onSkip(trend);
              }}
              className="h-[32px] px-[14px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[12px] font-semibold hover:border-[var(--bd2)] transition-colors"
            >
              Skip Topic
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onApprove(trend);
              }}
              className="h-[32px] px-[14px] rounded-[8px] border border-transparent bg-[var(--emerald)] text-white text-[12px] font-bold hover:bg-[#059669] shadow-sm flex items-center gap-[5px] transition-colors"
            >
              <CheckCircle size={13} />
              Approve Pipeline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
