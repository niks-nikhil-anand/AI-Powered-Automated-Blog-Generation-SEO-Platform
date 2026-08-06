import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

const TRENDS_RSS_URLS = [
  "https://trends.google.com/trending/rss",
  "https://trends.google.com/trends/trendingsearches/daily/rss",
];

type ParsedTrendItem = {
  title?: string;
  link?: string;
  description?: string;
  approx_traffic?: string;
  news_item?: ParsedTrendNewsItem | ParsedTrendNewsItem[];
};

type ParsedTrendNewsItem = {
  news_item_title?: string;
  news_item_snippet?: string;
  news_item_url?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => name === "item" || name === "news_item",
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseTraffic(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}

export async function fetchGoogleTrendSignals(): Promise<RawSignal[]> {
  let lastError = "";
  let xml = "";

  for (const baseUrl of TRENDS_RSS_URLS) {
    const url = `${baseUrl}?geo=${encodeURIComponent(researchConfig.region)}`;
    const res = await fetchWithRetry(url);

    if (res.ok) {
      xml = await res.text();
      break;
    }

    lastError = `${res.status} ${res.statusText}`;
  }

  if (!xml) {
    throw new Error(`Google Trends fetch failed: ${lastError}`);
  }

  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: ParsedTrendItem[] } };
  };
  const items = toArray(parsed.rss?.channel?.item).slice(0, researchConfig.maxSignalsPerSource);

  return items
    .map((item) => {
      const news = toArray(item.news_item);
      return {
        source: "google_trends" as const,
        title: String(item.title ?? "").trim(),
        url: item.link,
        description: String(news[0]?.news_item_snippet ?? item.description ?? "").trim(),
        volume: parseTraffic(item.approx_traffic),
        tags: ["trend"],
        raw: item,
      };
    })
    .filter((signal) => signal.title.length > 0);
}

export const googleTrendsSource: ResearchSource = {
  name: "google_trends",
  fetchSignals: fetchGoogleTrendSignals,
};
