import { XMLParser } from "fast-xml-parser";
import { env } from "../shared/env";

/**
 * Google Trends "Daily Search Trends" feed - the only Google Trends feed
 * still published as XML (their realtime JSON feed was retired). Format:
 *
 * <rss xmlns:ht="https://trends.google.com/trends/trendingsearches/daily">
 *   <channel>
 *     <item>
 *       <title>topic</title>
 *       <ht:approx_traffic>200,000+</ht:approx_traffic>
 *       <ht:news_item>
 *         <ht:news_item_title>...</ht:news_item_title>
 *         <ht:news_item_snippet>...</ht:news_item_snippet>
 *         <ht:news_item_url>...</ht:news_item_url>
 *       </ht:news_item>
 *       ...
 *     </item>
 *   </channel>
 * </rss>
 */
const TRENDS_RSS_URL = "https://trends.google.com/trends/trendingsearches/daily/rss";

export type GoogleTrendItem = {
  topic: string;
  description: string;
  approxTraffic: number;
  link: string;
  newsUrls: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true, // "ht:approx_traffic" -> "approx_traffic"
  isArray: (name) => name === "item" || name === "news_item",
});

/** Parses "200,000+" / "50,000" -> 200000 / 50000. */
function parseApproxTraffic(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseGoogleTrendsXml(xml: string): GoogleTrendItem[] {
  const parsed = parser.parse(xml);
  const items = toArray(parsed?.rss?.channel?.item);

  return items.map((item: any) => {
    const newsItems = toArray(item.news_item);
    return {
      topic: String(item.title ?? "").trim(),
      description: String(newsItems[0]?.news_item_snippet ?? item.description ?? "").trim(),
      approxTraffic: parseApproxTraffic(item.approx_traffic),
      link: String(item.link ?? ""),
      newsUrls: newsItems.map((n: any) => String(n.news_item_url ?? "")).filter(Boolean),
    };
  });
}

export async function fetchGoogleTrends(geo: string = env.GOOGLE_TRENDS_GEO): Promise<GoogleTrendItem[]> {
  const url = `${TRENDS_RSS_URL}?geo=${encodeURIComponent(geo)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DevKitMarketBot/1.0)" },
  });

  if (!res.ok) {
    throw new Error(`Google Trends fetch failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  return parseGoogleTrendsXml(xml);
}

/**
 * Normalizes raw feed items into a 0-100 trend score, scaled relative to
 * the highest-traffic topic in this batch (the feed itself is already
 * ranked, so this is a same-day relative score, not an absolute one).
 * Deduplicates by lower-cased topic text.
 */
export function scoreAndDedupe(items: GoogleTrendItem[]): (GoogleTrendItem & { score: number })[] {
  const maxTraffic = Math.max(1, ...items.map((i) => i.approxTraffic));
  const seen = new Set<string>();
  const scored: (GoogleTrendItem & { score: number })[] = [];

  for (const item of items) {
    const key = item.topic.toLowerCase();
    if (!item.topic || seen.has(key)) continue;
    seen.add(key);
    const score = Math.round((item.approxTraffic / maxTraffic) * 100);
    scored.push({ ...item, score: Math.max(1, score) });
  }

  return scored.sort((a, b) => b.score - a.score);
}
