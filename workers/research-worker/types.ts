export type ResearchSourceName = "google_trends" | "google_news" | "github_trending";

export type RawSignal = {
  source: ResearchSourceName;
  title: string;
  url?: string;
  description?: string;
  publishedAt?: Date;
  volume?: number;
  engagement?: number;
  tags?: string[];
  raw: unknown;
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
  fetchSignals: () => Promise<RawSignal[]>;
};
