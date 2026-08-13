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

function subscribeToNothing() {
  // The value never changes post-mount; the subscribe contract just needs to exist.
  return () => {};
}

/**
 * False during SSR and the hydration pass, true immediately after - the
 * canonical useSyncExternalStore mount gate (React deliberately hydrates
 * with getServerSnapshot, then re-reads getSnapshot and re-renders). Used to
 * keep time-dependent / float-precision markup out of the server HTML so
 * hydration always compares identical deterministic placeholders. Preferred
 * over useState+useEffect(setMounted), which the react-hooks
 * set-state-in-effect rule now rejects.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
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

  // Hydration guard: render stable placeholders during SSR + the hydration
  // pass, and only mount the real clocks afterwards. StationClock's SVG tick
  // coordinates are raw floats whose last-ulp stringification can differ
  // between the server JS engine (V8) and the browser's (e.g. JSCore), and
  // live time text differs between server render time and client by
  // definition - both trip React's hydration comparison ("tree hydrated but
  // attributes didn't match"). The placeholder markup is fully deterministic,
  // so server HTML and the client's hydration render always agree; the real
  // clocks then mount as an ordinary post-hydration update. useSyncExternalStore's
  // getServerSnapshot can't help here - it only fixes values read through the
  // hook, not the float attributes baked into the server HTML.
  const mounted = useHydrated();

  if (layout === "horizontal") {
    const dialSize = size ?? 120;
    return (
      <div className={className}>
        {label && <div className={LABEL_CLASS}>{label}</div>}
        <div className="flex flex-wrap items-stretch justify-between gap-[18px] mt-[14px]">
          {clocks.map((clock) => {
            const dial = clock.primary ? Math.round(dialSize * 1.15) : dialSize;
            return (
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
                {mounted ? (
                  <StationClock
                    tz={clock.tz}
                    label={clock.label}
                    size={dial}
                    className="drop-shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{ width: dial, height: dial }}
                    className="rounded-full border border-[var(--bd)] bg-[var(--card)]"
                  />
                )}
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
                  {mounted ? timeIn(new Date(now), clock.tz) : "--:--:--"}
                </span>
                <span className="text-[11px] text-[var(--faint)] font-medium">
                  {mounted ? dateIn(new Date(now), clock.tz) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {label && <div className={LABEL_CLASS}>{label}</div>}
      <div className="flex flex-col gap-[7px] mt-[9px]">
        {clocks.map((clock) => {
          const dial = size ?? (clock.primary ? 34 : 26);
          return (
            <div key={clock.label} className="flex items-center gap-[10px]">
              {mounted ? (
                <StationClock tz={clock.tz} label={clock.label} size={dial} />
              ) : (
                <div
                  aria-hidden
                  style={{ width: dial, height: dial }}
                  className="rounded-full border border-[var(--bd)] bg-[var(--card2)] flex-none"
                />
              )}
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
                {mounted ? timeIn(new Date(now), clock.tz) : "--:--:--"}
              </span>
              <span className="text-[10.5px] text-[var(--faint)] w-[64px] text-right">
                {mounted ? dateIn(new Date(now), clock.tz) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
