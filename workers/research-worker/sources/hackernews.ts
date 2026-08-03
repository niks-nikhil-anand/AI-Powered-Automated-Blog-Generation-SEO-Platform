import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";
const HN_TOP_STORIES = `${HN_API_BASE}/topstories.json`;
const HN_ITEM = (id: number) => `${HN_API_BASE}/item/${id}.json`;

type HNItem = {
  id: number;
  type: string;
  title?: string;
  url?: string;
  text?: string;
  score: number;
  time: number;
  kids?: number[];
};

const TECH_KEYWORDS = [
  "AI",
  "machine learning",
  "LLM",
  "GPT",
  "neural",
  "deep learning",
  "API",
  "framework",
  "tool",
  "library",
  "open source",
  "JavaScript",
  "TypeScript",
  "Python",
  "Rust",
  "Go",
  "developer",
];

function isRelevant(item: HNItem): boolean {
  const title = (item.title || "").toLowerCase();
  const text = (item.text || "").toLowerCase();
  return TECH_KEYWORDS.some((kw) => title.includes(kw.toLowerCase()) || text.includes(kw.toLowerCase()));
}

export async function fetchHackerNewsSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  try {
    // Fetch top story IDs
    const res = await fetchWithRetry(HN_TOP_STORIES);
    if (!res.ok) throw new Error(`HN top stories fetch failed: ${res.status}`);

    const storyIds = (await res.json()) as number[];
    const topStories = storyIds.slice(0, Math.min(50, researchConfig.maxSignalsPerSource * 3));

    // Fetch story details in parallel (with rate limiting)
    for (const id of topStories) {
      if (signals.length >= researchConfig.maxSignalsPerSource) break;

      try {
        const itemRes = await fetchWithRetry(HN_ITEM(id));
        if (!itemRes.ok) continue;

        const item = (await itemRes.json()) as HNItem;

        // Only include story/poll types, skip comments
        if (item.type !== "story" && item.type !== "poll") continue;

        // Filter for tech/dev relevant content
        if (!isRelevant(item)) continue;

        // Only include items with meaningful score
        if (item.score < 10) continue;

        signals.push({
          title: item.title || "Untitled",
          url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
          source: "hackernews",
          snippet: `${item.score} points · ${item.kids?.length ?? 0} comments`,
          timestamp: new Date(item.time * 1000).toISOString(),
        });
      } catch (error) {
        // Continue on individual item fetch failure
        continue;
      }
    }
  } catch (error) {
    console.error("Hacker News fetch error:", error);
  }

  return signals;
}

export const hackerNewsSource: ResearchSource = {
  name: "hackernews",
  displayName: "Hacker News",
  fetch: fetchHackerNewsSignals,
};
