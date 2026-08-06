import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

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

/**
 * ENABLE_TECHCRUNCH is one flag, but there are two configured feeds
 * (TECHCRUNCH_AI_RSS, TECHCRUNCH_STARTUPS_RSS) - fetches both and merges
 * rather than adding a second ResearchSourceName, since both feeds are
 * still conceptually "techcrunch" for scoring/dedupe purposes downstream.
 */
async function fetchFeed(url: string): Promise<ParsedItem[]> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TechCrunch fetch failed (${url}): ${res.status}`);
  const xml = await res.text();
  const parsed = parser.parse(xml) as { rss?: { channel?: { item?: ParsedItem[] } } };
  return toArray(parsed?.rss?.channel?.item);
}

export async function fetchTechCrunchSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  try {
    const feeds = await Promise.allSettled([
      fetchFeed(researchConfig.sourceUrls.techcrunchAi),
      fetchFeed(researchConfig.sourceUrls.techcrunchStartups),
    ]);

    const byUrl = new Map<string, ParsedItem>();
    for (const feed of feeds) {
      if (feed.status !== "fulfilled") {
        console.error("TechCrunch feed error:", feed.reason);
        continue;
      }
      for (const item of feed.value) {
        if (item.link && !byUrl.has(item.link)) byUrl.set(item.link, item);
      }
    }

    for (const item of Array.from(byUrl.values()).slice(0, researchConfig.maxSignalsPerSource)) {
      if (!item.title || !item.link) continue;

      signals.push({
        title: item.title,
        url: item.link,
        source: "techcrunch",
        snippet: item.description || "",
        timestamp: new Date(item.pubDate || Date.now()).toISOString(),
      });
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
