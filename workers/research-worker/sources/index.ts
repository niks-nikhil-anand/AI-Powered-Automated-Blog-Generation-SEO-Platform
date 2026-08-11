import { researchConfig } from "../config";
import { ResearchSource } from "../types";
import { githubTrendingSource } from "./github-trending";
import { googleNewsSource } from "./google-news";
import { googleTrendsSource } from "./google-trends";
import { techcrunchSource } from "./techcrunch";
import { vergeSource } from "./the-verge";
import { googleAIBlogSource } from "./google-ai-blog";
import { openaiNewsSource } from "./openai-news";
import { anthropicNewsSource } from "./anthropic-news";
import { microsoftAIBlogSource } from "./microsoft-ai-blog";
import { nvidiaBlogSource } from "./nvidia-blog";
import { hackerNewsSource } from "./hackernews";
import { searxngSource } from "../searxng/source";

const allSources: ResearchSource[] = [
  googleTrendsSource,
  googleNewsSource,
  githubTrendingSource,
  techcrunchSource,
  vergeSource,
  googleAIBlogSource,
  openaiNewsSource,
  anthropicNewsSource,
  microsoftAIBlogSource,
  nvidiaBlogSource,
  hackerNewsSource,
  // SearXNG discovery is additive and only present in the enabled set when
  // SEARXNG_ENABLED && ENABLE_SEARXNG (see config.ts) - off by default, so the
  // legacy source list is unchanged unless both flags are flipped on.
  searxngSource,
];

export function getEnabledSources(): ResearchSource[] {
  return allSources.filter((source) => researchConfig.enabledSources.includes(source.name));
}
