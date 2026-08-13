"use client";

import React, { useState } from "react";
import { formatCountdown, formatHourMinute, parseDailyCron } from "@/lib/utils";
import { useLiveNow } from "./WorldClocks";

export interface ScheduleSlot {
  id: string;
  label: string;
  /** Publish-time daily cron ("M H * * *") - the time the blog goes live. Null = not configured. */
  pattern: string | null;
  tz?: string | null;
  /** Next generation fire time (epoch ms) from BullMQ - earlier than publish by the lead. */
  next: number | null;
  /** "HH:MM" target publish time, straight from the API. */
  publishTime?: string | null;
  /** "HH:MM" wall-clock generation start (publish minus lead). */
  generationStart?: string | null;
  /** True when the slot has a publish time configured. */
  configured?: boolean;
}

interface ScheduleSlotCardProps {
  slot: ScheduleSlot;
  color: string;
  onUpdated: (slot: ScheduleSlot) => void;
}

/**
 * Editable digital-clock card for one publish slot. The time shown and
 * edited is the TARGET PUBLISH time (when the blog goes live), not the
 * generation start - generation fires earlier by the lead and a finished
 * blog is held until this time. Saves immediately against the live BullMQ
 * scheduler and persists to AppSetting, so it survives worker restarts.
 */
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
      onUpdated({ ...slot, ...data });
      setMessage({
        text: `Saved - publishes daily at ${formatHourMinute(hour, minute)} (survives restarts).`,
        tone: "ok",
      });
      setEditing(false);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to update schedule", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  /** Clears the slot's publish time (AppSetting row + Redis scheduler both removed server-side). */
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
            aria-label={`Set publish time for ${slot.label}`}
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
          {!parsed
            ? "Not set - Edit to pick a publish time"
            : slot.next
              ? `Generation ${formatCountdown(slot.next, now)} · on air ${slot.publishTime ?? formatHourMinute(parsed.hour, parsed.minute)}`
              : `On air ${slot.publishTime ?? formatHourMinute(parsed.hour, parsed.minute)} daily`}
        </span>
        {parsed && !editing && (
          <button
            type="button"
            disabled={saving}
            onClick={handleClear}
            title="Clear this slot's publish time"
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
