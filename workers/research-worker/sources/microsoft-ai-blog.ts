import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

const MICROSOFT_AI_RSS = "https://www.microsoft.com/en-us/research/feed/";

type ParsedItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  "content:encoded"?: string;
  category?: string | string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => name === "item" || name === "category",
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export async function fetchMicrosoftAIBlogSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  try {
    const res = await fetchWithRetry(MICROSOFT_AI_RSS, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoBlogResearchBot/1.0)" },
    });

    if (!res.ok) {
      throw new Error(`Microsoft AI Blog fetch failed: ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml) as { rss?: { channel?: { item?: ParsedItem[] } } };
    const items = toArray(parsed?.rss?.channel?.item);

    for (const item of items.slice(0, researchConfig.maxSignalsPerSource)) {
      if (!item.title || !item.link) continue;

      const categories = toArray(item.category);
      const isAIRelated =
        item.title.toLowerCase().includes("ai") ||
        item.description?.toLowerCase().includes("ai") ||
        categories.some((cat) => typeof cat === "string" && cat.toLowerCase().includes("ai"));

      if (isAIRelated) {
        signals.push({
          title: item.title,
          url: item.link,
          source: "microsoft-ai-blog",
          snippet: item.description || item["content:encoded"] || "",
          timestamp: new Date(item.pubDate || Date.now()).toISOString(),
        });
      }
    }
  } catch (error) {
    console.error("Microsoft AI Blog fetch error:", error);
  }

  return signals;
}

export const microsoftAIBlogSource: ResearchSource = {
  name: "microsoft_ai_blog",
  displayName: "Microsoft AI Blog",
  fetch: fetchMicrosoftAIBlogSignals,
};
