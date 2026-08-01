"use client";

import React, { useState } from "react";

export default function AssetLibraryPage() {
  const [selectedMonth, setSelectedMonth] = useState("2026 / 08");
  const [selectedType, setSelectedType] = useState("All types");

  const assets = [
    {
      name: "nextjs-15-ppr-hero.webp",
      placeholder: "Hero WebP 1920×1080",
      kind: "Hero",
      dim: "1920×1080",
      size: "342 KB",
      kindBg: "rgba(99,102,241,0.14)",
      kindFg: "var(--indigo)",
    },
    {
      name: "nextjs-15-ppr-og.webp",
      placeholder: "OG Image 1200×630",
      kind: "OG Image",
      dim: "1200×630",
      size: "184 KB",
      kindBg: "rgba(16,185,129,0.14)",
      kindFg: "var(--emerald)",
    },
    {
      name: "rust-vs-go-hero.webp",
      placeholder: "Hero WebP 1920×1080",
      kind: "Hero",
      dim: "1920×1080",
      size: "389 KB",
      kindBg: "rgba(99,102,241,0.14)",
      kindFg: "var(--indigo)",
    },
    {
      name: "bun-sqlite-thumb.webp",
      placeholder: "Thumbnail 512×512",
      kind: "Thumbnail",
      dim: "512×512",
      size: "68 KB",
      kindBg: "rgba(245,158,11,0.14)",
      kindFg: "var(--amber)",
    },
    {
      name: "deepseek-v3-banner.webp",
      placeholder: "Social Banner 1200×630",
      kind: "Social Banner",
      dim: "1200×630",
      size: "215 KB",
      kindBg: "rgba(14,165,233,0.14)",
      kindFg: "var(--sky)",
    },
    {
      name: "tailwind-v4-hero.webp",
      placeholder: "Hero WebP 1920×1080",
      kind: "Hero",
      dim: "1920×1080",
      size: "298 KB",
      kindBg: "rgba(99,102,241,0.14)",
      kindFg: "var(--indigo)",
    },
    {
      name: "docker-multistage-og.webp",
      placeholder: "OG Image 1200×630",
      kind: "OG Image",
      dim: "1200×630",
      size: "192 KB",
      kindBg: "rgba(16,185,129,0.14)",
      kindFg: "var(--emerald)",
    },
    {
      name: "postgres-17-hero.webp",
      placeholder: "Hero WebP 1920×1080",
      kind: "Hero",
      dim: "1920×1080",
      size: "360 KB",
      kindBg: "rgba(99,102,241,0.14)",
      kindFg: "var(--indigo)",
    },
    {
      name: "typescript-56-thumb.webp",
      placeholder: "Thumbnail 512×512",
      kind: "Thumbnail",
      dim: "512×512",
      size: "74 KB",
      kindBg: "rgba(245,158,11,0.14)",
      kindFg: "var(--amber)",
    },
    {
      name: "vite-6-environment-hero.webp",
      placeholder: "Hero WebP 1920×1080",
      kind: "Hero",
      dim: "1920×1080",
      size: "310 KB",
      kindBg: "rgba(99,102,241,0.14)",
      kindFg: "var(--indigo)",
    },
    {
      name: "dev-logo-avatar.webp",
      placeholder: "Avatar 256×256",
      kind: "Avatar",
      dim: "256×256",
      size: "32 KB",
      kindBg: "var(--card2)",
      kindFg: "var(--fg2)",
    },
    {
      name: "redis-cluster-banner.webp",
      placeholder: "Social Banner 1200×630",
      kind: "Social Banner",
      dim: "1200×630",
      size: "240 KB",
      kindBg: "rgba(14,165,233,0.14)",
      kindFg: "var(--sky)",
    },
  ];

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
            gs://devkit-market-media/
            <span className="font-mono text-[var(--fg2)]">blogs/2026/08/</span> · 1,284 objects · 6.2 GB
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
        {filteredAssets.map((a, idx) => (
          <button
            key={idx}
            aria-label="Open asset preview"
            onClick={() => alert(`Asset GCS path: gs://devkit-market-media/blogs/2026/08/${a.name}`)}
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
        ))}
      </div>
    </div>
  );
}
