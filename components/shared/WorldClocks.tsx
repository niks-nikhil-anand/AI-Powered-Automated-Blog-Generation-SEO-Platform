"use client";

import React, { useSyncExternalStore } from "react";
import { StationClock } from "./StationClock";

/** Default clocks - India is primary since env.TIMEZONE defaults to Asia/Kolkata; the US pair matters because research-worker has a slot named for the US news cycle. */
export const DEFAULT_CLOCKS = [
  { badge: "IN", label: "India", tz: "Asia/Kolkata", primary: true },
  { badge: "US", label: "US Eastern", tz: "America/New_York", primary: false },
  { badge: "US", label: "US Pacific", tz: "America/Los_Angeles", primary: false },
  { badge: "DE", label: "Germany", tz: "Europe/Berlin", primary: false },
];

export type ClockDef = (typeof DEFAULT_CLOCKS)[number];

export function timeIn(date: Date, tz: string) {
  return date.toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function dateIn(date: Date, tz: string) {
  return date.toLocaleDateString("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function subscribeToClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 1000);
  return () => window.clearInterval(timer);
}

function getClockSnapshot() {
  return Math.floor(Date.now() / 1000) * 1000;
}

function getClockServerSnapshot() {
  // Never reached by any current caller - all of them only mount client-side
  // (a modal opened on click, or a page rendered after the initial load).
  return 0;
}

/**
 * Ticking "now", read through useSyncExternalStore rather than Date.now()
 * in render (impure) or setState in an effect (cascading renders).
 * Snapshots are truncated to the second so repeated calls within one
 * render pass return an identical value. Shared by every component that
 * needs a live clock - each caller gets its own 1s interval, which is a
 * deliberate, cheap tradeoff over threading a single shared timer through
 * props for what is at most a handful of instances on screen at once.
 */
export function useLiveNow() {
  return useSyncExternalStore(subscribeToClock, getClockSnapshot, getClockServerSnapshot);
}

const LABEL_CLASS = "text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--mut)]";

interface WorldClocksProps {
  clocks?: ClockDef[];
  label?: string | null;
  className?: string;
  /** "vertical" (default) is the compact list used in the Run Pipeline modal; "horizontal" is a big row of dials for the Settings page. */
  layout?: "vertical" | "horizontal";
  /** Dial size in px for the (non-primary) clocks - primary gets a modest bump on top of this. */
  size?: number;
}

export function WorldClocks({
  clocks = DEFAULT_CLOCKS,
  label = "World clocks",
  className,
  layout = "vertical",
  size,
}: WorldClocksProps) {
  const now = useLiveNow();

  if (layout === "horizontal") {
    const dialSize = size ?? 120;
    return (
      <div className={className}>
        {label && <div className={LABEL_CLASS}>{label}</div>}
        <div className="flex flex-wrap items-stretch justify-between gap-[18px] mt-[14px]">
          {clocks.map((clock) => (
            <div
              key={clock.label}
              className="flex-1 min-w-[150px] flex flex-col items-center gap-[12px] rounded-[14px] border p-[18px_14px] transition-colors"
              style={{
                background: clock.primary
                  ? "linear-gradient(180deg, rgba(99,102,241,0.10), var(--card2) 70%)"
                  : "var(--card2)",
                borderColor: clock.primary ? "rgba(99,102,241,0.35)" : "var(--bd)",
              }}
            >
              <StationClock
                tz={clock.tz}
                label={clock.label}
                size={clock.primary ? Math.round(dialSize * 1.15) : dialSize}
                className="drop-shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
              />
              <div className="flex items-center gap-[7px]">
                <span
                  className="font-mono text-[10px] font-bold px-[7px] py-[3px] rounded-[5px] text-center tracking-wide"
                  style={{
                    background: clock.primary ? "rgba(99,102,241,0.18)" : "var(--card)",
                    color: clock.primary ? "var(--indigo)" : "var(--mut)",
                  }}
                >
                  {clock.badge}
                </span>
                <span className="text-[13px] font-bold text-[var(--fg)]">{clock.label}</span>
              </div>
              <span className="font-mono text-[20px] font-extrabold text-[var(--fg)] tabular-nums tracking-tight">
                {timeIn(new Date(now), clock.tz)}
              </span>
              <span className="text-[11px] text-[var(--faint)] font-medium">{dateIn(new Date(now), clock.tz)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {label && <div className={LABEL_CLASS}>{label}</div>}
      <div className="flex flex-col gap-[7px] mt-[9px]">
        {clocks.map((clock) => (
          <div key={clock.label} className="flex items-center gap-[10px]">
            <StationClock tz={clock.tz} label={clock.label} size={size ?? (clock.primary ? 34 : 26)} />
            <span
              className="font-mono text-[9.5px] font-semibold px-[6px] py-[2px] rounded-[4px] w-[26px] text-center"
              style={{
                background: clock.primary ? "rgba(99,102,241,0.14)" : "var(--card2)",
                color: clock.primary ? "var(--indigo)" : "var(--mut)",
              }}
            >
              {clock.badge}
            </span>
            <span className="text-[12px] text-[var(--fg2)] flex-1">{clock.label}</span>
            <span className="font-mono text-[12.5px] font-semibold text-[var(--fg)] tabular-nums">
              {timeIn(new Date(now), clock.tz)}
            </span>
            <span className="text-[10.5px] text-[var(--faint)] w-[64px] text-right">
              {dateIn(new Date(now), clock.tz)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
