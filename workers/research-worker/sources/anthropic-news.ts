import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

// Anthropic research blog RSS feed
const ANTHROPIC_RSS = "https://www.anthropic.com/research/rss.xml";

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

export async function fetchAnthropicNewsSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  try {
    const res = await fetchWithRetry(ANTHROPIC_RSS, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoBlogResearchBot/1.0)" },
    });

    if (!res.ok) {
      throw new Error(`Anthropic News fetch failed: ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml) as { rss?: { channel?: { item?: ParsedItem[] } } };
    const items = toArray(parsed?.rss?.channel?.item);

    for (const item of items.slice(0, researchConfig.maxSignalsPerSource)) {
      if (!item.title || !item.link) continue;

      signals.push({
        title: item.title,
        url: item.link,
        source: "anthropic_news",
        snippet: item.description || item["content:encoded"] || "",
        timestamp: new Date(item.pubDate || Date.now()).toISOString(),
      });
    }
  } catch (error) {
    console.error("Anthropic News fetch error:", error);
  }

  return signals;
}

export const anthropicNewsSource: ResearchSource = {
  name: "anthropic_news",
  displayName: "Anthropic News",
  fetch: fetchAnthropicNewsSignals,
};
