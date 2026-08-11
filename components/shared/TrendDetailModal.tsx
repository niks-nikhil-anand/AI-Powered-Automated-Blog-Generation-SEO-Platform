"use client";

import React from "react";
import {
  Eye,
  Trash2,
  CheckCircle,
  ExternalLink,
  Flame,
  BarChart3,
  Newspaper,
  Search,
  AlertTriangle,
} from "lucide-react";

/** Per-dimension scores from scoreClusters() - Trend.scoreBreakdown Json column. */
export interface TrendScoreBreakdown {
  trendDemand?: number;
  newsFreshness?: number;
  githubMomentum?: number;
  multiSourceValidation?: number;
  semanticRelevance?: number;
}

/** One entry of Trend.evidenceArticles (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 1). */
export interface TrendEvidenceArticle {
  url: string;
  title: string;
  excerpt: string;
  fetchedAt: string;
  extractor: string;
  chars: number;
}

/**
 * Trend.researchDetail (docs/RESEARCH_ENGINE_UPGRADE.md) - present only on
 * trends produced by the research engine. All fields optional/defensive so
 * legacy rows (and partial writes) render nothing new.
 */
export interface TrendResearchDetail {
  engine?: boolean;
  tier?: "excellent" | "strong" | "weak" | "reject";
  family?: string;
  exploratory?: boolean;
  finalScore?: Partial<{
    trendDemand: number;
    freshness: number;
    searchDemand: number;
    githubMomentum: number;
    sourceDiversity: number;
    evidenceQuality: number;
    topicQuality: number;
    novelty: number;
    audienceValue: number;
    final: number;
  }>;
  novelty?: { noveltyScore?: number; decision?: string; reason?: string; layer?: string };
  evidenceQuality?: { total?: number };
  topicQuality?: { total?: number };
}

export interface TrendRow {
  id: string;
  srcInitial: string;
  source: string;
  srcColor: string;
  score: string;
  scoreBg: string;
  scoreFg: string;
  title: string;
  cat: string;
  rec: string;
  recBg: string;
  recFg: string;
  volume: string;
  scorePct: string;
  // Detail-modal payloads serialized by app/api/dashboard/route.ts. Optional
  // because older rows (and rows fetched before these fields existed) simply
  // render fewer sections.
  status?: string;
  createdAt?: string;
  evidenceSummary?: string | null;
  scoreBreakdown?: TrendScoreBreakdown | null;
  evidenceArticles?: TrendEvidenceArticle[] | null;
  researchDetail?: TrendResearchDetail | null;
}

interface TrendDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  trend: TrendRow | null;
  onApprove: (trend: TrendRow) => void;
  onSkip: (trend: TrendRow) => void;
  onDelete: (trend: TrendRow) => void;
  minWritingScore?: number;
}

function clampPct(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function barColor(value: number) {
  if (value >= 70) return "var(--emerald)";
  if (value >= 50) return "var(--amber)";
  if (value > 0) return "var(--rose)";
  return "var(--mut)";
}

/** "3m" / "2h" / "5d" - compact age for the overview grid. */
function formatAgeShort(iso?: string) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "2m ago" - for evidence fetchedAt. */
function formatAgoShort(iso?: string) {
  const age = formatAgeShort(iso);
  return age ? (age === "just now" ? age : `${age} ago`) : null;
}

function hostnameOf(url?: string) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Split the candidateDescription() text research-worker persists into
 * Trend.evidenceSummary back into its parts: the free-text reason ("summary"),
 * the keyword list, and the "- source: title (url)" evidence lines. Anything
 * that doesn't match the expected markers is kept in the summary so older or
 * hand-written rows still show something useful.
 */
function parseEvidenceSummary(raw: string): {
  summary: string;
  keywords: string[];
  evidence: { source: string; title: string; url?: string }[];
} {
  const summaryParts: string[] = [];
  let keywords: string[] = [];
  const evidence: { source: string; title: string; url?: string }[] = [];

  for (const block of raw.split(/\n\n+/)) {
    if (block.startsWith("Score:")) continue;
    if (block.startsWith("Keywords:")) {
      keywords = block
        .slice("Keywords:".length)
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean);
      continue;
    }
    if (block.startsWith("Evidence:")) {
      for (const line of block.split("\n").slice(1)) {
        const match = line.match(/^-\s+([^:]+):\s+(.*)$/);
        if (!match) continue;
        let title = match[2].trim();
        let url: string | undefined;
        const urlMatch = title.match(/^(.*?)\s*\((https?:\/\/[^)]+)\)\s*$/);
        if (urlMatch) {
          title = urlMatch[1].trim();
          url = urlMatch[2];
        }
        evidence.push({ source: match[1].trim(), title, url });
      }
      continue;
    }
    summaryParts.push(block.trim());
  }

  return { summary: summaryParts.join("\n\n").trim(), keywords, evidence };
}

