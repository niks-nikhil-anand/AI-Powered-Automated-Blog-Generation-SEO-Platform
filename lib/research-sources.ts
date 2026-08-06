import type { ResearchSourceName } from "@/workers/research-worker/types";

/**
 * Single source of truth for every research platform's display metadata -
 * used by app/api/dashboard/route.ts (to label Trend rows) and
 * app/dashboard/trends/page.tsx (to build the source filter chips). Before
 * this, both places hand-maintained their own 3-source list (Google Trends,
 * Google News, GitHub Trending) even though workers/research-worker/config.ts
 * has run 11 sources for a while - the other 8 (TechCrunch, The Verge,
 * Google AI Blog, OpenAI News, Anthropic News, Microsoft AI Blog, NVIDIA
 * Blog, Hacker News) had no filter chip and fell back to whatever raw
 * "techcrunch"-style string research-worker happened to store.
 *
 * Order matters: Trend.source can be a comma-joined list of every signal
 * source that fed a cluster (e.g. "techcrunch,hackernews"), and the label/
 * initial/color helpers below pick the first match in this order - same
 * "one label wins" behavior the original 3-source version already had.
 */
export const RESEARCH_SOURCE_ORDER: ResearchSourceName[] = [
  "google_trends",
  "google_news",
  "github_trending",
  "techcrunch",
  "the_verge",
  "google_ai_blog",
  "openai_news",
  "anthropic_news",
  "microsoft_ai_blog",
  "nvidia_blog",
  "hackernews",
];

export const RESEARCH_SOURCE_META: Record<
  ResearchSourceName,
  { label: string; initial: string; color: string }
> = {
  google_trends: { label: "Google Trends", initial: "GT", color: "var(--indigo)" },
  google_news: { label: "Google News", initial: "GN", color: "var(--emerald)" },
  github_trending: { label: "GitHub Trending", initial: "GH", color: "#171717" },
  techcrunch: { label: "TechCrunch", initial: "TC", color: "var(--rose)" },
  the_verge: { label: "The Verge", initial: "TV", color: "var(--sky)" },
  google_ai_blog: { label: "Google AI Blog", initial: "GA", color: "var(--indigo)" },
  openai_news: { label: "OpenAI News", initial: "OA", color: "var(--emerald)" },
  anthropic_news: { label: "Anthropic News", initial: "AN", color: "var(--amber)" },
  microsoft_ai_blog: { label: "Microsoft AI Blog", initial: "MS", color: "var(--sky)" },
  nvidia_blog: { label: "NVIDIA Blog", initial: "NV", color: "#76b900" },
  hackernews: { label: "Hacker News", initial: "HN", color: "#ff6600" },
};

function firstMatch(rawSource: string): ResearchSourceName | null {
  return RESEARCH_SOURCE_ORDER.find((name) => rawSource.includes(name)) ?? null;
}

export function trendSourceLabel(rawSource: string): string {
  const match = firstMatch(rawSource);
  return match ? RESEARCH_SOURCE_META[match].label : rawSource;
}

export function trendSourceInitial(rawSource: string): string {
  const match = firstMatch(rawSource);
  return match ? RESEARCH_SOURCE_META[match].initial : rawSource.slice(0, 2).toUpperCase();
}

export function trendSourceColor(rawSource: string): string {
  const match = firstMatch(rawSource);
  return match ? RESEARCH_SOURCE_META[match].color : "var(--mut)";
}
