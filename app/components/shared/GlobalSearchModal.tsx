"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ isOpen, onClose }: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Open triggered by hotkey
        }
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const quickLinks = [
    { label: "Content Pipeline", href: "/dashboard/blogs", category: "Blogs" },
    { label: "Next.js 15 Partial Prerendering Guide", href: "/dashboard/blogs", category: "Published Blog" },
    { label: "Gemini 2.5 Flash CLI Benchmarks", href: "/dashboard/trends", category: "Trend Signal" },
    { label: "BullMQ writing_queue Worker", href: "/dashboard/workers", category: "Queue Job" },
    { label: "Imagen 4 Hero Images", href: "/dashboard/assets", category: "GCS Asset" },
  ];

  const filteredLinks = query
    ? quickLinks.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.category.toLowerCase().includes(query.toLowerCase())
      )
    : quickLinks;

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.65)] backdrop-blur-sm flex items-start justify-center pt-[15vh] px-[16px] animate-dkfade"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-[10px] px-[14px] h-[48px] border-b border-[var(--bd)] bg-[var(--card2)]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--mut)]">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blogs, trends, workers, assets..."
            className="flex-1 bg-transparent border-0 outline-none text-[13px] text-[var(--fg)] placeholder-[var(--faint)]"
          />
          <button
            onClick={onClose}
            className="text-[10px] font-mono px-[6px] py-[2px] rounded-[5px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--fg)]"
          >
            ESC
          </button>
        </div>

        <div className="p-[8px] max-h-[340px] overflow-y-auto flex flex-col gap-[2px]">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--faint)] px-[10px] py-[6px]">
            Navigation & Resources
          </div>
          {filteredLinks.length > 0 ? (
            filteredLinks.map((item, idx) => (
              <Link
                key={idx}
                href={item.href}
                onClick={onClose}
                className="flex items-center justify-between p-[9px_10px] rounded-[8px] text-[12.5px] font-medium text-[var(--fg2)] hover:bg-[var(--card2)] hover:text-[var(--fg)] transition-colors"
              >
                <span>{item.label}</span>
                <span className="font-mono text-[10px] px-[6px] py-[2px] rounded-[5px] bg-[var(--tint)] text-[var(--indigo)] font-semibold">
                  {item.category}
                </span>
              </Link>
            ))
          ) : (
            <div className="p-[20px] text-center text-[12px] text-[var(--mut)]">
              No matching records found for "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
