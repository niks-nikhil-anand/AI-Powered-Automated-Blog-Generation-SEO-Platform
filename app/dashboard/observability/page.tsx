"use client";

import { useCallback, useEffect, useState } from "react";

type Range = "15m" | "1h" | "6h" | "24h" | "7d" | "30d";
type Dashboard = {
  state: "ready" | "disabled" | "unavailable";
  message?: string;
  generatedAt: string;
  overview: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number; averageLatencyMs: number | null; successRate: number | null; rate429: number; retries: number; fallbacks: number };
  models: Array<{ model: string; requests: number; totalTokens: number; averageLatencyMs: number | null; errors: number; rate429: number }>;
  stages: Array<{ stage: string; requests: number; totalTokens: number; errors: number }>;
  traces: Array<{ id: string; traceId: string; startedAt: string; model: string; worker: string; stage: string; status: "success" | "error"; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; latencyMs: number | null; retries: number }>;
};

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "15m", label: "15m" }, { value: "1h", label: "1h" }, { value: "6h", label: "6h" },
  { value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" },
];

const emptyDashboard: Dashboard = {
  state: "disabled", message: "Loading observability…", generatedAt: "",
  overview: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, averageLatencyMs: null, successRate: null, rate429: 0, retries: 0, fallbacks: 0 },
  models: [], stages: [], traces: [],
};

