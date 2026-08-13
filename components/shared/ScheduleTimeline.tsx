"use client";

import React from "react";
import { useHydrated, useLiveNow } from "./WorldClocks";
import { parseDailyCron } from "@/lib/utils";

export interface TimelineSlot {
  id: string;
  label: string;
  pattern: string | null;
  color: string;
}

interface ScheduleTimelineProps {
  slots: TimelineSlot[];
  tz: string;
}

function pct(hour: number, minute: number) {
  return ((hour * 60 + minute) / 1440) * 100;
}

/** 24h horizontal strip with the real research-worker slots plotted on it, plus a live "now" marker for the given timezone. */
export function ScheduleTimeline({ slots, tz }: ScheduleTimelineProps) {
  const now = useLiveNow();
  // Same hydration guard as WorldClocks: keep the live "now" marker out of
  // the SSR/hydration render entirely (a marker parked at 0% for the first
  // frame would be wrong anyway) and mount it right after.
  const mounted = useHydrated();
  const nowDate = new Date(now);
  const nowParts = nowDate
    .toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":")
    .map(Number);
  const nowPct = pct(nowParts[0] ?? 0, nowParts[1] ?? 0);

  return (
    <div className="pt-[26px] pb-[6px]">
      <div className="relative h-[6px] rounded-full bg-[var(--card2)]">
        {slots.map((slot) => {
          const parsed = parseDailyCron(slot.pattern);
          if (!parsed) return null;
          const left = pct(parsed.hour, parsed.minute);
          return (
            <div
              key={slot.id}
              className="absolute -top-[19px] flex flex-col items-center"
              style={{ left: `${left}%`, transform: "translateX(-50%)" }}
            >
              <span className="text-[9px] font-mono font-semibold text-[var(--faint)] whitespace-nowrap">
                {String(parsed.hour).padStart(2, "0")}:{String(parsed.minute).padStart(2, "0")}
              </span>
              <span
                className="mt-[2px] w-[10px] h-[10px] rounded-full border-2 border-[var(--card)]"
                style={{ background: slot.color }}
                title={slot.label}
              />
            </div>
          );
        })}
        {/* Live "now" marker - client-only, see the mounted comment above */}
        {mounted && (
          <div
            className="absolute -top-[3px] w-[2px] h-[12px] rounded-full bg-[var(--rose)]"
            style={{ left: `${nowPct}%`, transform: "translateX(-50%)" }}
            title={`Now (${tz})`}
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-[9px] text-[var(--faint)] mt-[6px]">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
