import { ResearchCandidate } from "../types";
import { SignalCluster } from "./dedupe";

const SOURCE_REASON = {
  google_trends: "Trending in Google Search",
  google_news: "Validated by recent Google News coverage",
  github_trending: "Showing GitHub repository momentum",
  hackernews: "Discussion on Hacker News",
  techcrunch: "Covered by TechCrunch",
  the_verge: "Covered by The Verge",
  google_ai_blog: "Featured on Google AI Blog",
  openai_news: "Featured on OpenAI News",
  anthropic_news: "Featured on Anthropic News",
  microsoft_ai_blog: "Featured on Microsoft AI Blog",
  nvidia_blog: "Featured on NVIDIA Developer Blog",
} as const;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function freshnessScore(date?: Date): number {
  if (!date || Number.isNaN(date.getTime())) return 0;
  const ageHours = Math.max(0, (Date.now() - date.getTime()) / 36e5);
  if (ageHours <= 24) return 100;
  if (ageHours <= 72) return 80;
  if (ageHours <= 168) return 55;
  return 20;
}

export function scoreCluster(cluster: SignalCluster): ResearchCandidate {
  const evidence = cluster.signals;
  const sourceNames = new Set(evidence.map((signal) => signal.source));
  const bestTrendVolume = Math.max(0, ...evidence.map((signal) => signal.volume ?? 0));
  const bestGitHubEngagement = Math.max(
    0,
    ...evidence
      .filter((signal) => signal.source === "github_trending")
      .map((signal) => signal.engagement ?? 0)
  );
  const bestNewsFreshness = Math.max(
    0,
    ...evidence
      .filter((signal) => signal.source === "google_news")
      .map((signal) => freshnessScore(signal.publishedAt))
  );

  const trendDemand = clampScore(bestTrendVolume > 0 ? Math.log10(bestTrendVolume + 1) * 20 : 0);
  const newsFreshness = clampScore(bestNewsFreshness);
  const githubMomentum = clampScore(bestGitHubEngagement > 0 ? Math.log10(bestGitHubEngagement + 1) * 18 : 0);
  const multiSourceValidation = clampScore((sourceNames.size / 3) * 100);

  const sourceScores = [trendDemand, newsFreshness, githubMomentum].filter((value) => value > 0);
  const strongestSourceScore = Math.max(0, ...sourceScores);
  const score = clampScore(
    strongestSourceScore * 0.7 +
      average(sourceScores) * 0.2 +
      multiSourceValidation * 0.1
  );

  const bestSignal = [...evidence].sort((a, b) => {
    const aWeight = (a.volume ?? 0) + (a.engagement ?? 0);
    const bWeight = (b.volume ?? 0) + (b.engagement ?? 0);
    return bWeight - aWeight;
  })[0];
  const keywords = Array.from(new Set(evidence.flatMap((signal) => signal.keywords))).slice(0, 12);
  const reasons = Array.from(sourceNames).map((source) => SOURCE_REASON[source]);

  return {
    title: bestSignal.title,
    slug: bestSignal.slug,
    category: bestSignal.category,
    score,
    priority: score >= 85 ? "high" : score >= 70 ? "medium" : "low",
    reason: reasons.join("; ") || "Research signal detected",
    keywords,
    evidence,
    scoreBreakdown: {
      trendDemand,
      newsFreshness,
      githubMomentum,
      multiSourceValidation,
    },
  };
}

export function scoreClusters(clusters: SignalCluster[]): ResearchCandidate[] {
  return clusters.map(scoreCluster).sort((a, b) => b.score - a.score);
}