const BREAKDOWN_ROWS: { key: keyof TrendScoreBreakdown; label: string }[] = [
  { key: "trendDemand", label: "Trend Demand" },
  { key: "newsFreshness", label: "News Freshness" },
  { key: "githubMomentum", label: "GitHub Momentum" },
  { key: "multiSourceValidation", label: "Multi-source Validation" },
  { key: "semanticRelevance", label: "Semantic Relevance" },
];

/** The research engine's 9-dimension final score (docs/RESEARCH_ENGINE_UPGRADE.md Phase 11). */
const ENGINE_ROWS: { key: keyof NonNullable<TrendResearchDetail["finalScore"]>; label: string }[] = [
  { key: "trendDemand", label: "Trend Demand" },
  { key: "freshness", label: "Freshness" },
  { key: "searchDemand", label: "Search Demand" },
  { key: "githubMomentum", label: "GitHub Momentum" },
  { key: "sourceDiversity", label: "Source Diversity" },
  { key: "evidenceQuality", label: "Evidence Quality" },
  { key: "topicQuality", label: "Topic Quality" },
  { key: "novelty", label: "Novelty" },
  { key: "audienceValue", label: "Audience Value" },
];

function tierBadge(tier?: string) {
  switch (tier) {
    case "excellent":
      return { bg: "rgba(16,185,129,0.14)", fg: "var(--emerald)", label: "Excellent" };
    case "strong":
      return { bg: "rgba(56,189,248,0.14)", fg: "var(--sky)", label: "Strong" };
    case "weak":
      return { bg: "rgba(245,158,11,0.14)", fg: "var(--amber)", label: "Weak" };
    default:
      return { bg: "rgba(244,63,94,0.14)", fg: "var(--rose)", label: "Reject" };
  }
}

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] flex items-center gap-[5px]">
      {icon}
      {children}
    </span>
  );
}

