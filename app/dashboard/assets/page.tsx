"use client";

import React, { useEffect, useState } from "react";
import { LayoutGrid, List, Eye } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/ui/DataTable";
import { AssetDetailModal } from "@/components/shared/AssetDetailModal";

export default function AssetLibraryPage() {
  const [selectedMonth, setSelectedMonth] = useState("All months");
  const [selectedType, setSelectedType] = useState("All types");
  const [viewMode, setViewMode] = useState<"card" | "table">("table");
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
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
    createdAt?: string;
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

  const columns = [
    {
      key: "preview",
      header: "Preview",
      render: (row: any) => {
        if (row.publicUrl && row.mimeType?.includes("image")) {
          return (
            <div className="w-[36px] h-[36px] rounded bg-[var(--card2)] border border-[var(--bd)] overflow-hidden flex items-center justify-center relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={row.publicUrl} alt={row.name} className="w-full h-full object-cover" />
            </div>
          );
        }
        return (
          <div className="w-[36px] h-[36px] rounded bg-[var(--card2)] border border-[var(--bd)] flex items-center justify-center font-mono text-[9px] font-semibold text-[var(--mut)]">
            {row.placeholder}
          </div>
        );
      }
    },
    {
      key: "name",
      header: "Name",
      render: (row: any) => (
        <span className="font-semibold text-[var(--fg)] hover:text-[var(--indigo)] transition-colors">
          {row.name}
        </span>
      )
    },
    {
      key: "kind",
      header: "Type",
      render: (row: any) => (
        <span
          className="font-mono font-semibold text-[9px] px-[6px] py-[2px] rounded-[5px] whitespace-nowrap"
          style={{ background: row.kindBg, color: row.kindFg }}
        >
          {row.kind}
        </span>
      )
    },
    {
      key: "dim",
      header: "Dimensions",
      render: (row: any) => <span className="font-mono text-[var(--mut)]">{row.dim}</span>
    },
    {
      key: "size",
      header: "Size",
      render: (row: any) => <span className="font-mono text-[var(--mut)]">{row.size}</span>
    },
    {
      key: "path",
      header: "Storage Location",
      render: (row: any) => (
        <span className="font-mono text-[var(--mut)] block max-w-[250px] truncate" title={row.bucket ? `s3://${row.bucket}/${row.path}` : row.path}>
          {row.bucket ? `s3://${row.bucket}/${row.path}` : row.path}
        </span>
      )
    },
    {
      key: "actions",
      header: "",
      align: "center" as const,
      render: (row: any) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedAsset(row);
            setIsDetailOpen(true);
          }}
          className="w-[28px] h-[28px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--indigo)] hover:border-[var(--indigo)] flex items-center justify-center transition-colors"
          title="View Details"
        >
          <Eye size={13} />
        </button>
      )
    }
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-[16px] flex-wrap">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
            Asset Library 
          </h1>
          <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
            gs://
            <span className="font-mono text-[var(--fg2)]">blogs/2026/08/</span> · {assets.length} objects
          </p>
        </div>
        <div className="flex gap-[7px] items-center flex-wrap">
          {/* View Switcher */}
          <div className="flex bg-[var(--card2)] border border-[var(--bd)] p-[2px] rounded-[8px] h-[30px] items-center">
            <button
              onClick={() => setViewMode("card")}
              className={`p-[4px_8px] rounded-[6px] transition-colors flex items-center gap-[4px] text-[11px] font-semibold ${
                viewMode === "card"
                  ? "bg-[var(--indigo)] text-white"
                  : "text-[var(--mut)] hover:text-[var(--fg)]"
              }`}
              title="Card View"
            >
              <LayoutGrid size={13} />
              Cards
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-[4px_8px] rounded-[6px] transition-colors flex items-center gap-[4px] text-[11px] font-semibold ${
                viewMode === "table"
                  ? "bg-[var(--indigo)] text-white"
                  : "text-[var(--mut)] hover:text-[var(--fg)]"
              }`}
              title="Table View"
            >
              <List size={13} />
              Table
            </button>
          </div>

          {/* Month Selector */}
          <Select value={selectedMonth} onValueChange={(val) => setSelectedMonth(val ?? "All months")}>
            <SelectTrigger className="h-[30px] min-w-[110px] text-[11.5px] font-semibold border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] rounded-[8px] outline-none">
              <SelectValue placeholder="All months" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--card)] border border-[var(--bd)] text-[var(--fg)]">
              <SelectItem value="All months">All months</SelectItem>
              {months.map((month) => (
                <SelectItem key={month} value={month}>{month}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Type Selector */}
          <Select value={selectedType} onValueChange={(val) => setSelectedType(val ?? "All types")}>
            <SelectTrigger className="h-[30px] min-w-[110px] text-[11.5px] font-semibold border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] rounded-[8px] outline-none">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--card)] border border-[var(--bd)] text-[var(--fg)]">
              <SelectItem value="All types">All types</SelectItem>
              {types.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Asset List/Grid View */}
      {filteredAssets.length > 0 ? (
        viewMode === "card" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[12px]">
            {filteredAssets.map((a, idx) => (
              <button
                key={idx}
                aria-label="Open asset preview"
                onClick={() => {
                  setSelectedAsset(a);
                  setIsDetailOpen(true);
                }}
                className="text-left p-0 bg-[var(--card)] border border-[var(--bd)] rounded-[12px] overflow-hidden shadow-[var(--shadow)] flex flex-col hover:border-[var(--indigo)] transition-colors group relative"
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
                  
                  {/* Eye Icon Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-[34px] h-[34px] rounded-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform duration-200">
                      <Eye size={16} />
                    </div>
                  </div>
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
            ))}
          </div>
        ) : (
          <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
            <DataTable
              columns={columns}
              data={filteredAssets}
              onRowClick={(row) => {
                setSelectedAsset(row);
                setIsDetailOpen(true);
              }}
            />
          </div>
        )
      ) : (
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[32px] text-center text-[12px] text-[var(--mut)] shadow-[var(--shadow)]">
          No assets yet.
        </div>
      )}

      {/* Asset Detail Modal */}
      <AssetDetailModal
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedAsset(null);
        }}
        asset={selectedAsset}
      />
    </div>
  );
}


