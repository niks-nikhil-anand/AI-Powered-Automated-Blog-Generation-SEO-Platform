import { XMLParser } from "fast-xml-parser";
import { researchConfig } from "../config";
import { RawSignal, ResearchSource } from "../types";
import { fetchWithRetry } from "../utils/fetch-with-retry";

type ParsedItem = {
  title?: string;
  link?: string;
  summary?: string;
  published?: string;
  author?: { name?: string };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => name === "entry",
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export async function fetchGoogleAIBlogSignals(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  try {
    const res = await fetchWithRetry(researchConfig.sourceUrls.googleAiBlog);

    if (!res.ok) {
      throw new Error(`Google AI Blog fetch failed: ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml) as { feed?: { entry?: ParsedItem[] } };
    const items = toArray(parsed?.feed?.entry);

    for (const item of items.slice(0, researchConfig.maxSignalsPerSource)) {
      if (!item.title || !item.link) continue;

      signals.push({
        title: typeof item.title === "string" ? item.title : item.title?.["#text"] || "",
        url: typeof item.link === "string" ? item.link : (item.link as any)?.href || "",
        source: "google_ai_blog",
        snippet: typeof item.summary === "string" ? item.summary : "",
        timestamp: item.published || new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Google AI Blog fetch error:", error);
  }

  return signals;
}

export const googleAIBlogSource: ResearchSource = {
  name: "google_ai_blog",
  displayName: "Google AI Blog",
  fetch: fetchGoogleAIBlogSignals,
};
