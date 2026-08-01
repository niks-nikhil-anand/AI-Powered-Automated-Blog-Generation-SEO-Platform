"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ collapsed: externalCollapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [internalCollapsed, setInternalCollapsed] = useState(false);

  const isCollapsed = externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;

  const handleToggle = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed(!internalCollapsed);
    }
  };

  const navGroups = [
    {
      title: "Main",
      items: [
        {
          label: "Dashboard",
          href: "/dashboard",
          badge: null,
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="8" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="11" width="7" height="10" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </svg>
          ),
        },
        {
          label: "Content Pipeline",
          href: "/dashboard/blogs",
          badge: "6",
          badgeColor: "bg-[var(--tint)] text-[var(--indigo)]",
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 3h9l5 5v13H5z" />
              <path d="M14 3v5h5" />
              <path d="M9 13h6M9 17h6" />
            </svg>
          ),
        },
        {
          label: "Trend Research",
          href: "/dashboard/trends",
          badge: null,
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 7-7" />
              <path d="M15 8h5v5" />
            </svg>
          ),
        },
      ],
    },
    {
      title: "Media & Quality",
      items: [
        {
          label: "Asset Library",
          href: "/dashboard/assets",
          badge: "GCS",
          badgeColor: "text-[var(--faint)]",
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="8.5" cy="9.5" r="1.6" />
              <path d="M21 16l-5-5-6 6" />
            </svg>
          ),
        },
        {
          label: "SEO & Quality",
          href: "/dashboard/quality",
          badge: "5",
          badgeColor: "bg-[rgba(244,63,94,0.14)] text-[var(--rose)]",
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 4.3-2.9 7.9-7 9-4.1-1.1-7-4.7-7-9V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ),
        },
      ],
    },
    {
      title: "Operations",
      items: [
        {
          label: "Queue & Workers",
          href: "/dashboard/workers",
          badge: null,
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="6" y="6" width="12" height="12" rx="2" />
              <rect x="10" y="10" width="4" height="4" />
              <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
            </svg>
          ),
        },
        {
          label: "System Logs",
          href: "/dashboard/logs",
          badge: null,
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h11M4 18h7" />
            </svg>
          ),
        },
      ],
    },
    {
      title: "System",
      items: [
        {
          label: "Settings & AI Models",
          href: "/dashboard/settings",
          badge: null,
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" strokeLinecap="round" />
            </svg>
          ),
        },
      ],
    },
  ];

  return (
    <aside
      className={`flex-none border-r border-[var(--bd)] bg-[var(--card)] flex flex-col sticky top-0 h-screen transition-all duration-200 z-50 ${
        isCollapsed ? "w-[68px]" : "w-[252px]"
      }`}
    >
      {/* Brand Header */}
      <div className="h-[56px] flex-none flex items-center gap-[10px] px-[14px] border-b border-[var(--bd)]">
        <div className="w-[28px] h-[28px] flex-none rounded-[8px] bg-gradient-to-br from-[var(--indigo)] to-purple-600 flex items-center justify-center font-extrabold text-[13px] tracking-tight text-white">
          DK
        </div>
        {!isCollapsed && (
          <div className="min-w-0 overflow-hidden">
            <div className="font-bold text-[12.5px] tracking-tight whitespace-nowrap text-[var(--fg)]">
              DevKit Market
            </div>
            <div className="text-[10px] text-[var(--mut)] whitespace-nowrap">
              AI Blog Agent
            </div>
          </div>
        )}
        <button
          id="btn-sidebar-toggle"
          aria-label="Collapse sidebar"
          onClick={handleToggle}
          className="ml-auto flex-none w-[24px] h-[24px] rounded-[6px] border border-[var(--bd)] bg-transparent text-[var(--mut)] flex items-center justify-center hover:bg-[var(--card2)] hover:text-[var(--fg)] transition-colors"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            className={`transition-transform duration-200 ${isCollapsed ? "rotate-180" : ""}`}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Pipeline Active Badge */}
      {!isCollapsed && (
        <div className="p-[10px_10px_4px]">
          <div className="flex items-center gap-[7px] p-[7px_9px] rounded-[8px] bg-[rgba(16,185,129,0.10)] border border-[rgba(16,185,129,0.25)]">
            <span className="w-[7px] h-[7px] rounded-full bg-[var(--emerald)] animate-dkpulse" />
            <span className="text-[11px] font-semibold text-[var(--emerald)] whitespace-nowrap">
              Pipeline Active
            </span>
            <span className="ml-auto font-mono text-[10px] font-medium text-[var(--emerald)]">
              7/7
            </span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-[8px_10px_10px] flex flex-col gap-[2px]">
        {navGroups.map((group, idx) => (
          <div key={idx} className="flex flex-col gap-[2px]">
            {!isCollapsed && (
              <div className="text-[9.5px] font-bold tracking-widest uppercase text-[var(--faint)] p-[10px_9px_5px]">
                {group.title}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-[10px] w-full p-[8px_9px] rounded-[8px] border text-[12.5px] font-medium whitespace-nowrap overflow-hidden transition-all ${
                    isActive
                      ? "bg-[var(--tint)] text-[var(--indigo)] border-[rgba(99,102,241,0.25)] font-semibold"
                      : "border-transparent bg-transparent text-[var(--fg2)] hover:bg-[var(--card2)] hover:text-[var(--fg)]"
                  }`}
                  title={isCollapsed ? item.label : undefined}
                >
                  <span className={isActive ? "text-[var(--indigo)]" : "text-[var(--mut)]"}>
                    {item.icon}
                  </span>
                  {!isCollapsed && <span>{item.label}</span>}
                  {!isCollapsed && item.badge && (
                    <span
                      className={`ml-auto font-mono text-[9.5px] font-semibold p-[1.5px_5px] rounded-[5px] ${
                        item.badgeColor || ""
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer Profile & Theme Switch */}
      <div className="flex-none border-t border-[var(--bd)] p-[10px] flex flex-col gap-[8px]">
        {!isCollapsed && (
          <div className="border border-[var(--bd)] rounded-[9px] p-[8px_9px] bg-[var(--card2)]">
            <div className="flex items-center justify-between mb-[6px]">
              <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--mut)]">
                Worker health
              </span>
              <span className="font-mono text-[10px] font-semibold text-[var(--emerald)]">
                7 up
              </span>
            </div>
            <div className="flex gap-[3px]">
              {[...Array(7)].map((_, i) => (
                <span
                  key={i}
                  className="flex-1 h-[5px] rounded-[3px] bg-[var(--emerald)]"
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-[9px] p-[5px_4px]">
          <div className="w-[28px] h-[28px] flex-none rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-[11px] font-bold">
            AR
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis text-[var(--fg)]">
                Aarav Rubenius
              </div>
              <div className="text-[10px] text-[var(--mut)]">Platform Owner</div>
            </div>
          )}
          <button
            id="btn-theme-sidebar"
            aria-label="Toggle light and dark mode"
            onClick={toggleTheme}
            className="ml-auto flex-none w-[26px] h-[26px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] flex items-center justify-center hover:text-[var(--fg)] hover:border-[var(--bd2)] transition-colors"
          >
            {theme === "dark" ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
