import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

type ParsedItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
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

export async function fetchVergeSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  try {
    const res = await fetchWithRetry(researchConfig.sourceUrls.theVergeAi);

    if (!res.ok) {
      throw new Error(`The Verge fetch failed: ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml) as { rss?: { channel?: { item?: ParsedItem[] } } };
    const items = toArray(parsed?.rss?.channel?.item);

    for (const item of items.slice(0, researchConfig.maxSignalsPerSource)) {
      if (!item.title || !item.link) continue;

      const categories = toArray(item.category);
      const techCategories = ["AI", "tech", "gadgets", "apps", "reviews"];
      const isRelevant =
        techCategories.some((cat) =>
          item.title!.toLowerCase().includes(cat.toLowerCase()) ||
          item.description?.toLowerCase().includes(cat.toLowerCase())
        ) ||
        categories.some((cat) =>
          typeof cat === "string" && techCategories.some((tc) => cat.toLowerCase().includes(tc.toLowerCase()))
        );

      if (isRelevant) {
        signals.push({
          title: item.title,
          url: item.link,
          source: "the_verge",
          snippet: item.description || "",
          timestamp: new Date(item.pubDate || Date.now()).toISOString(),
        });
      }
    }
  } catch (error) {
    console.error("The Verge fetch error:", error);
  }

  return signals;
}

export const vergeSource: ResearchSource = {
  name: "the_verge",
  displayName: "The Verge",
  fetch: fetchVergeSignals,
};
