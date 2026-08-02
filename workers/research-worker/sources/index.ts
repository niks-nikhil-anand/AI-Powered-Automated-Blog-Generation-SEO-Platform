import { researchConfig } from "../config";
import { ResearchSource } from "../types";
import { githubTrendingSource } from "./github-trending";
import { googleNewsSource } from "./google-news";
import { googleTrendsSource } from "./google-trends";

const allSources: ResearchSource[] = [
  googleTrendsSource,
  googleNewsSource,
  githubTrendingSource,
];

export function getEnabledSources(): ResearchSource[] {
  return allSources.filter((source) => researchConfig.enabledSources.includes(source.name));
}
