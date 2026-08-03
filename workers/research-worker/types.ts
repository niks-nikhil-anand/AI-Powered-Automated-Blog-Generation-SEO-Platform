export type ResearchSourceName =
  | "google_trends"
  | "google_news"
  | "github_trending"
  | "techcrunch"
  | "the_verge"
  | "google_ai_blog"
  | "openai_news"
  | "anthropic_news"
  | "microsoft_ai_blog"
  | "nvidia_blog"
  | "hackernews";

export type RawSignal = {
  source: ResearchSourceName;
  title: string;
  url?: string;
  description?: string;
  snippet?: string;
  publishedAt?: Date;
  timestamp?: string;
  volume?: number;
  engagement?: number;
  tags?: string[];
  raw?: unknown;
};

export type NormalizedSignal = RawSignal & {
  normalizedTitle: string;
  slug: string;
  keywords: string[];
  category: string;
  fingerprint: string;
};

export type ResearchCandidate = {
  title: string;
  slug: string;
  category: string;
  score: number;
  priority: "high" | "medium" | "low";
  reason: string;
  keywords: string[];
  evidence: NormalizedSignal[];
  scoreBreakdown: {
    trendDemand: number;
    newsFreshness: number;
    githubMomentum: number;
    multiSourceValidation: number;
  };
};

export type ResearchSource = {
  name: ResearchSourceName;
  displayName?: string;
  fetch?: () => Promise<RawSignal[]>;
  fetchSignals?: () => Promise<RawSignal[]>;
};
