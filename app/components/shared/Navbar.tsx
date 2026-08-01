"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";

interface NavbarProps {
  onOpenCmdk?: () => void;
  onRunNow?: () => void;
}

export function Navbar({ onOpenCmdk, onRunNow }: NavbarProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);

  const getBreadcrumb = () => {
    switch (pathname) {
      case "/dashboard/blogs":
        return "Content Pipeline & Blog Management";
      case "/dashboard/trends":
        return "Trend Research & Topic Selection";
      case "/dashboard/assets":
        return "Asset Library & GCS Browser";
      case "/dashboard/quality":
        return "SEO & Quality Audit Hub";
      case "/dashboard/workers":
        return "Queue & Worker Operations";
      case "/dashboard/logs":
        return "Streaming System Logs";
      case "/dashboard/settings":
        return "Settings & AI Models";
      default:
        return "Executive Dashboard";
    }
  };

  const notifications = [
    {
      title: "Blog Published Successfully",
      meta: "Next.js 15 Partial Prerendering Guide",
      time: "2m ago",
      color: "var(--emerald)",
    },
    {
      title: "Quality Check Flagged Rejection",
      meta: "Rust vs Go microservices article (score 84/100)",
      time: "14m ago",
      color: "var(--rose)",
    },
    {
      title: "Imagen 4 Hero Generated",
      meta: "gs://devkit-market-media/blogs/2026/08/hero.webp",
      time: "28m ago",
      color: "var(--indigo)",
    },
    {
      title: "BullMQ Research Worker Started",
      meta: "Crawled 42 signals from Google Trends & HN",
      time: "1h ago",
      color: "var(--amber)",
    },
  ];

  return (
    <header className="sticky top-0 z-40 h-[56px] flex-none flex items-center gap-[12px] px-[18px] border-b border-[var(--bd)] bg-[var(--glass)] backdrop-blur-md">
      {/* Breadcrumb */}
      <div className="flex items-center gap-[7px] text-[12px] text-[var(--mut)] whitespace-nowrap">
        <span>Dashboard</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="color-[var(--fg)] font-semibold text-[var(--fg)]">
          {getBreadcrumb()}
        </span>
      </div>

      {/* Global Search Button */}
      <button
        id="btn-global-search"
        aria-label="Open global search"
        onClick={onOpenCmdk}
        className="ml-[14px] flex-1 max-w-[400px] flex items-center gap-[8px] h-[32px] px-[10px] rounded-[9px] border border-[var(--bd)] bg-[var(--card)] text-[var(--faint)] text-[12px] text-left hover:border-[var(--bd2)] transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span>Search blogs, trends, jobs…</span>
        <span className="ml-auto font-mono text-[10px] font-semibold px-[5px] py-[2px] rounded-[5px] border border-[var(--bd)] bg-[var(--card2)] text-[var(--fg2)]">
          ⌘K
        </span>
      </button>

      {/* Right Controls */}
      <div className="ml-auto flex items-center gap-[9px]">
        {/* Pipeline Status Pill */}
        <div className="flex items-center gap-[7px] h-[28px] px-[10px] rounded-full border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.10)]">
          <span className="w-[6px] h-[6px] rounded-full bg-[var(--emerald)] animate-dkpulse" />
          <span className="text-[11px] font-semibold text-[var(--emerald)] whitespace-nowrap">
            Pipeline Running
          </span>
          <span className="font-mono text-[10px] font-medium text-[var(--emerald)] opacity-80">
            3 active
          </span>
        </div>

        {/* Notifications Button & Dropdown */}
        <div className="relative">
          <button
            id="btn-notifications"
            aria-label="Notifications"
            onClick={() => setNotifOpen(!notifOpen)}
            className="w-[32px] h-[32px] rounded-[9px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] flex items-center justify-center relative hover:border-[var(--bd2)] transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" />
              <path d="M10 20a2 2 0 004 0" />
            </svg>
            <span className="absolute top-[5px] right-[6px] w-[6px] h-[6px] rounded-full bg-[var(--rose)]" />
          </button>

          {notifOpen && (
            <div className="absolute top-[38px] right-0 w-[330px] border border-[var(--bd)] rounded-[12px] bg-[var(--card)] shadow-[var(--shadow)] overflow-hidden animate-dkfade z-50">
              <div className="p-[10px_12px] border-b border-[var(--bd)] flex items-center justify-between">
                <span className="text-[12px] font-bold text-[var(--fg)]">Notifications</span>
                <span className="text-[10.5px] text-[var(--mut)]">4 new</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {notifications.map((n, idx) => (
                  <div
                    key={idx}
                    className="flex gap-[9px] p-[10px_12px] border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors"
                  >
                    <span
                      className="flex-none mt-[4px] w-[7px] h-[7px] rounded-full"
                      style={{ background: n.color }}
                    />
                    <div className="min-w-0">
                      <div className="text-[11.5px] font-semibold leading-snug text-[var(--fg)]">
                        {n.title}
                      </div>
                      <div className="text-[10.5px] text-[var(--mut)] mt-[2px]">
                        {n.meta}
                      </div>
                    </div>
                    <span className="ml-auto flex-none font-mono text-[10px] font-medium text-[var(--faint)]">
                      {n.time}
                    </span>
                  </div>
                ))}
              </div>
              <div className="p-[8px_12px] text-center border-t border-[var(--bd)]">
                <a href="/dashboard/logs" className="text-[11px] font-semibold text-[var(--indigo)] hover:underline">
                  View all system activity
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Light / Dark Mode Toggle */}
        <button
          id="btn-theme-toggle"
          aria-label="Toggle light and dark mode"
          onClick={toggleTheme}
          className="w-[32px] h-[32px] rounded-[9px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] flex items-center justify-center hover:border-[var(--bd2)] hover:text-[var(--indigo)] transition-colors"
        >
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
            </svg>
          )}
        </button>

        {/* Run Now CTA Button */}
        <button
          id="btn-run-now"
          aria-label="Trigger generation run now"
          onClick={onRunNow}
          className="h-[32px] px-[13px] rounded-[9px] border border-transparent bg-[var(--indigo)] text-white text-[12px] font-semibold flex items-center gap-[6px] hover:bg-[#4f46e5] transition-colors shadow-sm"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4l13 8-13 8z" />
          </svg>
          Run now
        </button>
      </div>
    </header>
  );
}
