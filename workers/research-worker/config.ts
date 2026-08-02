import { env } from "../shared/env";
import { ResearchSourceName } from "./types";

export const researchConfig = {
  enabledSources: ["google_trends", "google_news", "github_trending"] as ResearchSourceName[],
  region: env.GOOGLE_TRENDS_GEO,
  language: "en",
  maxSignalsPerSource: env.RESEARCH_MAX_SIGNALS_PER_SOURCE,
  minScoreToPromote: env.RESEARCH_MIN_SCORE_TO_PROMOTE,
  recentDuplicateDays: env.RESEARCH_RECENT_DUPLICATE_DAYS,
  newsQuery: env.RESEARCH_GOOGLE_NEWS_QUERY,
  githubQueries: env.RESEARCH_GITHUB_QUERIES,
  categories: [
    "AI",
    "Web Development",
    "Backend",
    "DevOps",
    "Databases",
    "Open Source",
    "General",
  ],
};
