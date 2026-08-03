"use client";

import React, { useState } from "react";
import { Eye, Copy, ExternalLink, Calendar, Database, Image, FileText, Check } from "lucide-react";

interface Asset {
  id: string;
  name: string;
  placeholder: string;
  kind: string;
  dim: string;
  size: string;
  sizeBytes?: number;
  path: string;
  bucket?: string;
  publicUrl?: string;
  mimeType?: string;
  month?: string;
  kindBg: string;
  kindFg: string;
  createdAt?: string;
}

interface AssetDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

export function AssetDetailModal({ isOpen, onClose, asset }: AssetDetailModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !asset) return null;

  const handleCopy = () => {
    const fullPath = asset.bucket ? `s3://${asset.bucket}/${asset.path}` : asset.path;
    navigator.clipboard.writeText(fullPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isImage = asset.publicUrl && asset.mimeType?.includes("image");

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.6)] backdrop-blur-sm flex items-center justify-center p-[16px] animate-dkfade"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[550px] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[16px] h-[48px] border-b border-[var(--bd)] bg-[var(--card2)]">
          <span className="text-[13px] font-bold text-[var(--fg)] flex items-center gap-[6px]">
            <Eye size={14} /> Asset Details
          </span>
          <button
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--fg)] flex items-center justify-center text-[11px]"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-[16px] flex flex-col gap-[16px] overflow-y-auto max-h-[75vh]">
          {/* Preview Container */}
          <div className="w-full h-[220px] rounded-[10px] bg-[var(--card2)] border border-[var(--bd)] flex items-center justify-center relative overflow-hidden group">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.publicUrl}
                alt={asset.name}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-[8px]">
                <FileText size={48} className="text-[var(--faint)]" />
                <span className="font-mono text-[10.5px] font-semibold text-[var(--mut)] bg-[var(--card)] px-[7px] py-[3px] rounded-[5px] border border-[var(--bd)]">
                  {asset.placeholder}
                </span>
              </div>
            )}
            <span
              className="absolute top-[10px] left-[10px] font-mono font-semibold text-[9.5px] px-[8px] py-[3px] rounded-[6px] shadow-sm"
              style={{ background: asset.kindBg, color: asset.kindFg }}
            >
              {asset.kind}
            </span>
          </div>

          {/* Metadata Section */}
          <div className="flex flex-col gap-[12px]">
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] mb-[4px]">
                Asset Name
              </div>
              <div className="text-[13px] font-bold text-[var(--fg)] break-all">
                {asset.name}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-[12px]">
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] mb-[4px]">
                  Mime Type
                </div>
                <div className="text-[11.5px] font-semibold text-[var(--fg2)] flex items-center gap-[5px]">
                  <Image size={12} className="text-[var(--mut)]" />
                  {asset.mimeType || "unknown"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] mb-[4px]">
                  File Size
                </div>
                <div className="text-[11.5px] font-semibold text-[var(--fg2)]">
                  {asset.size}
                </div>
              </div>
            </div>

            {asset.dim && asset.dim !== "-" && (
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] mb-[4px]">
                  Dimensions
                </div>
                <div className="text-[11.5px] font-semibold text-[var(--fg2)]">
                  {asset.dim}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] mb-[4px]">
                Storage Path
              </div>
              <div className="flex gap-[6px]">
                <div className="flex-1 min-w-0 bg-[var(--card2)] border border-[var(--bd)] rounded-[8px] p-[8px_10px] font-mono text-[11px] text-[var(--mut)] truncate">
                  {asset.bucket ? `s3://${asset.bucket}/${asset.path}` : asset.path}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="h-[31px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold flex items-center justify-center gap-[5px] hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-all"
                  title="Copy Path to Clipboard"
                >
                  {copied ? <Check size={13} className="text-[var(--emerald)]" /> : <Copy size={13} />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>

            {asset.createdAt && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px] pt-[4px] border-t border-[var(--bd)] mt-[4px]">
                <div className="flex items-center gap-[6px] text-[11px] text-[var(--mut)]">
                  <Calendar size={12} />
                  <span>Created {new Date(asset.createdAt).toLocaleString("en-IN")}</span>
                </div>
                {asset.bucket && (
                  <div className="flex items-center gap-[6px] text-[11px] text-[var(--mut)] md:justify-end">
                    <Database size={12} />
                    <span>Bucket: {asset.bucket}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-[8px] justify-end p-[12px_16px] border-t border-[var(--bd)] bg-[var(--card2)]">
          <button
            type="button"
            onClick={onClose}
            className="h-[32px] px-[14px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[12px] font-semibold"
          >
            Close
          </button>
          {asset.publicUrl && (
            <a
              href={asset.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-[32px] px-[14px] rounded-[8px] bg-[var(--indigo)] text-white text-[12px] font-bold flex items-center gap-[6px] hover:bg-[#4f46e5] transition-colors"
            >
              <ExternalLink size={13} />
              Open in Browser
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
