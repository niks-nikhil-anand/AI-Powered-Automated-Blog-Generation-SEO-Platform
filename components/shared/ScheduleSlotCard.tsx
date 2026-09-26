"use client";

import React, { useState } from "react";
import { formatCountdown, formatHourMinute, parseDailyCron } from "@/lib/utils";
import { useLiveNow } from "./WorldClocks";
import { formatTime12 } from "@/lib/time-display";

export interface ScheduleSlot {
  id: string;
  label: string;
  /** Run-time daily cron ("M H * * *") - the time the scheduler starts this slot. Null = not configured. */
  pattern: string | null;
  tz?: string | null;
  /** Next scheduler fire time (epoch ms) from BullMQ. */
  next: number | null;
  /** "HH:MM" configured run time, straight from the API. */
  publishTime?: string | null;
  /** Back-compat alias for the configured run time. */
  generationStart?: string | null;
  /** True when the slot has a run time configured. */
  configured?: boolean;
}

interface ScheduleSlotCardProps {
  slot: ScheduleSlot;
  color: string;
  onUpdated: (slot: ScheduleSlot) => void;
}

function dayKey(value: number, tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function nextDayLabel(next: number | null | undefined, now: number, tz: string) {
  if (!next) return null;
  if (dayKey(next, tz) === dayKey(now, tz)) return "today";
  const tomorrow = now + 24 * 60 * 60 * 1000;
  if (dayKey(next, tz) === dayKey(tomorrow, tz)) return "tomorrow";
  return "later";
}

/**
 * Editable digital-clock card for one publish slot. The time shown and
 * edited is the scheduler RUN time. Saves immediately against the live
 * BullMQ scheduler and persists to AppSetting, so it survives worker restarts.
 */
export function ScheduleSlotCard({ slot, color, onUpdated }: ScheduleSlotCardProps) {
  const now = useLiveNow();
  const parsed = parseDailyCron(slot.pattern);
  const tz = slot.tz ?? "Asia/Kolkata";
  const nextLabel = nextDayLabel(slot.next, now, tz);
  const [editing, setEditing] = useState(false);
  const [timeValue, setTimeValue] = useState(parsed ? formatHourMinute(parsed.hour, parsed.minute) : "06:00");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const startEditing = () => {
    setTimeValue(parsed ? formatHourMinute(parsed.hour, parsed.minute) : "06:00");
    setMessage(null);
    setEditing(true);
  };

  const handleSave = async () => {
    const [hourStr, minuteStr] = timeValue.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      setMessage({ text: "Enter a valid time.", tone: "error" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pipeline/schedules/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hour, minute }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to update schedule");
      onUpdated({ ...slot, ...data });
      const savedNextLabel = nextDayLabel(typeof data.next === "number" ? data.next : null, Date.now(), tz);
      setMessage({
        text:
          savedNextLabel === "tomorrow"
            ? `Saved - ${formatTime12(hour, minute)} already passed today, so the next start is tomorrow. Pick the next minute to run today.`
            : `Saved - starts daily at ${formatTime12(hour, minute)} (survives restarts).`,
        tone: "ok",
      });
      setEditing(false);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to update schedule", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  /** Clears the slot's run time (AppSetting row + Redis scheduler both removed server-side). */
  const handleClear = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pipeline/schedules/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to clear slot");
      onUpdated({ ...slot, ...data });
      setMessage({ text: "Cleared - this slot won't fire until you set a new time.", tone: "ok" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to clear slot", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-[10px] rounded-[12px] border border-[var(--bd)] bg-[var(--card2)] p-[12px] sm:p-[13px]">
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className="w-[7px] h-[7px] rounded-full flex-none" style={{ background: color }} />
        <span className="min-w-0 truncate text-[11.5px] font-bold text-[var(--fg)]">{slot.label}</span>
        <span className="ml-auto shrink-0 text-[9.5px] font-mono text-[var(--faint)]">{tz}</span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-[8px]">
          <div className="grid grid-cols-3 gap-2">
            <select aria-label={`Hour for ${slot.label}`} disabled={saving}
              value={Number(timeValue.split(":")[0]) % 12 || 12}
              onChange={(e) => setTimeValue(formatHourMinute(Number(e.target.value) % 12 + (Number(timeValue.split(":")[0]) >= 12 ? 12 : 0), Number(timeValue.split(":")[1])))}
              className="h-10 min-w-0 rounded-md border border-[var(--bd)] bg-[var(--card)] px-2 text-[var(--fg)]">
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, "0")}</option>)}
            </select>
            <select aria-label={`Minute for ${slot.label}`} disabled={saving}
              value={Number(timeValue.split(":")[1])}
              onChange={(e) => setTimeValue(formatHourMinute(Number(timeValue.split(":")[0]), Number(e.target.value)))}
              className="h-10 min-w-0 rounded-md border border-[var(--bd)] bg-[var(--card)] px-2 text-[var(--fg)]">
              {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}</option>)}
            </select>
            <select aria-label={`AM or PM for ${slot.label}`} disabled={saving}
              value={Number(timeValue.split(":")[0]) >= 12 ? "PM" : "AM"}
              onChange={(e) => setTimeValue(formatHourMinute(Number(timeValue.split(":")[0]) % 12 + (e.target.value === "PM" ? 12 : 0), Number(timeValue.split(":")[1])))}
              className="h-10 min-w-0 rounded-md border border-[var(--bd)] bg-[var(--card)] px-2 text-[var(--fg)]">
              <option value="AM">AM</option><option value="PM">PM</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-[7px]">
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="h-[28px] px-[11px] rounded-[7px] border border-transparent bg-[var(--indigo)] text-white text-[11px] font-semibold hover:bg-[#4f46e5] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="h-[28px] px-[11px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--bd2)] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div
            className="rounded-[7px] px-[10px] py-[3px] font-mono text-[24px] font-extrabold tracking-wider sm:text-[26px]"
            style={{ background: "var(--card)", color }}
          >
            {parsed ? formatTime12(parsed.hour, parsed.minute) : "--:--"}
          </div>
          <button
            type="button"
            onClick={startEditing}
            className="h-[28px] px-[11px] rounded-[7px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11px] font-semibold hover:border-[var(--indigo)] hover:text-[var(--indigo)] transition-colors"
          >
            Edit
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <span className="min-w-[180px] flex-1 text-[10.5px] leading-relaxed text-[var(--mut)]">
          {!parsed
            ? "Not set - Edit to pick a run time"
            : slot.next
              ? `Starts ${nextLabel === "tomorrow" ? "tomorrow " : ""}${formatCountdown(slot.next, now)} · run time ${formatTime12(parsed.hour, parsed.minute)}`
              : `Starts daily at ${formatTime12(parsed.hour, parsed.minute)}`}
        </span>
        {parsed && !editing && (
          <button
            type="button"
            disabled={saving}
            onClick={handleClear}
            title="Clear this slot's run time"
            className="flex-none text-[9.5px] font-semibold text-[var(--amber)] hover:text-[var(--indigo)] cursor-pointer bg-transparent border-0 p-0 disabled:opacity-60"
          >
            {saving ? "…" : "set · Clear"}
          </button>
        )}
      </div>

      {message && (
        <div
          className="text-[10.5px] font-semibold"
          style={{ color: message.tone === "ok" ? "var(--emerald)" : "var(--rose)" }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
