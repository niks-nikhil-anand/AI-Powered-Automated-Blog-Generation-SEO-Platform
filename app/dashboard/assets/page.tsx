"use client";

import React, { useEffect, useState } from "react";

export default function AssetLibraryPage() {
  const [selectedMonth, setSelectedMonth] = useState("2026 / 08");
  const [selectedType, setSelectedType] = useState("All types");
  const [assets, setAssets] = useState<{
    id: string;
    name: string;
    placeholder: string;
    kind: string;
    dim: string;
    size: string;
    path: string;
    kindBg: string;
    kindFg: string;
  }[]>([]);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data) => setAssets(data.assets ?? []))
      .catch(() => setAssets([]));
  }, []);

  const filteredAssets = selectedType === "All types"
    ? assets
    : assets.filter((a) => a.kind.toLowerCase() === selectedType.toLowerCase());

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
            <option>2026 / 08</option>
            <option>2026 / 07</option>
            <option>2026 / 06</option>
          </select>

          <select
            id="select-asset-type"
            aria-label="Filter by file type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="h-[30px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold outline-none"
          >
            <option>All types</option>
            <option>Hero</option>
            <option>OG Image</option>
            <option>Social Banner</option>
            <option>Thumbnail</option>
          </select>
        </div>
      </div>

      {/* Asset Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[12px]">
        {filteredAssets.length > 0 ? filteredAssets.map((a, idx) => (
          <button
            key={idx}
            aria-label="Open asset preview"
            onClick={() => alert(`Asset path: ${a.path}`)}
            className="text-left p-0 bg-[var(--card)] border border-[var(--bd)] rounded-[12px] overflow-hidden shadow-[var(--shadow)] flex flex-col hover:border-[var(--indigo)] transition-colors group"
          >
            <div className="h-[118px] bg-[var(--card2)] border-b border-[var(--bd)] flex items-center justify-center relative p-[8px]">
              <span className="font-mono text-[9.5px] font-medium text-[var(--mut)] bg-[var(--card)] px-[7px] py-[3px] rounded-[5px] border border-[var(--bd)]">
                {a.placeholder}
              </span>
              <span
                className="absolute top-[7px] left-[7px] font-mono font-semibold text-[9px] px-[6px] py-[2px] rounded-[5px]"
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