function formatNumber(value: number) { return new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function formatMs(value: number | null) { return value === null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`; }
function formatTime(value: string) { return value ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(value)) : "—"; }

function Metric({ label, value, detail, tone = "var(--indigo)" }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[13px_14px] shadow-[var(--shadow)] min-w-0">
    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--mut)]">{label}</div>
    <div className="mt-[8px] text-[25px] leading-none font-extrabold tracking-tight text-[var(--fg)]">{value}</div>
    <div className="mt-[10px] flex items-center gap-[6px] text-[10.5px] text-[var(--faint)]"><span className="w-[5px] h-[5px] rounded-full" style={{ background: tone }} />{detail}</div>
  </div>;
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="flex items-end justify-between gap-3 mb-[11px]"><div><h2 className="text-[13px] font-bold text-[var(--fg)]">{title}</h2><p className="mt-[2px] text-[10.5px] text-[var(--mut)]">{detail}</p></div></div>;
}

export default function ObservabilityPage() {
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<Dashboard>(emptyDashboard);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/observability?range=${range}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load observability data");
      setData(await response.json() as Dashboard);
    } catch (error) {
      setData({ ...emptyDashboard, state: "unavailable", message: error instanceof Error ? error.message : "Unable to load observability data." });
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const statusTone = data.state === "ready" ? "var(--emerald)" : data.state === "disabled" ? "var(--amber)" : "var(--rose)";
  const maxRequests = Math.max(1, ...data.models.map((model) => model.requests));

  return <div className="max-w-[1600px] mx-auto space-y-[18px]">
    <header className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
      <div><div className="flex items-center gap-[8px]"><span className="w-[8px] h-[8px] rounded-full" style={{ background: statusTone }} /><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: statusTone }}>{data.state === "ready" ? "Langfuse connected" : data.state === "disabled" ? "Tracing disabled" : "Analytics unavailable"}</span></div>
        <h1 className="mt-[6px] text-[25px] leading-none font-extrabold tracking-tight text-[var(--fg)]">AI Observability</h1>
        <p className="mt-[5px] text-[12px] text-[var(--mut)]">Vertex request analytics, model performance, and capacity signals from the centralized gateway.</p>
      </div>
      <div className="flex items-center gap-[8px]" role="group" aria-label="Time range">
        <div className="flex rounded-[8px] border border-[var(--bd)] bg-[var(--card)] p-[3px]">{RANGE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setRange(option.value)} aria-pressed={range === option.value} className={`px-[8px] py-[5px] text-[10px] font-semibold rounded-[5px] transition-colors ${range === option.value ? "bg-[var(--tint)] text-[var(--indigo)]" : "text-[var(--mut)] hover:bg-[var(--card2)]"}`}>{option.label}</button>)}</div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-[8px] border border-[var(--bd)] bg-[var(--card)] px-[10px] py-[7px] text-[10.5px] font-semibold text-[var(--fg2)] hover:bg-[var(--card2)] disabled:opacity-50">{loading ? "Loading…" : "Refresh"}</button>
      </div>
    </header>

    {data.state !== "ready" ? <div className="rounded-[10px] border border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.08)] p-[12px_14px] text-[12px] text-[var(--fg2)]"><span className="font-semibold text-[var(--amber)]">Observability is not collecting data.</span> <span className="text-[var(--mut)]">{data.message}</span></div> : null}

    <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-[10px]">
      <Metric label="Requests" value={formatNumber(data.overview.requests)} detail="Vertex invocations" />
      <Metric label="Total tokens" value={formatNumber(data.overview.totalTokens)} detail={`${formatNumber(data.overview.inputTokens)} in · ${formatNumber(data.overview.outputTokens)} out`} tone="var(--sky)" />
      <Metric label="Avg latency" value={formatMs(data.overview.averageLatencyMs)} detail="Model invocation only" tone="var(--emerald)" />
      <Metric label="Success rate" value={data.overview.successRate === null ? "—" : `${data.overview.successRate}%`} detail="Completed requests" tone="var(--emerald)" />
      <Metric label="Capacity pressure" value={`${data.overview.rate429} 429s`} detail={`${data.overview.retries} retries · ${data.overview.fallbacks} fallbacks`} tone={data.overview.rate429 ? "var(--rose)" : "var(--amber)"} />
    </section>

    <section className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-[14px]">
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[14px] shadow-[var(--shadow)]">
        <SectionTitle title="Model usage" detail="Observed Vertex generations in the selected range" />
        {data.models.length === 0 ? <p className="py-[26px] text-center text-[11px] text-[var(--mut)]">No LLM activity in this time range.</p> : <div className="space-y-[13px]">{data.models.map((model) => <div key={model.model} className="grid grid-cols-[minmax(120px,0.8fr)_minmax(120px,2fr)_auto] gap-[10px] items-center"><div className="min-w-0"><div className="truncate font-mono text-[11px] font-semibold text-[var(--fg)]">{model.model}</div><div className="mt-[2px] text-[10px] text-[var(--mut)]">{formatNumber(model.totalTokens)} tokens · {formatMs(model.averageLatencyMs)}</div></div><div className="h-[7px] rounded-full bg-[var(--card2)] overflow-hidden"><div className="h-full rounded-full bg-[var(--indigo)]" style={{ width: `${(model.requests / maxRequests) * 100}%` }} /></div><div className="text-right font-mono text-[11px] text-[var(--fg2)]">{model.requests} <span className="text-[var(--faint)]">req</span></div></div>)}</div>}
      </div>
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[14px] shadow-[var(--shadow)]">
        <SectionTitle title="Gateway health" detail="Live rate limits remain Redis/BullMQ-owned" />
        <dl className="space-y-[9px] text-[11px]">{[
          ["Analytics ingestion", data.state === "ready" ? "Healthy" : "Unavailable", statusTone],
          ["429 responses", String(data.overview.rate429), data.overview.rate429 ? "var(--rose)" : "var(--emerald)"],
          ["Retry pressure", `${data.overview.retries} retries`, data.overview.retries ? "var(--amber)" : "var(--emerald)"],
          ["Flash fallbacks", String(data.overview.fallbacks), "var(--sky)"],
        ].map(([label, value, tone]) => <div key={label} className="flex items-center justify-between border-b border-[var(--bd)] pb-[8px]"><dt className="text-[var(--mut)]">{label}</dt><dd className="font-semibold" style={{ color: tone }}>{value}</dd></div>)}</dl>
        <p className="mt-[11px] text-[10px] leading-[1.45] text-[var(--faint)]">Langfuse reports observed usage. It does not report Google’s remaining quota.</p>
      </div>
    </section>

    <section className="grid grid-cols-1 xl:grid-cols-2 gap-[14px]">
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[14px] shadow-[var(--shadow)]"><SectionTitle title="Pipeline stages" detail="Usage grouped by the requesting pipeline stage" />
        <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="border-b border-[var(--bd)] text-left text-[9.5px] uppercase tracking-wider text-[var(--mut)]"><th className="pb-[8px] font-bold">Stage</th><th className="pb-[8px] text-right font-bold">Requests</th><th className="pb-[8px] text-right font-bold">Tokens</th><th className="pb-[8px] text-right font-bold">Errors</th></tr></thead><tbody>{data.stages.map((stage) => <tr key={stage.stage} className="border-b border-[var(--bd)] last:border-0"><td className="py-[9px] font-medium text-[var(--fg2)]">{stage.stage}</td><td className="py-[9px] text-right font-mono">{stage.requests}</td><td className="py-[9px] text-right font-mono">{formatNumber(stage.totalTokens)}</td><td className="py-[9px] text-right font-mono" style={{ color: stage.errors ? "var(--rose)" : "var(--mut)" }}>{stage.errors}</td></tr>)}{data.stages.length === 0 ? <tr><td colSpan={4} className="py-[28px] text-center text-[var(--mut)]">No stage data available.</td></tr> : null}</tbody></table></div>
      </div>
      <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[14px] shadow-[var(--shadow)]"><SectionTitle title="Capacity interpretation" detail="What the gateway can—and cannot—conclude" />
        <div className="space-y-[10px] text-[11px] leading-[1.55]"><div className="rounded-[8px] bg-[var(--card2)] p-[10px]"><span className="font-semibold text-[var(--fg)]">Observed usage:</span> <span className="text-[var(--mut)]">request volume, tokens, model latency, retry count, and 429s from Langfuse.</span></div><div className="rounded-[8px] bg-[var(--card2)] p-[10px]"><span className="font-semibold text-[var(--fg)]">Configured limits:</span> <span className="text-[var(--mut)]">gateway RPM and breaker state remain operational data, not Google quota telemetry.</span></div><div className="rounded-[8px] bg-[var(--card2)] p-[10px]"><span className="font-semibold text-[var(--fg)]">Google quota:</span> <span className="text-[var(--mut)]">not inferred here. Connect Cloud quota APIs separately if exact quota reporting is needed.</span></div></div>
      </div>
    </section>

    <section className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[14px] shadow-[var(--shadow)]"><SectionTitle title="Request traces" detail="Each row represents one actual Vertex model invocation; retries appear as separate entries." />
      <div className="overflow-x-auto"><table className="min-w-[920px] w-full text-[11px]"><thead><tr className="border-b border-[var(--bd)] text-left text-[9.5px] uppercase tracking-wider text-[var(--mut)]">{["Time", "Request", "Stage", "Model", "Status", "Tokens", "Latency", "Retries"].map((header) => <th key={header} className="pb-[8px] pr-[12px] font-bold last:text-right last:pr-0">{header}</th>)}</tr></thead><tbody>{data.traces.map((trace) => <tr key={trace.id} className="border-b border-[var(--bd)] last:border-0 hover:bg-[var(--card2)]"><td className="py-[9px] pr-[12px] whitespace-nowrap text-[var(--mut)]">{formatTime(trace.startedAt)}</td><td className="py-[9px] pr-[12px] max-w-[135px] truncate font-mono text-[10px] text-[var(--faint)]" title={trace.traceId}>{trace.traceId || trace.id}</td><td className="py-[9px] pr-[12px] text-[var(--fg2)]">{trace.stage}</td><td className="py-[9px] pr-[12px] font-mono text-[10px]">{trace.model}</td><td className="py-[9px] pr-[12px]"><span className="rounded-[5px] px-[5px] py-[2px] text-[9px] font-bold" style={{ color: trace.status === "success" ? "var(--emerald)" : "var(--rose)", background: trace.status === "success" ? "rgba(16,185,129,0.10)" : "rgba(244,63,94,0.10)" }}>{trace.status}</span></td><td className="py-[9px] pr-[12px] font-mono">{trace.totalTokens === null ? "—" : formatNumber(trace.totalTokens)}</td><td className="py-[9px] pr-[12px] font-mono">{formatMs(trace.latencyMs)}</td><td className="py-[9px] text-right font-mono">{trace.retries}</td></tr>)}{data.traces.length === 0 ? <tr><td colSpan={8} className="py-[32px] text-center text-[var(--mut)]">No LLM activity in this time range.</td></tr> : null}</tbody></table></div>
    </section>
  </div>;
}