export function TrendDetailModal({
  isOpen,
  onClose,
  trend,
  onApprove,
  onSkip,
  onDelete,
  minWritingScore = 90,
}: TrendDetailModalProps) {
  if (!isOpen || !trend) return null;

  const breakdown = trend.scoreBreakdown ?? null;
  const hasBreakdown = Boolean(
    breakdown && BREAKDOWN_ROWS.some((row) => typeof breakdown[row.key] === "number")
  );
  const articles = Array.isArray(trend.evidenceArticles) ? trend.evidenceArticles : [];
  const parsed = trend.evidenceSummary
    ? parseEvidenceSummary(trend.evidenceSummary)
    : { summary: "", keywords: [], evidence: [] };
  const age = formatAgeShort(trend.createdAt);

  // Research-engine detail (only present on engine-produced trends).
  const rd = trend.researchDetail ?? null;
  const engineScore = rd?.finalScore ?? null;
  const hasEngineScore = Boolean(engineScore && typeof engineScore.final === "number");
  const tier = tierBadge(rd?.tier);

  // Distinct evidence domains - from fetched articles when we have them, else
  // from the URLs embedded in the summary evidence lines.
  const domains = new Set(
    (articles.length > 0
      ? articles.map((article) => hostnameOf(article.url))
      : parsed.evidence.map((line) => hostnameOf(line.url))
    ).filter((host): host is string => Boolean(host))
  );

  const warnings: string[] = [];
  if (domains.size > 0 && domains.size < 3) {
    warnings.push(
      `Only ${domains.size} independent domain${domains.size === 1 ? "" : "s"} available`
    );
  }
  if (articles.length === 0 && parsed.evidence.some((line) => line.url)) {
    warnings.push(
      "Full-text evidence not fetched for this trend - writing/fact-check ground on source titles only"
    );
  }
  const githubMomentum = breakdown?.githubMomentum ?? 0;
  if (githubMomentum > 0 && githubMomentum < 70) {
    warnings.push("GitHub momentum is moderate");
  }
  const multiSource = breakdown?.multiSourceValidation ?? 0;
  if (hasBreakdown && multiSource < 50) {
    warnings.push("Limited multi-source validation - signal rests on few independent sources");
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.6)] backdrop-blur-sm flex items-center justify-center p-[16px] animate-dkfade"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] max-h-[90vh] bg-[var(--card)] border border-[var(--bd)] rounded-[16px] shadow-[var(--shadow)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[16px] h-[48px] border-b border-[var(--bd)] bg-[var(--card2)] flex-none">
          <span className="text-[13.5px] font-bold text-[var(--fg)] flex items-center gap-[6px]">
            <Eye size={14} className="text-[var(--indigo)]" /> Trend Signal Details
          </span>
          <button
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--fg)] flex items-center justify-center text-[11px] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content (scrollable - the signal/evidence sections can get long) */}
        <div className="p-[18px] flex flex-col gap-[16px] overflow-y-auto">
          {/* Topic */}
          <div className="border-l-[4px] border-[var(--indigo)] bg-[var(--card2)] p-[14px] rounded-[0_12px_12px_0] flex flex-col gap-[8px]">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)]">
              Topic / Keyword Title
            </span>
            <div className="text-[14.5px] font-extrabold leading-snug text-[var(--fg)]">
              {trend.title}
            </div>
          </div>

          {/* Trend Overview */}
          <div className="flex flex-col gap-[10px]">
            <SectionHeading icon={<Flame size={11} className="text-[var(--amber)]" />}>
              Trend Overview
            </SectionHeading>
            <div className="grid grid-cols-2 gap-[12px] bg-[var(--card2)] border border-[var(--bd)] rounded-[12px] p-[14px]">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                  Source
                </span>
                <span className="text-[12px] font-semibold text-[var(--fg2)] flex items-center gap-[6px]">
                  <span
                    className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center font-mono font-extrabold text-[8px] text-white"
                    style={{ background: trend.srcColor }}
                  >
                    {trend.srcInitial}
                  </span>
                  {trend.source}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                  Category
                </span>
                <span className="text-[12px] font-semibold text-[var(--fg2)]">
                  {trend.cat}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                  Trend Score
                </span>
                <span
                  className="font-mono text-[10.5px] font-bold px-[8px] py-[2px] rounded-[6px]"
                  style={{ background: trend.scoreBg, color: trend.scoreFg }}
                >
                  {trend.score}/100
                </span>
                {Number(trend.score) < minWritingScore && (
                  <div className="text-[10px] text-[var(--amber)] mt-[4px]">
                    Below the {minWritingScore}% write threshold - approving will ask for a reason.
                  </div>
                )}
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                  Age
                </span>
                <span className="text-[11.5px] font-medium text-[var(--mut)]">
                  {age ?? trend.volume}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                  Status
                </span>
                <span className="text-[10px] font-semibold px-[7px] py-[2.5px] rounded-[6px] bg-[var(--card)] border border-[var(--bd)] text-[var(--fg2)] inline-block">
                  {trend.status ?? trend.volume.split("·")[0].trim()}
                </span>
              </div>

              {trend.rec && (
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--mut)] block mb-[4px]">
                    Recommendation
                  </span>
                  <span
                    className="text-[10.5px] font-bold px-[8px] py-[3px] rounded-[6px] inline-flex items-center gap-[4px]"
                    style={{ background: trend.recBg, color: trend.recFg }}
                  >
                    {Number(trend.score) >= 70 && <CheckCircle size={10} />}
                    {trend.rec}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Signal Breakdown - only for rows persisted after Trend.scoreBreakdown existed */}
          {hasBreakdown && breakdown && (
            <div className="flex flex-col gap-[10px]">
              <SectionHeading icon={<BarChart3 size={11} className="text-[var(--indigo)]" />}>
                Signal Breakdown
              </SectionHeading>
              <div className="bg-[var(--card2)] border border-[var(--bd)] rounded-[12px] p-[14px] flex flex-col gap-[9px]">
                {BREAKDOWN_ROWS.map((row) => {
                  const value = clampPct(Number(breakdown[row.key] ?? 0));
                  return (
                    <div key={row.key} className="flex items-center gap-[10px]">
                      <span className="text-[11px] font-medium text-[var(--fg2)] w-[138px] flex-none">
                        {row.label}
                      </span>
                      <div className="flex-1 h-[6px] rounded-[3px] bg-[var(--card)] overflow-hidden">
                        <div
                          className="h-full rounded-[3px]"
                          style={{ width: `${value}%`, background: barColor(value) }}
                        />
                      </div>
                      <span className="font-mono text-[10.5px] font-bold text-[var(--fg2)] w-[24px] text-right flex-none">
                        {value}
                      </span>
                    </div>
                  );
                })}
                <div className="border-t border-[var(--bd)] pt-[9px] mt-[2px] flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--fg)]">
                    Overall Research Score
                  </span>
                  <span
                    className="font-mono text-[11px] font-bold px-[8px] py-[2px] rounded-[6px]"
                    style={{ background: trend.scoreBg, color: trend.scoreFg }}
                  >
                    {trend.score}/100
                  </span>
                </div>
                {(breakdown.semanticRelevance ?? 0) === 0 && (
                  <div className="text-[9.5px] text-[var(--faint)] leading-snug">
                    Semantic relevance is 0 when the LLM scoring pass was skipped or unavailable for
                    this run.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Research Engine Score - the transparent 9-dimension final score, tier,
              novelty verdict and family, only for engine-produced trends. */}
          {hasEngineScore && engineScore && rd && (
            <div className="flex flex-col gap-[10px]">
              <SectionHeading icon={<BarChart3 size={11} className="text-[var(--emerald)]" />}>
                Research Engine Score
              </SectionHeading>
              <div className="bg-[var(--card2)] border border-[var(--bd)] rounded-[12px] p-[14px] flex flex-col gap-[9px]">
                {/* Tier / family / exploratory badges */}
                <div className="flex gap-[6px] flex-wrap mb-[2px]">
                  <span
                    className="text-[9.5px] font-bold px-[8px] py-[2.5px] rounded-[6px]"
                    style={{ background: tier.bg, color: tier.fg }}
                  >
                    {tier.label}
                  </span>
                  {rd.family && (
                    <span className="text-[9.5px] font-semibold px-[8px] py-[2.5px] rounded-[6px] bg-[var(--card)] border border-[var(--bd)] text-[var(--fg2)]">
                      {rd.family}
                    </span>
                  )}
                  {rd.exploratory && (
                    <span className="text-[9.5px] font-semibold px-[8px] py-[2.5px] rounded-[6px] bg-[var(--tint)] text-[var(--indigo)]">
                      Exploratory
                    </span>
                  )}
                </div>

                {ENGINE_ROWS.map((row) => {
                  const value = clampPct(Number(engineScore[row.key] ?? 0));
                  return (
                    <div key={row.key} className="flex items-center gap-[10px]">
                      <span className="text-[11px] font-medium text-[var(--fg2)] w-[138px] flex-none">
                        {row.label}
                      </span>
                      <div className="flex-1 h-[6px] rounded-[3px] bg-[var(--card)] overflow-hidden">
                        <div
                          className="h-full rounded-[3px]"
                          style={{ width: `${value}%`, background: barColor(value) }}
                        />
                      </div>
                      <span className="font-mono text-[10.5px] font-bold text-[var(--fg2)] w-[24px] text-right flex-none">
                        {value}
                      </span>
                    </div>
                  );
                })}

                <div className="border-t border-[var(--bd)] pt-[9px] mt-[2px] flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--fg)]">Final Score</span>
                  <span
                    className="font-mono text-[11px] font-bold px-[8px] py-[2px] rounded-[6px]"
                    style={{ background: trend.scoreBg, color: trend.scoreFg }}
                  >
                    {Math.round(Number(engineScore.final ?? 0))}/100
                  </span>
                </div>

                {rd.novelty?.reason && (
                  <div className="text-[9.5px] text-[var(--faint)] leading-snug">
                    Novelty: {rd.novelty.reason}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Evidence Sources - rich [S1] cards when Task 1 articles exist, else the summary's evidence lines */}
          {(articles.length > 0 || parsed.evidence.length > 0) && (
            <div className="flex flex-col gap-[10px]">
              <SectionHeading icon={<Newspaper size={11} className="text-[var(--sky)]" />}>
                Evidence Sources
              </SectionHeading>
              <div className="flex flex-col gap-[8px]">
                {articles.length > 0
                  ? articles.map((article, index) => {
                      const host = hostnameOf(article.url);
                      const fetchedAgo = formatAgoShort(article.fetchedAt);
                      return (
                        <div
                          key={`${article.url}-${index}`}
                          className="bg-[var(--card2)] border border-[var(--bd)] rounded-[12px] p-[12px] flex flex-col gap-[6px]"
                        >
                          <div className="flex items-center gap-[7px]">
                            <span className="font-mono text-[9px] font-bold px-[5px] py-[1.5px] rounded-[5px] bg-[var(--tint)] text-[var(--indigo)] flex-none">
                              S{index + 1}
                            </span>
                            <span className="text-[11.5px] font-bold text-[var(--fg)] truncate">
                              {host ?? article.title}
                            </span>
                            {article.url && (
                              <a
                                href={article.url}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-auto text-[9.5px] font-semibold px-[7px] py-[2.5px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--indigo)] hover:border-[var(--indigo)] flex items-center gap-[3px] flex-none transition-colors"
                              >
                                Open Source <ExternalLink size={9} />
                              </a>
                            )}
                          </div>
                          {article.title && (
                            <div className="text-[11px] font-semibold text-[var(--fg2)] leading-snug">
                              {article.title}
                            </div>
                          )}
                          {article.excerpt && (
                            <div className="text-[10.5px] italic text-[var(--mut)] leading-snug">
                              &ldquo;{article.excerpt.slice(0, 180)}
                              {article.excerpt.length > 180 ? "…" : ""}&rdquo;
                            </div>
                          )}
                          <div className="text-[9.5px] font-medium text-[var(--emerald)] flex items-center gap-[4px]">
                            <CheckCircle size={9} />
                            Fetched · {article.chars.toLocaleString()} chars
                            {fetchedAgo ? ` · ${fetchedAgo}` : ""}
                            {article.extractor ? ` · ${article.extractor}` : ""}
                          </div>
                        </div>
                      );
                    })
                  : parsed.evidence.map((line, index) => (
                      <div
                        key={`${line.title}-${index}`}
                        className="bg-[var(--card2)] border border-[var(--bd)] rounded-[10px] p-[10px_12px] flex items-center gap-[8px]"
                      >
                        <span className="font-mono text-[9px] font-bold px-[5px] py-[1.5px] rounded-[5px] bg-[var(--card)] border border-[var(--bd)] text-[var(--mut)] flex-none">
                          S{index + 1}
                        </span>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--mut)] block">
                            {line.source}
                          </span>
                          <span className="text-[11px] font-medium text-[var(--fg2)] leading-snug">
                            {line.title}
                          </span>
                        </div>
                        {line.url && (
                          <a
                            href={line.url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-[9.5px] font-semibold px-[7px] py-[2.5px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--indigo)] hover:border-[var(--indigo)] flex items-center gap-[3px] flex-none transition-colors"
                          >
                            {hostnameOf(line.url) ?? "Open"} <ExternalLink size={9} />
                          </a>
                        )}
                      </div>
                    ))}
              </div>
            </div>
          )}

          {/* Research Summary - the reason the pipeline promoted this signal + keywords */}
          {(parsed.summary || parsed.keywords.length > 0) && (
            <div className="flex flex-col gap-[10px]">
              <SectionHeading icon={<Search size={11} className="text-[var(--emerald)]" />}>
                Research Summary
              </SectionHeading>
              <div className="bg-[var(--card2)] border border-[var(--bd)] rounded-[12px] p-[14px] flex flex-col gap-[10px]">
                {parsed.summary && (
                  <p className="margin-0 text-[11.5px] text-[var(--fg2)] leading-relaxed">
                    {parsed.summary}
                  </p>
                )}
                {parsed.keywords.length > 0 && (
                  <div className="flex gap-[5px] flex-wrap">
                    {parsed.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="text-[9.5px] font-semibold px-[7px] py-[2px] rounded-[6px] bg-[var(--card)] border border-[var(--bd)] text-[var(--mut)]"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Research Warnings */}
          <div className="flex flex-col gap-[10px]">
            <SectionHeading icon={<AlertTriangle size={11} className="text-[var(--amber)]" />}>
              Research Warnings
            </SectionHeading>
            {warnings.length > 0 ? (
              <div className="rounded-[12px] border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] p-[12px_14px] flex flex-col gap-[6px]">
                {warnings.map((warning) => (
                  <div
                    key={warning}
                    className="text-[11px] text-[var(--amber)] font-medium flex items-start gap-[7px]"
                  >
                    <span className="mt-[1px] flex-none">•</span>
                    {warning}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[12px] border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.06)] p-[10px_14px] text-[11px] text-[var(--emerald)] font-medium flex items-center gap-[6px]">
                <CheckCircle size={11} /> No research warnings - signal looks healthy.
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-[12px_16px] border-t border-[var(--bd)] flex items-center justify-between gap-[8px] bg-[var(--card2)] flex-none">
          {/* Delete Action (Left Aligned) */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onDelete(trend);
            }}
            className="h-[32px] px-[12px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--rose)] hover:bg-[rgba(244,63,94,0.06)] hover:border-[var(--rose)] text-[12px] font-semibold flex items-center gap-[5px] transition-colors"
          >
            <Trash2 size={13} />
            Delete
          </button>

          {/* Right Aligned CTA Buttons */}
          <div className="flex gap-[8px]">
            <button
              type="button"
              onClick={() => {
                onClose();
                onSkip(trend);
              }}
              className="h-[32px] px-[14px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[12px] font-semibold hover:border-[var(--bd2)] transition-colors"
            >
              Skip Topic
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onApprove(trend);
              }}
              className="h-[32px] px-[14px] rounded-[8px] border border-transparent bg-[var(--emerald)] text-white text-[12px] font-bold hover:bg-[#059669] shadow-sm flex items-center gap-[5px] transition-colors"
            >
              <CheckCircle size={13} />
              Approve Pipeline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
