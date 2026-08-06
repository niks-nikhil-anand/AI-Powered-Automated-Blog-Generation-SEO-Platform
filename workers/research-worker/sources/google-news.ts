import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

const NEWS_RSS_URL = "https://news.google.com/rss/search";

type ParsedNewsItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  source?: string | { "#text"?: string };
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

function sourceName(source: ParsedNewsItem["source"]): string | undefined {
  if (typeof source === "string") return source;
  return source?.["#text"];
}

export async function fetchGoogleNewsSignals(): Promise<RawSignal[]> {
  const params = new URLSearchParams({
    q: researchConfig.newsQuery,
    hl: `${researchConfig.newsLanguage}-${researchConfig.newsCountry}`,
    gl: researchConfig.newsCountry,
    ceid: `${researchConfig.newsCountry}:${researchConfig.newsLanguage}`,
  });
  const res = await fetchWithRetry(`${NEWS_RSS_URL}?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`Google News fetch failed: ${res.status} ${res.statusText}`);
  }

  const parsed = parser.parse(await res.text()) as {
    rss?: { channel?: { item?: ParsedNewsItem[] } };
  };
  const items = toArray(parsed.rss?.channel?.item).slice(0, researchConfig.maxSignalsPerSource);

  return items
    .map((item) => ({
      source: "google_news" as const,
      title: String(item.title ?? "").trim(),
      url: item.link,
      description: String(item.description ?? sourceName(item.source) ?? "").trim(),
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      engagement: 1,
      tags: ["news", sourceName(item.source)].filter(Boolean) as string[],
      raw: item,
    }))
    .filter((signal) => signal.title.length > 0);
}

export const googleNewsSource: ResearchSource = {
  name: "google_news",
  fetchSignals: fetchGoogleNewsSignals,
};
