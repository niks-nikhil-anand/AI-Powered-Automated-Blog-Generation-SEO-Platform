"use client";

import React, { useEffect, useState } from "react";
import { Minus, Plus, Save } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FlipClock } from "@/components/shared/FlipClock";
import { useLiveNow } from "@/components/shared/WorldClocks";
import { ScheduleTimeline, type TimelineSlot } from "@/components/shared/ScheduleTimeline";
import { ScheduleSlotCard, type ScheduleSlot } from "@/components/shared/ScheduleSlotCard";
import { formatCountdown } from "@/lib/utils";

/** Slot accent colors by position (Blog #1, #2, ...) - cycles for goals > 6. */
const SLOT_PALETTE = [
  "var(--indigo)",
  "var(--amber)",
  "var(--sky)",
  "var(--emerald)",
  "var(--rose)",
  "var(--mut)",
];
function slotColor(index: number) {
  return SLOT_PALETTE[index % SLOT_PALETTE.length];
}

const cardClass = "overflow-hidden rounded-[12px] border border-[var(--bd)] bg-[var(--card)] shadow-[var(--shadow)]";
const cardHeaderClass = "flex flex-col gap-[6px] border-b border-[var(--bd)] p-[12px_14px] sm:flex-row sm:items-center sm:justify-between";
const cardTitleClass = "text-[13px] font-bold text-[var(--fg)]";

/**
 * The six workers that run reactively rather than on a schedule - the
 * scheduled work lives in the Publish Schedule above (one slot per Daily
 * Blog Goal, see workers/shared/publish-slots.ts).
 */
const REACTIVE_WORKERS: { key: string; label: string }[] = [
  { key: "planning-worker", label: "Planning" },
  { key: "outline-worker", label: "Outline" },
  { key: "writing-worker", label: "Writing" },
  { key: "image-worker", label: "Image" },
  { key: "quality-worker", label: "Quality QA" },
  { key: "publish-worker", label: "Publish" },
];

/**
 * Every stage with dashboard-editable primary/backup model routing. The
 * workers resolve these as primary -> backup -> env fallback per job.
 */
const MODEL_STAGES: { key: string; label: string }[] = [
  { key: "planning", label: "Planning" },
  { key: "outline", label: "Outline" },
  { key: "writing", label: "Writing" },
  { key: "writingSections", label: "Writing · sections" },
  { key: "writingSelfcheck", label: "Writing · self-check" },
  { key: "judge", label: "Quality · judge" },
  { key: "image", label: "Image" },
];

/** Display names for the models the API advertises; unknown/custom ids render as the raw id. */
const MODEL_LABELS: Record<string, string> = {
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
  "gemini-2.5-flash-image": "Nano Banana (Gemini 2.5 Flash Image)",
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 mini",
  "gpt-5-nano": "GPT-5 nano",
  "gpt-4.1": "GPT-4.1",
  "gpt-4.1-mini": "GPT-4.1 mini",
  "claude-opus-4.1": "Claude Opus 4.1",
  "claude-sonnet-4.5": "Claude Sonnet 4.5",
  "claude-haiku-4.5": "Claude Haiku 4.5",
  "claude-3-5-sonnet-latest": "Claude 3.5 Sonnet",
  "claude-3-5-haiku-latest": "Claude 3.5 Haiku",
  "flux-pro-1.1": "FLUX Pro 1.1",
  "flux-dev": "FLUX Dev",
  "flux-schnell": "FLUX Schnell",
};

type ModelOption = {
  id: string;
  label: string;
  provider: string;
  status?: { ok: boolean; reason: string };
};

type StageModelConfig = {
  primary: string | null;
  backup: string | null;
  envDefault: string;
  effective: string;
  primaryKey: string;
  backupKey: string;
  primaryOverridden: boolean;
  backupOverridden: boolean;
};

function modelLabel(modelId: string | null | undefined) {
  if (!modelId) return "Not set";
  return MODEL_LABELS[modelId] ?? modelId;
}

