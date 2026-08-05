"use client";

import React, { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { WorldClocks } from "@/components/shared/WorldClocks";
import { ScheduleTimeline, type TimelineSlot } from "@/components/shared/ScheduleTimeline";
import { ScheduleSlotCard, type ScheduleSlot } from "@/components/shared/ScheduleSlotCard";

/** Colors for the three real research-worker slots - shared between the timeline dots and the slot cards. */
const SLOT_COLORS: Record<string, string> = {
  "research-overnight": "var(--indigo)",
  "research-midday": "var(--amber)",
  "research-us-daytime": "var(--sky)",
};

/**
 * The six workers that run reactively rather than on a schedule (see
 * workers/shared/settings.ts for why four stages call an LLM at all, and
 * RunPipelineModal/ScheduleTimeline for the one worker - research - that
 * does have real fixed times).
 */
const REACTIVE_WORKERS: { key: string; label: string }[] = [
  { key: "planning-worker", label: "Planning" },
  { key: "outline-worker", label: "Outline" },
  { key: "writing-worker", label: "Writing" },
  { key: "image-worker", label: "Image" },
  { key: "quality-worker", label: "Quality QA" },
  { key: "publish-worker", label: "Publish" },
];

/** These four pipeline stages actually call an LLM - see workers/shared/settings.ts. */
const MODEL_STAGES: { key: "planning" | "outline" | "writing" | "semantic"; label: string }[] = [
  { key: "planning", label: "Planning" },
  { key: "outline", label: "Outline" },
  { key: "writing", label: "Writing" },
  { key: "semantic", label: "Research (Semantic)" },
];

const NO_MODEL_STAGES: { label: string; note: string }[] = [
  { label: "Research (Heuristic)", note: "Scrapes and scores trends by rule; semantic relevance/dedup is a separate LLM pass above - no AI model call here." },
  { label: "Image", note: "Draws an SVG hero image locally - no AI model call." },
  { label: "Quality QA", note: "Deterministic regex/heuristic scorer - no AI model call." },
  { label: "Publish", note: "Status flip only - no AI model call." },
];

const MODEL_OPTIONS = [
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
];

type WorkerActivityRow = {
  worker: string;
  lastRanAt: string | null;
  lastStatus: string | null;
  avgDurationMs: number | null;
  sampleCount: number;
};

type QueueSnapshot = {
  name: string;
  waiting: string;
  active: string;
  failed: string;
  dot: string;
  anim: string;
};

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SettingsPage() {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(true);
  const [workerActivity, setWorkerActivity] = useState<WorkerActivityRow[]>([]);
  const [queues, setQueues] = useState<QueueSnapshot[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);

  const [models, setModels] = useState<Record<string, string>>({});
  const [dailyTarget, setDailyTarget] = useState(3);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      fetch("/api/pipeline/run-context", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (mounted) setSlots(data.schedules ?? []);
        })
        .catch(() => {})
        .finally(() => {
          if (mounted) setIsLoadingSlots(false);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (!mounted) return;
          setWorkerActivity(data.workerActivity ?? []);
          setQueues(data.queues ?? []);
        })
        .catch(() => {})
        .finally(() => {
          if (mounted) setIsLoadingActivity(false);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        setModels(data.models ?? {});
        setDailyTarget(data.dailyBlogTarget ?? 3);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsLoadingSettings(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const saveSetting = async (key: string, value: unknown) => {
    setSavingKey(key);
    setSettingsMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save");
      setSettingsMessage({ text: "Saved.", tone: "ok" });
    } catch (err) {
      setSettingsMessage({ text: err instanceof Error ? err.message : "Failed to save", tone: "error" });
    } finally {
      setSavingKey(null);
    }
  };

  const timelineSlots: TimelineSlot[] = slots.map((slot) => ({
    id: slot.id,
    label: slot.label,
    pattern: slot.pattern,
    color: SLOT_COLORS[slot.id] ?? "var(--indigo)",
  }));

  const queueByName = new Map(queues.map((q) => [q.name, q]));

  return (
    <div className="flex flex-col gap-[13px]">
      {/* Header */}
      <div>
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          Settings
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          Only research-worker runs on a schedule - the other six workers fire reactively. See Worker Activity below.
        </p>
      </div>

      {/* Research Schedule */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between flex-wrap gap-[6px]">
          <span className="text-[13px] font-bold text-[var(--fg)]">Research Schedule</span>
          <span className="text-[11px] text-[var(--mut)]">
            The only worker with fixed daily run times - editing here takes effect immediately, no restart needed.
          </span>
        </div>
        <div className="p-[14px] flex flex-col gap-[20px]">
          <WorldClocks layout="horizontal" size={120} />
          <div>
            {isLoadingSlots ? (
              <Skeleton className="h-[60px] w-full" />
            ) : timelineSlots.length > 0 ? (
              <ScheduleTimeline slots={timelineSlots} tz="Asia/Kolkata" />
            ) : (
              <div className="text-[11.5px] text-[var(--amber)] p-[12px]">
                No schedules registered - the research worker may not have booted yet.
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
            {isLoadingSlots ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-[128px] rounded-[12px]" />
              ))
            ) : slots.length > 0 ? (
              slots.map((slot) => (
                <ScheduleSlotCard
                  key={slot.id}
                  slot={slot}
                  color={SLOT_COLORS[slot.id] ?? "var(--indigo)"}
                  onUpdated={(updated) =>
                    setSlots((current) => current.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)))
                  }
                />
              ))
            ) : (
              <div className="col-span-3 text-[11.5px] text-[var(--mut)] p-[12px]">
                No schedule slots to show yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Worker Activity */}
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
        <div className="p-[12px_14px] border-b border-[var(--bd)] flex items-center justify-between flex-wrap gap-[6px]">
          <span className="text-[13px] font-bold text-[var(--fg)]">Worker Activity</span>
          <span className="text-[11px] text-[var(--mut)]">
            Event-driven - each runs the instant the previous stage hands it a job, not on a clock.
          </span>
        </div>
        <div className="flex flex-col">
          {isLoadingActivity ? (
            Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-[12px] p-[10px_14px] border-b border-[var(--bd)] last:border-b-0">
                <Skeleton className="h-[8px] w-[8px] rounded-full" />
                <Skeleton className="h-[13px] w-[90px]" />
                <Skeleton className="h-[12px] flex-1" />
                <Skeleton className="h-[12px] w-[70px]" />
              </div>
            ))
          ) : (
            REACTIVE_WORKERS.map((worker) => {
              const activity = workerActivity.find((row) => row.worker === worker.key);
              const stage = worker.key.replace("-worker", "");
              const queue = queueByName.get(`${stage}_queue`);
              return (
                <div
                  key={worker.key}
                  className="flex items-center gap-[12px] p-[10px_14px] border-b border-[var(--bd)] last:border-b-0"
                >
                  <span
                    className={`w-[8px] h-[8px] rounded-full flex-none ${queue?.anim === "animate-dkpulse" ? "animate-dkpulse" : ""}`}
                    style={{ background: queue?.dot ?? "var(--mut)" }}
                  />
                  <span className="w-[90px] flex-none text-[12px] font-semibold text-[var(--fg)]">
                    {worker.label}
                  </span>
                  <span className="flex-1 text-[11px] text-[var(--mut)]">
                    {activity?.lastRanAt
                      ? `Last ran ${timeAgo(activity.lastRanAt)}${activity.lastStatus ? ` · ${activity.lastStatus.toLowerCase()}` : ""}`
                      : "No recent activity in the last 50 blogs"}
                  </span>
                  <span className="flex-none font-mono text-[10.5px] text-[var(--faint)]">
                    {activity?.avgDurationMs ? `avg ${formatDuration(activity.avgDurationMs)}` : "-"}
                  </span>
                  <span className="flex-none font-mono text-[10px] px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)] text-[var(--mut)]">
                    {queue ? `${queue.active} active · ${queue.waiting} queued` : "-"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* AI Model + Daily Goal */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px] items-start">
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
          <div className="p-[12px_14px] border-b border-[var(--bd)] text-[13px] font-bold text-[var(--fg)]">
            AI Model Per Pipeline Stage
          </div>
          <div className="p-[8px_14px_14px] flex flex-col">
            {isLoadingSettings ? (
              <div className="flex flex-col gap-[10px] py-[8px]">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-[29px] w-full" />
                ))}
              </div>
            ) : (
              MODEL_STAGES.map((stage) => (
                <div
                  key={stage.key}
                  className="flex items-center gap-[10px] py-[8px] border-b border-[var(--bd)]"
                >
                  <span className="w-[70px] flex-none text-[11.5px] font-semibold text-[var(--fg)]">
                    {stage.label}
                  </span>
                  <Select
                    value={models[stage.key] ?? ""}
                    onValueChange={(val) => {
                      if (!val) return;
                      setModels((current) => ({ ...current, [stage.key]: val }));
                      saveSetting(`model:${stage.key}`, val);
                    }}
                  >
                    <SelectTrigger className="flex-1 h-[29px] text-[11.5px] font-semibold font-mono border-[var(--bd)] bg-[var(--card2)] text-[var(--fg)] outline-none rounded-[8px]">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {savingKey === `model:${stage.key}` && (
                    <span className="text-[10px] text-[var(--mut)] flex-none">Saving…</span>
                  )}
                </div>
              ))
            )}
            {NO_MODEL_STAGES.map((stage) => (
              <div
                key={stage.label}
                className="flex items-center gap-[10px] py-[8px] border-b border-[var(--bd)] last:border-0"
              >
                <span className="w-[70px] flex-none text-[11.5px] font-semibold text-[var(--faint)]">
                  {stage.label}
                </span>
                <span className="flex-1 text-[10.5px] text-[var(--faint)] italic">{stage.note}</span>
              </div>
            ))}
            {settingsMessage && (
              <div
                className="mt-[8px] text-[10.5px] font-semibold"
                style={{ color: settingsMessage.tone === "ok" ? "var(--emerald)" : "var(--rose)" }}
              >
                {settingsMessage.text}
              </div>
            )}
          </div>
        </div>

        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
          <div className="p-[12px_14px] border-b border-[var(--bd)] text-[13px] font-bold text-[var(--fg)]">
            Daily Blog Goal
          </div>
          <div className="p-[14px] flex flex-col gap-[8px]">
            <div className="flex items-center justify-between mb-[4px]">
              <label htmlFor="input-daily-limit" className="text-[12px] font-semibold text-[var(--fg2)]">
                Shown as the goal on the dashboard
              </label>
              <span className="font-mono font-bold text-[13px] p-[2px_8px] rounded-[7px] bg-[var(--tint)] text-[var(--indigo)]">
                {dailyTarget}/day
              </span>
            </div>
            <input
              id="input-daily-limit"
              type="range"
              min="1"
              max="20"
              aria-label="Daily blog goal"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(Number(e.target.value))}
              onMouseUp={() => saveSetting("dailyBlogTarget", dailyTarget)}
              onTouchEnd={() => saveSetting("dailyBlogTarget", dailyTarget)}
              disabled={isLoadingSettings}
              className="w-full accent-[var(--indigo)] cursor-pointer"
            />
            <div className="flex justify-between font-mono text-[9.5px] text-[var(--faint)]">
              <span>1</span>
              <span>10</span>
              <span>20</span>
            </div>
            <div className="text-[10.5px] text-[var(--faint)] mt-[4px]">
              This is a display goal on the dashboard's home page metric card - nothing currently stops the
              pipeline from generating more or fewer than this in a day.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
