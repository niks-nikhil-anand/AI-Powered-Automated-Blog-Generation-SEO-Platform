import { env } from "../../shared/env";
import { type EvidenceArticle } from "../../shared/evidence";
import { logger } from "../../shared/logger";
import { fetchWithRetry } from "../utils/fetch-with-retry";
import type { NormalizedSignal, ResearchCandidate } from "../types";

const log = logger.child({ worker: "research-worker", stage: "evidence" });

/**
 * Full-text evidence ingestion (ENHANCEMENT_IMPLEMENTATION_PLAN.md Task 1).
 *
 * Until now every downstream stage grounded on Trend.evidenceSummary - a
 * text blob of source *titles and URLs* only (see candidateDescription() in
 * research-worker/index.ts). This module fetches the actual articles behind
 * the top evidence URLs so planning/writing/fact-check can work from real
 * source text instead of headlines.
 *
 * Extraction is a zero-dependency text-density extractor (not Readability):
 * the output only needs to be clean enough for LLM grounding, and avoiding
 * jsdom-class native/DOM dependencies keeps the worker images and local
 * tsx runs dependency-stable. The `extractor` field on each stored article
 * records what produced it so a future Readability upgrade is
 * distinguishable in the data. The EvidenceArticle type itself lives in
 * workers/shared/evidence.ts - see that file for why.
 */
export type { EvidenceArticle } from "../../shared/evidence";

/** Minimum cleaned body size - below this a page is a paywall/JS wall/bot block, not evidence. */
const MIN_ARTICLE_CHARS = 200;

/** Tag blocks removed wholesale before text extraction - boilerplate that never contains article body. */
const DROP_BLOCK_RE =
  /<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|figure|figcaption|button|select|dialog)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1].trim());
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title?.[1] ? stripTags(title[1]) : "";
}

/**
 * Text-density extraction: pull every <p> block, keep the ones that look
 * like prose (>= 40 cleaned chars), join in document order. On news/blog
 * pages the article body dominates the <p> population, so this captures the
 * body without the nav/sidebar chrome those pages put in divs/lists.
 */
function extractBody(html: string, maxChars: number): string {
  const withoutBoilerplate = html.replace(DROP_BLOCK_RE, " ");
  const paragraphs: string[] = [];
  const paragraphRe = /<p[^>]*>([\s\S]*?)<\/\s*p\s*>/gi;
  let match: RegExpExecArray | null;
  let total = 0;

  while ((match = paragraphRe.exec(withoutBoilerplate)) !== null) {
    const text = stripTags(match[1]);
    if (text.length < 40) continue;
    if (total + text.length > maxChars) {
      const remaining = maxChars - total;
      if (remaining >= MIN_ARTICLE_CHARS) paragraphs.push(text.slice(0, remaining));
      total += remaining;
      break;
    }
    paragraphs.push(text);
    total += text.length;
    if (total >= maxChars) break;
  }

  return paragraphs.join("\n\n");
}

/** Naive registrable domain (last two labels) - good enough for diversity selection, not a PSL implementation. */
function registrableDomain(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, "").split(".");
    return parts.slice(-2).join(".");
  } catch {
    return url;
  }
}

/**
 * Up to EVIDENCE_MAX_ARTICLES URLs from the candidate's evidence, one per
 * registrable domain (domain diversity beats "first N" - corroboration
 * across outlets is the accuracy signal, not five links from one site).
 */
function selectUrls(evidence: NormalizedSignal[]): { url: string; title: string }[] {
  const seenDomains = new Set<string>();
  const selected: { url: string; title: string }[] = [];

  for (const signal of evidence) {
    if (!signal.url) continue;
    const domain = registrableDomain(signal.url);
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    selected.push({ url: signal.url, title: signal.title });
    if (selected.length >= env.EVIDENCE_MAX_ARTICLES) break;
  }

  return selected;
}

async function fetchOne(url: string, fallbackTitle: string): Promise<EvidenceArticle | null> {
  try {
    const response = await fetchWithRetry(url, { attempts: 1 });
    if (!response.ok) {
      log.warn("Evidence fetch non-OK", { url, status: response.status });
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;

    const html = await response.text();
    const body = extractBody(html, env.EVIDENCE_MAX_CHARS);
    if (body.length < MIN_ARTICLE_CHARS) {
      log.warn("Evidence extraction too small (paywall/JS wall?), skipping", { url, chars: body.length });
      return null;
    }

    return {
      url,
      title: extractTitle(html) || fallbackTitle,
      excerpt: body,
      fetchedAt: new Date().toISOString(),
      extractor: "density",
      chars: body.length,
    };
  } catch (error) {
    log.warn("Evidence fetch failed, skipping URL", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fetch full text for a promoted candidate's evidence. Never throws and
 * never blocks a research run: every failure mode (network, non-HTML,
 * paywall, parse) degrades to fewer or zero articles, and the caller falls
 * back to the titles-only evidenceSummary path that existed before Task 1.
 */
export async function fetchEvidenceArticles(candidate: ResearchCandidate): Promise<EvidenceArticle[]> {
  const targets = selectUrls(candidate.evidence);
  if (targets.length === 0) return [];

  const results = await Promise.allSettled(targets.map((target) => fetchOne(target.url, target.title)));
  const articles = results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((article): article is EvidenceArticle => article !== null);

  log.info("Evidence articles fetched", {
    topic: candidate.title,
    attempted: targets.length,
    fetched: articles.length,
    totalChars: articles.reduce((sum, article) => sum + article.chars, 0),
  });

  return articles;
}
