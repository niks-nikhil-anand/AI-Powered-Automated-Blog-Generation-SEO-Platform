"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useTheme } from "./ThemeProvider";

interface NavbarProps {
  onOpenNavigation?: () => void;
  navigationOpen?: boolean;
  onOpenCmdk?: () => void;
  onOpenRunPipeline?: () => void;
}

export function Navbar({ onOpenCmdk, onOpenRunPipeline, onOpenNavigation, navigationOpen }: NavbarProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [pipeline, setPipeline] = useState({
    active: 0,
    waiting: 0,
    delayed: 0,
    failed: 0,
    state: "idle",
  });

  useEffect(() => {
    let mounted = true;
    const loadPipeline = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (mounted && data.pipeline) setPipeline(data.pipeline);
        })
        .catch(() => { });
    };
    loadPipeline();
    const timer = window.setInterval(loadPipeline, 3000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const shortTitle = ({ blogs: "Blogs", new: "New blog", assets: "Assets", categories: "Categories", quality: "Quality", workers: "Workers", logs: "Logs", settings: "Settings" } as Record<string, string>)[pathname.split("/").pop() || ""] || "Dashboard";

  const getBreadcrumb = () => {
    switch (pathname) {
      case "/dashboard/blogs":
        return "Content Pipeline & Blog Management";
      case "/dashboard/blogs/new":
        return "New Blog Submission";
      case "/dashboard/assets":
        return "Asset Library";
      case "/dashboard/categories":
        return "Category Management";
      case "/dashboard/quality":
        return "SEO & Quality Audit Hub";
      case "/dashboard/workers":
        return "Queue & Worker Operations";
      case "/dashboard/logs":
        return "Streaming System Logs";
      case "/dashboard/settings":
        return "Settings ";
      default:
        return "Executive Dashboard";
    }
  };

  const handleRunNow = () => {
    onOpenRunPipeline?.();
  };
  const liveBacklog = pipeline.waiting + pipeline.delayed;
  const pillState =
    pipeline.active > 0
      ? "running"
      : liveBacklog > 0
        ? "queued"
        : pipeline.failed > 0
          ? "error"
          : "idle";
  const pillLabel =
    pillState === "running"
      ? "Pipeline Running"
      : pillState === "queued"
        ? "Pipeline Queued"
        : pillState === "error"
          ? "Pipeline Issues"
          : "Pipeline Idle";
  const pillCount =
    pillState === "running"
      ? `${pipeline.active || 1} active`
      : pillState === "queued"
        ? `${liveBacklog || 1} queued`
        : pillState === "error"
          ? `${pipeline.failed || 1} failed`
          : "0 active";

  return (
    <header className="dashboard-navbar sticky top-0 z-40 h-[56px] flex-none flex items-center gap-[12px] px-[18px] border-b border-[var(--bd)] bg-[var(--glass)] backdrop-blur-md">
      <button type="button" onClick={onOpenNavigation} aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="dashboard-navigation-drawer" className="mobile-navigation flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--bd)] md:hidden"><Menu size={20} /></button>
      {/* Breadcrumb */}
      <div className="navbar-breadcrumb flex min-w-0 items-center gap-[7px] text-[12px] text-[var(--mut)] whitespace-nowrap">
        <span className="breadcrumb-parent">Dashboard</span>
        <svg className="breadcrumb-parent shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="hidden min-[1440px]:block truncate font-semibold text-[var(--fg)]">
          {getBreadcrumb()}
        </span>
        <span className="truncate font-semibold text-[var(--fg)] min-[1440px]:hidden">{shortTitle}</span>
      </div>

      {/* Global Search Button */}
      <button
        id="btn-global-search"
        aria-label="Open global search"
        onClick={onOpenCmdk}
        className="navbar-search ml-[14px] flex-1 max-w-[400px] flex items-center gap-[8px] h-[32px] px-[10px] rounded-[9px] border border-[var(--bd)] bg-[var(--card)] text-[var(--faint)] text-[12px] text-left hover:border-[var(--bd2)] transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span>Search blogs, submissions, jobs…</span>
        <span className="ml-auto font-mono text-[10px] font-semibold px-[5px] py-[2px] rounded-[5px] border border-[var(--bd)] bg-[var(--card2)] text-[var(--fg2)]">
          ⌘K
        </span>
      </button>

      {/* Right Controls */}
      <div className="navbar-controls ml-auto flex shrink-0 items-center gap-[9px]">
        {/* Pipeline Status Pill */}
        <div className={`navbar-pipeline flex items-center gap-[7px] h-[28px] px-[10px] rounded-full border ${
          pillState === "error"
            ? "border-[rgba(244,63,94,0.3)] bg-[rgba(244,63,94,0.10)]"
            : pillState === "queued"
              ? "border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.10)]"
              : pillState === "running"
                ? "border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.10)]"
                : "border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.10)]"
        }`}>
          <span className={`w-[6px] h-[6px] rounded-full ${
            pillState === "error" ? "bg-[var(--rose)]" : pillState === "queued" ? "bg-[var(--amber)]" : pillState === "running" ? "bg-[var(--indigo)]" : "bg-[var(--emerald)]"
          } ${pillState === "running" ? "animate-dkpulse" : ""}`} />
          <span className={`text-[11px] font-semibold whitespace-nowrap ${
            pillState === "error" ? "text-[var(--rose)]" : pillState === "queued" ? "text-[var(--amber)]" : pillState === "running" ? "text-[var(--indigo)]" : "text-[var(--emerald)]"
          }`}>
            {pillLabel}
          </span>
          <span className={`font-mono text-[10px] font-medium opacity-80 ${
            pillState === "error" ? "text-[var(--rose)]" : pillState === "queued" ? "text-[var(--amber)]" : pillState === "running" ? "text-[var(--indigo)]" : "text-[var(--emerald)]"
          }`}>
            {pillCount}
          </span>
        </div>
        {/* Light / Dark Mode Toggle */}
        <button
          id="btn-theme-toggle"
          aria-label="Toggle light and dark mode"
          onClick={toggleTheme}
          className="w-[44px] h-[44px] rounded-[9px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] flex items-center justify-center hover:border-[var(--bd2)] hover:text-[var(--indigo)] transition-colors"
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
          onClick={handleRunNow}
          className="h-[44px] px-[13px] rounded-[9px] border border-transparent bg-[var(--indigo)] text-white text-[12px] font-semibold flex items-center gap-[6px] hover:bg-[#4f46e5] transition-colors shadow-sm"
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