function modelStatusLabel(option: ModelOption) {
  const reason = option.status?.reason;
  if (!reason || option.status?.ok) return "ready";
  if (reason.endsWith("_credentials_missing")) return "missing key";
  return reason.replace(/_/g, " ");
}

function ModelOptionRow({ option }: { option: ModelOption }) {
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="truncate">{option.label ?? modelLabel(option.id)}</span>
      <span className="truncate text-[10px] font-normal text-[var(--faint)]">
        {option.provider} · {modelStatusLabel(option)}
      </span>
    </span>
  );
}

type SettingsFlags = {
  imageAiEnabled: boolean;
  judgeEnabled: boolean;
  sectionedWritingEnabled: boolean;
  selfcheckEnabled: boolean;
};

/**
 * Notes for stages with no dashboard-editable model. These are computed from
 * the live env-flag snapshot the API returns - the previous hardcoded notes
 * were factually wrong once flags flipped (e.g. Image does call Imagen when
 * IMAGE_AI_GENERATION_ENABLED is on, which is the default).
 */
function noModelStages(flags: SettingsFlags): { label: string; note: string }[] {
  return [
    {
      label: "Scheduler",
      note: "Dispatches queued blog submissions on the publish-slot schedule - no AI model call.",
    },
    {
      label: "Image fallback",
      note: flags.imageAiEnabled
        ? "Uses the Image stage model settings above when AI generation is enabled."
        : "Draws an SVG hero image locally because IMAGE_AI_GENERATION_ENABLED is off.",
    },
    {
      label: "Quality · scorer",
      note: flags.judgeEnabled
        ? "Deterministic heuristic scorer; the LLM editorial judge is the Quality · judge row above."
        : "Deterministic regex/heuristic scorer (JUDGE_ENABLED is off, so the judge row above is unused).",
    },
    { label: "Publish", note: "Status flip only - no AI model call." },
  ];
}

