"use client";

import React, { useState } from "react";
import { formatCountdown, formatHourMinute, parseDailyCron } from "@/lib/utils";
import { useLiveNow } from "./WorldClocks";

export interface ScheduleSlot {
  id: string;
  label: string;
  pattern: string | null;
  tz: string | null;
  next: number | null;
  /** True when the time came from a dashboard edit (AppSetting override) rather than the RESEARCH_CRON_* env default. */
  overridden?: boolean;
}

interface ScheduleSlotCardProps {
  slot: ScheduleSlot;
  color: string;
  onUpdated: (slot: ScheduleSlot) => void;
}

/** Editable digital-clock card for one of the three real research-worker schedule slots. Saves immediately against the live BullMQ scheduler - no restart needed. */
export function ScheduleSlotCard({ slot, color, onUpdated }: ScheduleSlotCardProps) {
  const now = useLiveNow();
  const parsed = parseDailyCron(slot.pattern);
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
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
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
      onUpdated({ id: slot.id, label: slot.label, pattern: data.pattern, tz: data.tz, next: data.next, overridden: data.overridden });
      setMessage({ text: "Saved - takes effect immediately and survives restarts.", tone: "ok" });
      setEditing(false);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to update schedule", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  /** Drops the AppSetting override server-side and re-upserts the RESEARCH_CRON_* env default. */
  const handleReset = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pipeline/schedules/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to reset schedule");
      onUpdated({ id: slot.id, label: slot.label, pattern: data.pattern, tz: data.tz, next: data.next, overridden: false });
      setMessage({ text: "Reset to the env default.", tone: "ok" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to reset schedule", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-[var(--bd)] rounded-[12px] p-[13px] bg-[var(--card2)] flex flex-col gap-[10px]">
      <div className="flex items-center gap-[7px]">
        <span className="w-[7px] h-[7px] rounded-full flex-none" style={{ background: color }} />
        <span className="text-[11.5px] font-bold text-[var(--fg)]">{slot.label}</span>
        <span className="ml-auto text-[9.5px] font-mono text-[var(--faint)]">{slot.tz ?? "Asia/Kolkata"}</span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-[8px]">
          <input
            type="time"
            aria-label={`Set time for ${slot.label}`}
            value={timeValue}
            onChange={(e) => setTimeValue(e.target.value)}
            className="h-[34px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg)] font-mono font-bold text-[15px] outline-none focus:border-[var(--indigo)]"
          />
          <div className="flex gap-[7px]">
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
        <div className="flex items-center justify-between">
          <div
            className="font-mono text-[26px] font-extrabold tracking-wider px-[10px] py-[3px] rounded-[7px]"
            style={{ background: "var(--card)", color }}
          >
            {parsed ? formatHourMinute(parsed.hour, parsed.minute) : "--:--"}
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

      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-[10.5px] text-[var(--mut)]">
          {slot.next ? `Next run ${formatCountdown(slot.next, now)}` : "Next run time unknown - worker may not have booted"}
        </span>
        {slot.overridden && !editing && (
          <button
            type="button"
            disabled={saving}
            onClick={handleReset}
            title="Back to the RESEARCH_CRON_* env default"
            className="flex-none text-[9.5px] font-semibold text-[var(--amber)] hover:text-[var(--indigo)] cursor-pointer bg-transparent border-0 p-0 disabled:opacity-60"
          >
            {saving ? "…" : "edited · Reset"}
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
