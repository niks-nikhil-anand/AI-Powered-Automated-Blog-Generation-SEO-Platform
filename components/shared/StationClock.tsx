"use client";

import React, { useEffect, useMemo, useRef } from "react";

/**
 * Swiss railway "station master" clock: ticks around a dial, the second
 * hand sweeps fast and pauses near twelve, then jumps precisely on the
 * minute. Ported from https://datapoems.io/clocks/station-master/ (MIT,
 * Luke Steuber) and adapted to read a specific IANA timezone rather than
 * the browser's local time, so each entry in WorldClocks can show its own
 * dial.
 *
 * Runs its own requestAnimationFrame loop and writes straight to the SVG
 * hand elements via refs - doing this through React state would mean a
 * render every frame for every clock on screen, which is wasteful for
 * something purely visual like hand angles.
 */

const CX = 150;
const CY = 150;

interface StationClockProps {
  /** IANA timezone, e.g. "Asia/Kolkata". Falls back to the browser's local zone if omitted. */
  tz?: string;
  /** Rendered pixel size (square). */
  size?: number;
  className?: string;
  /** Accessible label prefix, e.g. "India time". */
  label?: string;
}

function zonedClockParts(tz?: string) {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    }).formatToParts(now);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return {
      hours: Number(map.hour) % 24,
      minutes: Number(map.minute),
      seconds: Number(map.second),
      ms: Number(map.fractionalSecond ?? 0),
    };
  } catch {
    return {
      hours: now.getHours(),
      minutes: now.getMinutes(),
      seconds: now.getSeconds(),
      ms: now.getMilliseconds(),
    };
  }
}

function handEnds(angleDeg: number, len: number, tail: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x1: CX - tail * Math.cos(rad),
    y1: CY - tail * Math.sin(rad),
    x2: CX + len * Math.cos(rad),
    y2: CY + len * Math.sin(rad),
  };
}

export function StationClock({ tz, size = 40, className, label }: StationClockProps) {
  const hourRef = useRef<SVGLineElement | null>(null);
  const minuteRef = useRef<SVGLineElement | null>(null);
  const secondRef = useRef<SVGLineElement | null>(null);
  const lollyRef = useRef<SVGCircleElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const ticks = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; big: boolean }[] = [];
    for (let i = 0; i < 60; i += 1) {
      const a = ((i * 6 - 90) * Math.PI) / 180;
      const big = i % 5 === 0;
      const r0 = big ? 108 : 122;
      lines.push({
        x1: CX + r0 * Math.cos(a),
        y1: CY + r0 * Math.sin(a),
        x2: CX + 132 * Math.cos(a),
        y2: CY + 132 * Math.sin(a),
        big,
      });
    }
    return lines;
  }, []);

  useEffect(() => {
    let raf = 0;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotionChange = () => {
      reduced = motion.matches;
    };
    motion.addEventListener("change", onMotionChange);

    const frame = () => {
      const { hours, minutes, seconds, ms } = zonedClockParts(tz);
      const rawS = seconds + (reduced ? 0 : ms / 1000);
      // Sweep the dial in ~58.5s, pause near 12, jump at the minute - the signature railway motion.
      const s = reduced ? seconds : rawS >= 58.5 ? 60 : (rawS / 58.5) * 60;
      const minAngle = minutes * 6;
      const h = (hours % 12) + minutes / 60 + seconds / 3600;
      const secRad = ((s * 6 - 90) * Math.PI) / 180;

      if (hourRef.current) {
        const p = handEnds(h * 30, 78, 18);
        hourRef.current.setAttribute("x1", String(p.x1));
        hourRef.current.setAttribute("y1", String(p.y1));
        hourRef.current.setAttribute("x2", String(p.x2));
        hourRef.current.setAttribute("y2", String(p.y2));
      }
      if (minuteRef.current) {
        const p = handEnds(minAngle, 118, 22);
        minuteRef.current.setAttribute("x1", String(p.x1));
        minuteRef.current.setAttribute("y1", String(p.y1));
        minuteRef.current.setAttribute("x2", String(p.x2));
        minuteRef.current.setAttribute("y2", String(p.y2));
      }
      if (secondRef.current) {
        secondRef.current.setAttribute("x1", String(CX - 24 * Math.cos(secRad)));
        secondRef.current.setAttribute("y1", String(CY - 24 * Math.sin(secRad)));
        secondRef.current.setAttribute("x2", String(CX + 96 * Math.cos(secRad)));
        secondRef.current.setAttribute("y2", String(CY + 96 * Math.sin(secRad)));
      }
      if (lollyRef.current) {
        lollyRef.current.setAttribute("cx", String(CX + 96 * Math.cos(secRad)));
        lollyRef.current.setAttribute("cy", String(CY + 96 * Math.sin(secRad)));
      }
      if (svgRef.current) {
        svgRef.current.setAttribute(
          "aria-label",
          `${label ? label + " - " : ""}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
        );
      }
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      motion.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tz, label]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 300 300"
      role="img"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx={CX} cy={CY} r="145" fill="#f7f5f0" stroke="#1a1a1a" strokeWidth="7" />
      <g>
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="#1a1a1a"
            strokeWidth={t.big ? 8 : 3}
          />
        ))}
      </g>
      <line ref={hourRef} x1={CX} y1={168} x2={CX} y2={72} stroke="#1a1a1a" strokeWidth="12" strokeLinecap="butt" />
      <line ref={minuteRef} x1={CX} y1={172} x2={CX} y2={32} stroke="#1a1a1a" strokeWidth="9" strokeLinecap="butt" />
      <line ref={secondRef} x1={CX} y1={174} x2={CX} y2={54} stroke="#c8281e" strokeWidth="4" />
      <circle ref={lollyRef} cx={CX} cy={54} r="10" fill="#c8281e" />
      <circle cx={CX} cy={CY} r="6" fill="#1a1a1a" />
    </svg>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