type WorkerHealthRow = {
  key: string;
  worker: string;
  queue: string;
  live: boolean;
  consumers: number;
  paused: boolean;
  state: string;
  lastRanAt: string | null;
  lastStatus: string | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

type QueueSnapshot = {
  name: string;
  waiting: string;
  active: string;
  failed: string;
  dot: string;
  anim: string;
};

type GoalProgress = {
  published: number;
  inFlight: number;
  remaining: number;
  backlog: number;
  pending: number;
  cancelled: number;
  failed: number;
};

type ReconcileInfo = { pattern: string | null; next: number | null } | null;

type Message = { text: string; tone: "ok" | "error" } | null;

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
  const now = useLiveNow();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [reconcile, setReconcile] = useState<ReconcileInfo>(null);
  const [workersConnected, setWorkersConnected] = useState<number | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(true);
  const [workerHealth, setWorkerHealth] = useState<WorkerHealthRow[]>([]);
  const [queues, setQueues] = useState<QueueSnapshot[]>([]);
  const [goalProgress, setGoalProgress] = useState<GoalProgress | null>(null);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);

  const [models, setModels] = useState<Record<string, string>>({});
  const [modelOverridden, setModelOverridden] = useState<Record<string, boolean>>({});
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [stageModels, setStageModels] = useState<Record<string, StageModelConfig>>({});
  const [modelOptionsByStage, setModelOptionsByStage] = useState<Record<string, ModelOption[]>>({});
  const [flags, setFlags] = useState<SettingsFlags | null>(null);
  const [dailyTarget, setDailyTarget] = useState(3);
  const [dailyOverridden, setDailyOverridden] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState(3);
  const [retryOverridden, setRetryOverridden] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Per-card messages - a Daily-goal save error used to surface under the
  // model card because both shared one settingsMessage state.
  const [modelMessage, setModelMessage] = useState<Message>(null);
  const [goalMessage, setGoalMessage] = useState<Message>(null);
  const [savingGoal, setSavingGoal] = useState(false);

  // Extracted so a Daily Blog Goal save can refresh the schedule cards
  // immediately (a goal change clears the scheduler schedule server-side)
  // instead of waiting for the next 5s poll tick.
  const loadRunContext = React.useCallback(() => {
    fetch("/api/pipeline/run-context", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setSlots(data.schedules ?? []);
        setReconcile(data.reconcile ?? null);
        setWorkersConnected(typeof data.workersConnected === "number" ? data.workersConnected : null);
      })
      .catch(() => {})
      .finally(() => setIsLoadingSlots(false));
  }, []);

  useEffect(() => {
    loadRunContext();
    const timer = window.setInterval(loadRunContext, 5000);
    return () => window.clearInterval(timer);
  }, [loadRunContext]);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      fetch("/api/dashboard", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (!mounted) return;
          setWorkerHealth(data.workerHealth ?? []);
          setQueues(data.queues ?? []);
          if (data.metrics) {
            setGoalProgress({
              published: data.metrics.todayPublishedCount ?? 0,
              inFlight: data.metrics.dailyTargetInFlight ?? 0,
              remaining: data.metrics.dailyTargetRemaining ?? 0,
              backlog: data.metrics.dailyTargetBacklogAvailable ?? 0,
              pending: data.metrics.dailyTargetBacklogPending ?? 0,
              cancelled: data.metrics.dailyTargetBacklogCancelled ?? 0,
              failed: data.metrics.dailyTargetBacklogFailed ?? 0,
            });
          }
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
        setModelOverridden(data.modelOverridden ?? {});
        setModelOptions(Array.isArray(data.modelOptions) ? data.modelOptions : []);
        setStageModels(data.stageModels ?? {});
        setModelOptionsByStage(data.modelOptionsByStage ?? {});
        setFlags(data.flags ?? null);
        setDailyTarget(data.dailyBlogTarget ?? 3);
        setDailyOverridden(Boolean(data.dailyBlogTargetOverridden));
        setRetryAttempts(typeof data.retryAttempts === "number" ? data.retryAttempts : 3);
        setRetryOverridden(Boolean(data.retryAttemptsOverridden));
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsLoadingSettings(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const saveSetting = async (
    key: string,
    value: unknown,
    setMessage: React.Dispatch<React.SetStateAction<Message>>,
    onSaved?: (data: { value?: unknown; publishSlots?: unknown }) => void,
    successText?: string
  ) => {
    setSavingKey(key);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save");
      setMessage({ text: successText ?? (value === null ? "Reset to default." : "Saved."), tone: "ok" });
      onSaved?.(data);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to save", tone: "error" });
    } finally {
      setSavingKey(null);
    }
  };

  /**
   * A goal change resizes the publish schedule server-side
   * (reconcilePublishSlots) to exactly N slots - refresh the cards
   * immediately and say how many slots the day now has.
   */
  const goalSlotsMessage = (data: { publishSlots?: unknown }, prefix: string) =>
    `${prefix} - publish schedule now has ${Number(data.publishSlots ?? 0)} slot(s); set each target time above.`;

  const saveGoal = async () => {
    setSavingGoal(true);
    setGoalMessage(null);
    let savedCount = 0;
    try {
      for (const [key, value] of [["dailyBlogTarget", dailyTarget], ["retryAttempts", retryAttempts]] as const) {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Failed to save settings.");
        savedCount++;
        if (key === "dailyBlogTarget") {
          setDailyOverridden(true);
          loadRunContext();
        } else setRetryOverridden(true);
      }
      setGoalMessage({ text: "Daily blog goal and retry attempts saved.", tone: "ok" });
    } catch (error) {
      setGoalMessage({ text: `${savedCount ? "Blog goal saved; retry attempts could not be saved. " : ""}${error instanceof Error ? error.message : "Failed to save settings."}`, tone: "error" });
    } finally {
      setSavingGoal(false);
    }
  };

  const timelineSlots: TimelineSlot[] = slots.map((slot, index) => ({
    id: slot.id,
    label: slot.label,
    pattern: slot.pattern,
    color: slotColor(index),
  }));

  const queueByName = new Map(queues.map((q) => [q.name, q]));

  /** Dropdown options for one stage: server-filtered by capability, plus saved fallback values. */
  const optionsFor = (stageKey: string) => {
    const current = stageModels[stageKey];
    const base = modelOptionsByStage[stageKey]?.length
      ? modelOptionsByStage[stageKey]
      : (modelOptions.length > 0 ? modelOptions : Object.keys(MODEL_LABELS)).map((id) => ({
          id,
          label: MODEL_LABELS[id] ?? id,
          provider: "google",
          status: { ok: true, reason: "ready" },
        }));
    const byId = new Map(base.map((option) => [option.id, option]));
    [current?.primary, current?.backup, current?.envDefault].filter(Boolean).forEach((id) => {
      if (id && !byId.has(id)) byId.set(id, { id, label: MODEL_LABELS[id] ?? id, provider: "custom", status: { ok: false, reason: "unknown_model" } });
    });
    return Array.from(byId.values());
  };

  return (
    <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-[13px] px-0 sm:gap-[14px] lg:gap-[16px]">
      {/* Header */}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="max-w-[980px]">
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          Settings
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          Only scheduler-worker runs on a schedule - the other six workers fire reactively. Schedule edits apply
          instantly and persist across restarts; model and goal changes reach running workers within ~15s.
        </p>
        </div>
        <FlipClock timeZone={slots[0]?.tz ?? "Asia/Kolkata"} />
      </div>

      {/* Publish Schedule */}
      <section className={cardClass}>
        <div className={cardHeaderClass}>
          <span className={cardTitleClass}>Publish Schedule</span>
          <div className="flex min-w-0 flex-col gap-[6px] sm:items-end">
            {workersConnected !== null && (
              <span
                className="inline-flex w-fit items-center gap-[5px] rounded-[6px] px-[7px] py-[2px] text-[10px] font-semibold"
                style={{
                  background: workersConnected > 0 ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)",
                  color: workersConnected > 0 ? "var(--emerald)" : "var(--rose)",
                }}
              >
                <span
                  className="w-[6px] h-[6px] rounded-full"
                  style={{ background: workersConnected > 0 ? "var(--emerald)" : "var(--rose)" }}
                />
                {workersConnected > 0 ? "worker connected" : "no consumer - schedules won’t fire"}
              </span>
            )}
            <span className="max-w-[900px] text-[11px] leading-relaxed text-[var(--mut)] sm:text-right">
              One slot per blog in the Daily Blog Goal. The time you set is when the scheduler starts that
              blog pipeline. Future minutes run today; a minute that already passed, even by seconds, runs tomorrow.
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-[16px] p-[12px] sm:p-[14px] lg:gap-[20px]">
          <div className="min-w-0 overflow-x-auto pb-[2px]">
            {isLoadingSlots ? (
              <Skeleton className="h-[60px] w-full" />
            ) : timelineSlots.length > 0 ? (
              <ScheduleTimeline slots={timelineSlots} tz="Asia/Kolkata" />
            ) : (
              <div className="text-[11.5px] text-[var(--amber)] p-[12px]">
                {workersConnected === 0
                  ? "No schedules registered - the scheduler worker process isn’t running, so nothing registered them."
                  : "No schedules registered - the scheduler worker may not have booted yet (or SCHEDULER_ENABLED is off)."}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {isLoadingSlots ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-[128px] rounded-[12px]" />
              ))
            ) : slots.length > 0 ? (
              slots.map((slot, index) => (
                <ScheduleSlotCard
                  key={slot.id}
                  slot={slot}
                  color={slotColor(index)}
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

          {reconcile && (
            <div className="text-[10.5px] text-[var(--faint)] -mt-[6px]">
              System tick: daily-target reconcile runs <span className="font-mono">{reconcile.pattern ?? "*/30 * * * *"}</span>
              {reconcile.next ? ` · next ${formatCountdown(reconcile.next, now)}` : ""} - it tops today&rsquo;s
              pipeline up to the Daily Blog Goal from eligible submissions: pending first, cancelled next, failed last.
            </div>
          )}
        </div>
      </section>

      {/* Worker Activity */}
      <section className={cardClass}>
        <div className={cardHeaderClass}>
          <span className={cardTitleClass}>Worker Activity</span>
          <span className="text-[11px] leading-relaxed text-[var(--mut)] sm:text-right">
            Event-driven - each runs the instant the previous stage hands it a job. Live consumer state included.
          </span>
        </div>
        <div className="flex flex-col">
          {isLoadingActivity ? (
            Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="flex flex-col gap-[8px] border-b border-[var(--bd)] p-[12px] last:border-b-0 sm:flex-row sm:items-center sm:gap-[12px] sm:p-[10px_14px]">
                <Skeleton className="h-[8px] w-[8px] rounded-full" />
                <Skeleton className="h-[13px] w-[90px]" />
                <Skeleton className="h-[12px] flex-1" />
                <Skeleton className="h-[12px] w-[70px]" />
              </div>
            ))
          ) : (
            REACTIVE_WORKERS.map((worker) => {
              const health = workerHealth.find((row) => row.worker === worker.key);
              const stage = worker.key.replace("-worker", "");
              const queue = queueByName.get(`${stage}_queue`);
              const down = health ? !health.live : false;
              const paused = health?.paused ?? false;
              const dot = down
                ? "var(--rose)"
                : paused
                  ? "var(--amber)"
                  : queue?.dot ?? "var(--mut)";
              const pulsing = !down && !paused && queue?.anim === "animate-dkpulse";
              const statusText = !health
                ? "No attempts recorded yet"
                : down
                  ? "Worker not connected - no consumer on its queue"
                  : paused
                    ? `Queue paused${health.lastRanAt ? ` · last ran ${timeAgo(health.lastRanAt)}` : ""}`
                    : health.lastRanAt
                      ? `Last ran ${timeAgo(health.lastRanAt)}${health.lastStatus ? ` · ${health.lastStatus.toLowerCase()}` : ""}`
                      : "No attempts recorded yet";
              return (
                <div
                  key={worker.key}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[10px] gap-y-[6px] border-b border-[var(--bd)] p-[12px] last:border-b-0 sm:grid-cols-[auto_120px_minmax(0,1fr)_auto] sm:items-center sm:gap-[12px] sm:p-[10px_14px] xl:grid-cols-[auto_120px_minmax(0,1fr)_auto_auto]"
                >
                  <span
                    className={`mt-[4px] size-[8px] rounded-full sm:mt-0 ${pulsing ? "animate-dkpulse" : ""}`}
                    style={{ background: dot }}
                  />
                  <span className="min-w-0 text-[12px] font-semibold text-[var(--fg)]">
                    {worker.label}
                  </span>
                  <span
                    className="col-span-2 text-[11px] sm:col-auto"
                    style={{ color: down ? "var(--rose)" : "var(--mut)" }}
                  >
                    {statusText}
                  </span>
                  <span className="col-span-2 font-mono text-[10.5px] text-[var(--faint)] sm:col-auto sm:text-right">
                    {health?.avgDurationMs
                      ? `avg ${formatDuration(health.avgDurationMs)}${health.p95DurationMs ? ` · p95 ${formatDuration(health.p95DurationMs)}` : ""}`
                      : "-"}
                  </span>
                  <span className="col-span-2 w-fit rounded-[5px] bg-[var(--card2)] px-[6px] py-[2px] font-mono text-[10px] text-[var(--mut)] sm:col-auto xl:justify-self-end">
                    {queue ? `${queue.active} active · ${queue.waiting} queued` : "-"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* AI Model + Daily Goal */}
      <div className="grid grid-cols-1 gap-[12px] items-start xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <section className={cardClass}>
          <div className={`border-b border-[var(--bd)] p-[12px_14px] ${cardTitleClass}`}>
            AI Model Per Pipeline Stage
          </div>
          <div className="flex flex-col p-[8px_12px_14px] sm:p-[8px_14px_14px]">
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
                  className="grid grid-cols-1 gap-[8px] border-b border-[var(--bd)] py-[11px] lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_78px] lg:items-center lg:gap-[10px]"
                >
                  <div className="min-w-0">
                    <span className="text-[11.5px] font-semibold text-[var(--fg)]">{stage.label}</span>
                    <div className="mt-[2px] truncate font-mono text-[9.5px] text-[var(--faint)]">
                      env: {stageModels[stage.key]?.envDefault ?? models[stage.key] ?? "not set"}
                    </div>
                  </div>
                  <Select
                    value={stageModels[stage.key]?.primary ?? "__env__"}
                    onValueChange={(val) => {
                      const key = stageModels[stage.key]?.primaryKey ?? `model:${stage.key}:primary`;
                      const value = val === "__env__" ? null : val;
                      saveSetting(key, value, setModelMessage, (data) => {
                        setStageModels((current) => ({
                          ...current,
                          [stage.key]: {
                            ...(current[stage.key] ?? { envDefault: String(data.value ?? ""), backup: null, effective: String(data.value ?? ""), primaryKey: key, backupKey: `model:${stage.key}:backup`, primaryOverridden: false, backupOverridden: false }),
                            primary: value === null ? null : String(data.value),
                            primaryOverridden: value !== null,
                            effective: value === null
                              ? (current[stage.key]?.backup ?? current[stage.key]?.envDefault ?? String(data.value ?? ""))
                              : String(data.value),
                          },
                        }));
                        setModels((current) => ({ ...current, [stage.key]: value === null ? String(data.value) : String(data.value) }));
                        setModelOverridden((current) => ({ ...current, [stage.key]: value !== null }));
                      });
                    }}
                  >
                    <SelectTrigger className="h-[34px] w-full min-w-0 rounded-[8px] border-[var(--bd)] bg-[var(--card2)] font-mono text-[11.5px] font-semibold text-[var(--fg)] outline-none sm:h-[29px]">
                      <SelectValue placeholder="Primary model">
                        <span className="truncate">
                          {stageModels[stage.key]?.primary
                            ? modelLabel(stageModels[stage.key]?.primary)
                            : `Env default (${modelLabel(stageModels[stage.key]?.envDefault)})`}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false} className="max-h-[300px] w-[min(520px,calc(100vw-32px))] min-w-[340px]">
                      <SelectItem value="__env__">
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate">Env default</span>
                          <span className="truncate text-[10px] font-normal text-[var(--faint)]">
                            {modelLabel(stageModels[stage.key]?.envDefault)}
                          </span>
                        </span>
                      </SelectItem>
                      {optionsFor(stage.key).map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          <ModelOptionRow option={opt} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={stageModels[stage.key]?.backup ?? "__none__"}
                    onValueChange={(val) => {
                      const key = stageModels[stage.key]?.backupKey ?? `model:${stage.key}:backup`;
                      const value = val === "__none__" ? null : val;
                      saveSetting(key, value, setModelMessage, (data) => {
                        setStageModels((current) => ({
                          ...current,
                          [stage.key]: {
                            ...(current[stage.key] ?? { envDefault: "", primary: null, effective: "", primaryKey: `model:${stage.key}:primary`, backupKey: key, primaryOverridden: false, backupOverridden: false }),
                            backup: value === null ? null : String(data.value),
                            backupOverridden: value !== null,
                          },
                        }));
                      });
                    }}
                  >
                    <SelectTrigger className="h-[34px] w-full min-w-0 rounded-[8px] border-[var(--bd)] bg-[var(--card2)] font-mono text-[11.5px] font-semibold text-[var(--fg)] outline-none sm:h-[29px]">
                      <SelectValue placeholder="Backup model">
                        <span className="truncate">
                          {stageModels[stage.key]?.backup ? modelLabel(stageModels[stage.key]?.backup) : "No backup"}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false} className="max-h-[300px] w-[min(520px,calc(100vw-32px))] min-w-[340px]">
                      <SelectItem value="__none__">
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate">No backup</span>
                          <span className="truncate text-[10px] font-normal text-[var(--faint)]">Use env fallback after primary</span>
                        </span>
                      </SelectItem>
                      {optionsFor(stage.key).map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          <ModelOptionRow option={opt} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-[var(--mut)] lg:text-right">
                    {savingKey === (stageModels[stage.key]?.primaryKey ?? `model:${stage.key}:primary`) ||
                    savingKey === (stageModels[stage.key]?.backupKey ?? `model:${stage.key}:backup`)
                      ? "Saving..."
                      : modelOverridden[stage.key] || stageModels[stage.key]?.backupOverridden
                        ? "Custom"
                        : "Env"}
                  </span>
                </div>
              ))
            )}
            {!isLoadingSettings && flags && noModelStages(flags).map((stage) => (
              <div
                key={stage.label}
                className="grid grid-cols-1 gap-[4px] border-b border-[var(--bd)] py-[9px] last:border-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-[10px]"
              >
                <span className="text-[11.5px] font-semibold text-[var(--faint)]">
                  {stage.label}
                </span>
                <span className="text-[10.5px] leading-relaxed text-[var(--faint)] italic">{stage.note}</span>
              </div>
            ))}
            <div className="text-[10px] text-[var(--faint)] mt-[8px]">
              Applies to new jobs within ~15s. Each worker tries primary first, then backup, then the env fallback
              shown on the row.
            </div>
            {modelMessage && (
              <div
                className="mt-[6px] text-[10.5px] font-semibold"
                style={{ color: modelMessage.tone === "ok" ? "var(--emerald)" : "var(--rose)" }}
              >
                {modelMessage.text}
              </div>
            )}
          </div>
        </section>

        <section className={cardClass}>
          <div className="flex flex-col gap-[6px] border-b border-[var(--bd)] p-[12px_14px] sm:flex-row sm:items-center sm:justify-between">
            <span className={cardTitleClass}>Daily Blog Goal</span>
            {dailyOverridden && !isLoadingSettings && (
              <button
                type="button"
                disabled={savingGoal}
                onClick={() =>
                  saveSetting("dailyBlogTarget", null, setGoalMessage, (data) => {
                    setDailyTarget(Number(data.value));
                    setDailyOverridden(false);
                    loadRunContext();
                    setGoalMessage({ text: goalSlotsMessage(data, "Reset to default"), tone: "ok" });
                  })
                }
                className="text-[10px] font-semibold text-[var(--faint)] hover:text-[var(--indigo)] cursor-pointer bg-transparent border-0 p-0"
              >
                Reset to default
              </button>
            )}
          </div>
          <div className="flex flex-col gap-[8px] p-[12px] sm:p-[14px]">
            <div className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="text-[12px] font-semibold text-[var(--fg2)]">Blogs per day</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Fewer blogs per day" title="Fewer blogs per day"
                  disabled={isLoadingSettings || savingGoal || dailyTarget <= 1}
                  onClick={() => { setDailyTarget((value) => Math.max(1, value - 1)); setGoalMessage(null); }}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--bd)] text-[var(--fg2)] hover:border-[var(--indigo)] disabled:opacity-40">
                  <Minus size={16} />
                </button>
                <output aria-label="Blogs per day" className="w-16 text-center font-mono text-[15px] font-bold tabular-nums text-[var(--indigo)]">{dailyTarget}</output>
                <button type="button" aria-label="More blogs per day" title="More blogs per day"
                  disabled={isLoadingSettings || savingGoal || dailyTarget >= 20}
                  onClick={() => { setDailyTarget((value) => Math.min(20, value + 1)); setGoalMessage(null); }}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--bd)] text-[var(--fg2)] hover:border-[var(--indigo)] disabled:opacity-40">
                  <Plus size={16} />
                </button>
              </div>
            </div>
            {goalProgress && (
              <div className="flex items-center gap-[6px] flex-wrap font-mono text-[10px] text-[var(--mut)]">
                <span className="px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)]">
                  today <span className="text-[var(--fg)] font-bold">{goalProgress.published}</span> published
                </span>
                <span className="px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)]">
                  <span className="text-[var(--fg)] font-bold">{goalProgress.inFlight}</span> in flight
                </span>
                <span className="px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)]">
                  <span className="text-[var(--fg)] font-bold">{goalProgress.remaining}</span> to go
                </span>
                <span className="px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)]">
                  <span className="text-[var(--fg)] font-bold">{goalProgress.backlog}</span> eligible backlog
                </span>
                <span className="px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)]">
                  <span className="text-[var(--fg)] font-bold">{goalProgress.pending}</span> pending
                </span>
                <span className="px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)]">
                  <span className="text-[var(--fg)] font-bold">{goalProgress.cancelled}</span> cancelled
                </span>
                <span className="px-[6px] py-[2px] rounded-[5px] bg-[var(--card2)]">
                  <span className="text-[var(--fg)] font-bold">{goalProgress.failed}</span> failed fallback
                </span>
              </div>
            )}
            {/* Retry Attempts - drives BullMQ attempts + QA regeneration budget (workers/shared/retry-config.ts) */}
            <div className="mt-[4px] flex flex-col gap-[10px] border-t border-[var(--bd)] pt-[10px] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <div className="text-[12px] font-semibold text-[var(--fg2)]">Retry attempts per blog</div>
                <div className="text-[10px] text-[var(--faint)] mt-[1px]">
                  After the first try, every failed pipeline stage retries this many times (0 = never). A blog
                  that still fails is backfilled from the backlog - the slot is never abandoned at its publish
                  time.
                </div>
              </div>
              <div className="flex flex-none items-center gap-[6px] sm:justify-end">
                {retryOverridden && (
                  <button
                    type="button"
                    disabled={savingGoal}
                    onClick={() =>
                      saveSetting("retryAttempts", null, setGoalMessage, (data) => {
                        setRetryAttempts(Number(data.value));
                        setRetryOverridden(false);
                      })
                    }
                    className="text-[9.5px] font-semibold text-[var(--faint)] hover:text-[var(--indigo)] cursor-pointer bg-transparent border-0 p-0 mr-[2px]"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Fewer retry attempts"
                  disabled={isLoadingSettings || savingGoal || retryAttempts <= 0}
                  onClick={() => { setRetryAttempts((value) => Math.max(0, value - 1)); setGoalMessage(null); }}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--bd)] text-[var(--fg2)] hover:border-[var(--indigo)] disabled:opacity-40"
                >
                  <Minus size={16} />
                </button>
                <output aria-label="Retry attempts" className="w-16 text-center font-mono text-[15px] font-bold tabular-nums text-[var(--indigo)]">{retryAttempts}</output>
                <button
                  type="button"
                  aria-label="More retry attempts"
                  disabled={isLoadingSettings || savingGoal || retryAttempts >= 10}
                  onClick={() => { setRetryAttempts((value) => Math.min(10, value + 1)); setGoalMessage(null); }}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--bd)] text-[var(--fg2)] hover:border-[var(--indigo)] disabled:opacity-40"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div className="text-[10.5px] text-[var(--faint)] mt-[4px]">
              Sets how many publish slots the schedule above has - one independent pipeline run per slot
              (Planning → Outline → Writing → Image → QA → Publish), published at its configured
              time. A slot runs only when the daily goal still has room and an eligible row exists: pending first,
              cancelled next, failed last. If nothing is eligible, the scheduler records a clean no-op.
            </div>
            {goalMessage && (
              <div
                className="mt-[2px] text-[10.5px] font-semibold"
                style={{ color: goalMessage.tone === "ok" ? "var(--emerald)" : "var(--rose)" }}
              >
                {goalMessage.text}
              </div>
            )}
            <div className="mt-3 flex justify-end border-t border-[var(--bd)] pt-3">
              <button type="button" onClick={saveGoal} disabled={isLoadingSettings || savingGoal || savingKey !== null}
                className="flex h-10 items-center gap-2 rounded-md bg-[var(--indigo)] px-4 text-[12px] font-semibold text-white disabled:opacity-50">
                <Save size={16} />{savingGoal ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
