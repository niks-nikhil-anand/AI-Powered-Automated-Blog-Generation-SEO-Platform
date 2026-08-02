"use client";

import React, { useEffect, useState } from "react";

export default function AssetLibraryPage() {
  const [selectedMonth, setSelectedMonth] = useState("All months");
  const [selectedType, setSelectedType] = useState("All types");
  const [assets, setAssets] = useState<{
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
  }[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadAssets = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (mounted) setAssets(data.assets ?? []);
        })
        .catch(() => {
          if (mounted) setAssets([]);
        });
    };
    loadAssets();
    const timer = window.setInterval(loadAssets, 10000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const months = Array.from(new Set(assets.map((asset) => asset.month).filter(Boolean))).sort().reverse();
  const types = Array.from(new Set(assets.map((asset) => asset.kind).filter(Boolean))).sort();
  const filteredAssets = assets.filter((asset) => {
    const matchesMonth = selectedMonth === "All months" || asset.month === selectedMonth;
    const matchesType = selectedType === "All types" || asset.kind.toLowerCase() === selectedType.toLowerCase();
    return matchesMonth && matchesType;
  });

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Asset Library & GCS Browser
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            gs://
            <span className="font-mono text-[var(--fg2)]">blogs/2026/08/</span> · {assets.length} objects
          </p>
        </div>
        <div className="flex gap-[7px] flex-wrap">
          <select
            id="select-asset-month"
            aria-label="Filter by month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-[30px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold outline-none"
          >
            <option>All months</option>
            {months.map((month) => (
              <option key={month}>{month}</option>
            ))}
          </select>

          <select
            id="select-asset-type"
            aria-label="Filter by file type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="h-[30px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold outline-none"
          >
            <option>All types</option>
            {types.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Asset Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[12px]">
        {filteredAssets.length > 0 ? filteredAssets.map((a, idx) => (
          <button
            key={idx}
            aria-label="Open asset preview"
            onClick={() => {
              if (a.publicUrl) window.open(a.publicUrl, "_blank", "noopener,noreferrer");
            }}
            className="text-left p-0 bg-[var(--card)] border border-[var(--bd)] rounded-[12px] overflow-hidden shadow-[var(--shadow)] flex flex-col hover:border-[var(--indigo)] transition-colors group"
          >
            <div className="h-[118px] bg-[var(--card2)] border-b border-[var(--bd)] flex items-center justify-center relative p-[8px]">
              {a.publicUrl && a.mimeType?.includes("image") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.publicUrl}
                  alt={a.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <span className="font-mono text-[9.5px] font-medium text-[var(--mut)] bg-[var(--card)] px-[7px] py-[3px] rounded-[5px] border border-[var(--bd)]">
                  {a.placeholder}
                </span>
              )}
              <span
                className="absolute top-[7px] left-[7px] font-mono font-semibold text-[9px] px-[6px] py-[2px] rounded-[5px] backdrop-blur-sm"
                style={{ background: a.kindBg, color: a.kindFg }}
              >
                {a.kind}
              </span>
            </div>
            <div className="p-[9px_10px]">
              <div className="text-[11.5px] font-semibold text-[var(--fg)] truncate group-hover:text-[var(--indigo)] transition-colors">
                {a.name}
              </div>
              <div className="flex items-center gap-[6px] mt-[4px] font-mono text-[10px] font-medium text-[var(--faint)]">
                <span>{a.dim}</span>
                <span>·</span>
                <span>{a.size}</span>
              </div>
              <div className="mt-[4px] font-mono text-[9.5px] text-[var(--faint)] truncate">
                {a.bucket ? `s3://${a.bucket}/${a.path}` : a.path}
              </div>
            </div>
          </button>
        )) : (
          <div className="sm:col-span-2 md:col-span-3 lg:col-span-4 bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[32px] text-center text-[12px] text-[var(--mut)] shadow-[var(--shadow)]">
            No assets yet.
          </div>
        )}
      </div>
    </div>
  );
}
