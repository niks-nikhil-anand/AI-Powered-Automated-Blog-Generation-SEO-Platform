import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

const TECHCRUNCH_RSS = "https://feed.techcrunch.com/";

type ParsedItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  "content:encoded"?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => name === "item",
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export async function fetchTechCrunchSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  try {
    const res = await fetchWithRetry(TECHCRUNCH_RSS, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoBlogResearchBot/1.0)" },
    });

    if (!res.ok) {
      throw new Error(`TechCrunch fetch failed: ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml) as { rss?: { channel?: { item?: ParsedItem[] } } };
    const items = toArray(parsed?.rss?.channel?.item);

    for (const item of items.slice(0, researchConfig.maxSignalsPerSource)) {
      if (!item.title || !item.link) continue;

      const keywords = ["AI", "startup", "funding", "tech", "developer", "API"];
      const hasRelevant = keywords.some((kw) =>
        item.title!.toLowerCase().includes(kw.toLowerCase()) ||
        item.description?.toLowerCase().includes(kw.toLowerCase())
      );

      if (hasRelevant) {
        signals.push({
          title: item.title,
          url: item.link,
          source: "techcrunch",
          snippet: item.description || "",
          timestamp: new Date(item.pubDate || Date.now()).toISOString(),
        });
      }
    }
  } catch (error) {
    console.error("TechCrunch fetch error:", error);
  }

  return signals;
}

export const techcrunchSource: ResearchSource = {
  name: "techcrunch",
  displayName: "TechCrunch",
  fetch: fetchTechCrunchSignals,
};
