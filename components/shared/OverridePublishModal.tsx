"use client";

import React, { useState } from "react";

export type OverridableReport = {
  overallScore: number;
  recommendation: string;
};

interface OverridePublishModalProps {
  isOpen: boolean;
  title: string;
  /** null when quality-worker hasn't scored this blog yet. */
  report: OverridableReport | null;
  onClose: () => void;
  /** Throw to report a failure - the modal shows the error inline and stays open. */
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Mirrors the server-side rule in app/api/blogs/[id]/override-publish/route.ts -
 * override is a manual pass for borderline (85-89) articles only, never a
 * backdoor to hit a publishing target. Kept in sync manually since there's
 * no shared client/server module boundary for this one rule.
 */
function getBlockReason(report: OverridableReport | null): string | null {
  if (!report) return "This article hasn't been quality-scored yet - it will auto-publish if it passes.";
  if (report.recommendation === "Blocked - unverified facts") {
    return "The fact-check found unsupported claims. This needs a rewrite, not a manual pass.";
  }
  if (report.overallScore < 85) {
    return `This article scored ${report.overallScore}, below the override floor of 85. It needs a rewrite, not a manual pass.`;
  }
  return null;
}

export function OverridePublishModal({ isOpen, title, report, onClose, onConfirm }: OverridePublishModalProps) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const blockReason = getBlockReason(report);

  const handleClose = () => {
    if (pending) return;
    setReason("");
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A reason is required to override the quality gate.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-[rgba(2,6,23,0.6)] backdrop-blur-[3px] flex items-center justify-center p-[16px] animate-dkfade"
      onClick={(e) => {
        e.stopPropagation();
        handleClose();
      }}
    >
      <div
        className="w-[min(460px,100%)] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] p-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13.5px] font-bold text-[var(--fg)] mb-[6px]">Override quality gate</div>

        {blockReason ? (
          <>
            <div className="text-[11.5px] text-[var(--mut)] leading-snug mb-[14px]">
              <span className="font-semibold text-[var(--fg2)]">{title}</span>: {blockReason}
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="h-[30px] px-[13px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] transition-colors"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[11.5px] text-[var(--mut)] leading-snug mb-[12px]">
              <span className="font-semibold text-[var(--fg2)]">{title}</span> scored{" "}
              <span className="font-mono font-bold" style={{ color: "var(--amber)" }}>
                {report?.overallScore ?? 0}/100
              </span>{" "}
              - below the quality gate threshold ({">= 90"}), within the overridable range. Enter a reason to
              publish anyway.
            </div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Reviewed manually - factually accurate despite the low readability score."
              rows={3}
              disabled={pending}
              className="w-full rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] p-[9px_10px] text-[11.5px] text-[var(--fg)] resize-none focus:outline-none focus:border-[var(--indigo)] disabled:opacity-60"
            />
            {error && <div className="mt-[6px] text-[10.5px] text-[var(--rose)]">{error}</div>}
            <div className="mt-[14px] flex justify-end gap-[8px]">
              <button
                onClick={handleClose}
                disabled={pending}
                className="h-[30px] px-[13px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--bd2)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={pending || !reason.trim()}
                className="h-[30px] px-[13px] rounded-[8px] border border-transparent bg-[var(--emerald)] text-white text-[11.5px] font-bold hover:bg-emerald-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pending ? "Publishing…" : "Override & publish"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
