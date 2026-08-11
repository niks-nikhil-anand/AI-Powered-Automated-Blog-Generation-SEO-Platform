import { fingerprint } from "./fingerprint";
import { extractKeywords, normalizeText } from "./text";

/**
 * Text/URL/entity helpers for the research engine's topic-memory layer
 * (docs/RESEARCH_ENGINE_UPGRADE.md Phases 5-6). Everything here is pure and
 * deterministic - the whole point of the layered novelty check is that most
 * "have we already covered this?" decisions are explainable string/set
 * operations, with the (paid) embedding layer reserved for the cases the
 * cheap layers can't settle.
 */

/** Tracking / noise query params stripped before a URL is used as a dedupe key. */
const TRACKING_PARAMS =
  /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|msclkid$|mc_cid$|mc_eid$|igshid$|ref$|ref_src$|spm$|_ga$|_gl$)/i;

/**
 * Canonicalize a URL for exact-match dedupe: lowercase host, strip `www.`,
 * drop tracking params, remove hash, normalize trailing slash. Returns ""
 * for anything unparseable so callers can treat it as "no usable URL".
 */
export function canonicalizeUrl(raw?: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const kept: [string, string][] = [];
    url.searchParams.forEach((value, key) => {
      if (!TRACKING_PARAMS.test(key)) kept.push([key, value]);
    });
    kept.sort(([a], [b]) => a.localeCompare(b));
    const query = kept.map(([k, v]) => `${k}=${v}`).join("&");
    let path = url.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${host}${path}${query ? `?${query}` : ""}`.toLowerCase();
  } catch {
    return "";
  }
}

/** Registrable-ish domain (last two labels) - good enough for diversity/tiering, not a PSL impl. */
export function domainOf(raw?: string): string {
  if (!raw) return "";
  try {
    const parts = new URL(raw).hostname.toLowerCase().replace(/^www\./, "").split(".");
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

/**
 * Crude named-entity extraction: pull capitalized multi-word runs and known
 * product/org tokens out of a title. Used for the entity-overlap novelty
 * layer and for query expansion. Deterministic by design - no NER model.
 *
 * "Microsoft launches AI agent for automated unit test generation" ->
 * ["microsoft", "ai"]. Combined with keywords this is enough to recognize
 * that story across differently-worded write-ups.
 */
export function extractEntities(title: string): string[] {
  const entities = new Set<string>();

  // Capitalized tokens that aren't sentence-initial stopwords (e.g. "The").
  // Compound tokens are split so hyphenated/dotted names still surface their
  // base entity ("AI-powered" -> "ai", "powered"; "Next.js" -> "next").
  const capitalized = title.match(/\b[A-Z][a-zA-Z0-9.+#-]{1,}\b/g) ?? [];
  for (const token of capitalized) {
    for (const part of token.split(/[-/.+#]/)) {
      const lower = part.toLowerCase();
      if (part.length >= 2 && !GENERIC_CAPITALIZED.has(lower)) entities.add(lower);
    }
  }

  // Well-known product/org names regardless of casing in the raw title.
  const lower = ` ${title.toLowerCase()} `;
  for (const known of KNOWN_ENTITIES) {
    if (lower.includes(` ${known} `) || lower.includes(` ${known}'`)) entities.add(known);
  }

  return Array.from(entities).slice(0, 12);
}

const GENERIC_CAPITALIZED = new Set([
  "the", "a", "an", "and", "or", "but", "how", "why", "what", "new", "now",
  "this", "that", "these", "those", "introducing", "announcing", "meet",
  "launches", "launch", "releases", "release", "unveils", "announces",
]);

const KNOWN_ENTITIES = [
  "openai", "microsoft", "google", "anthropic", "meta", "nvidia", "apple",
  "amazon", "aws", "github", "gitlab", "vercel", "cloudflare", "docker",
  "kubernetes", "react", "vue", "svelte", "angular", "nextjs", "next.js",
  "typescript", "javascript", "python", "rust", "golang", "postgres",
  "postgresql", "mysql", "redis", "sqlite", "mongodb", "supabase", "firebase",
  "gpt", "claude", "gemini", "llama", "copilot", "langchain", "ollama",
];

/**
 * URL-independent topic fingerprint: normalized top keywords + entities,
 * sorted and hashed. Two write-ups of the same underlying story converge on
 * the same fingerprint even when their titles and URLs differ - this is the
 * layer that catches reworded duplicates the exact-title check misses.
 */
export function topicFingerprint(title: string, description?: string): string {
  const keywords = extractKeywords(title, description).slice(0, 6);
  const entities = extractEntities(title).slice(0, 4);
  const parts = [...new Set([...entities, ...keywords])].sort();
  return fingerprint(parts);
}

/** Jaccard similarity over the normalized keyword sets of two titles, 0..1. */
export function keywordSimilarity(aTitle: string, bTitle: string, aDesc?: string, bDesc?: string): number {
  const a = new Set(extractKeywords(aTitle, aDesc));
  const b = new Set(extractKeywords(bTitle, bDesc));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Overlap coefficient (|A∩B| / min(|A|,|B|)) over extracted entities, 0..1. */
export function entitySimilarity(aTitle: string, bTitle: string): number {
  const a = new Set(extractEntities(aTitle));
  const b = new Set(extractEntities(bTitle));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const e of a) if (b.has(e)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Detect a "materially new development" signal in a candidate title that is
 * absent from the historical title it matched - the deterministic half of the
 * Phase 6 follow-up override. A version bump, a benchmark/eval result, a new
 * launch/GA, or a security fix counts; merely restating the same product name
 * does not. Returns the matched signal keyword, or null.
 */
export function newDevelopmentSignal(newTitle: string, oldTitle: string): string | null {
  const SIGNALS = [
    "benchmark", "benchmarks", "eval", "evaluation", "update", "updated",
    "upgrade", "upgraded", "v2", "v3", "2.0", "3.0", "ga", "general availability",
    "launch", "launches", "launched", "release", "releases", "released",
    "rollback", "deprecat", "security", "cve", "vulnerability", "patch",
    "open source", "open-source", "open sourced", "pricing", "acquisition",
    "acquires", "acquired", "outage", "incident", "breaking",
  ];
  const newNorm = ` ${normalizeText(newTitle)} `;
  const oldNorm = ` ${normalizeText(oldTitle)} `;
  for (const signal of SIGNALS) {
    const needle = ` ${signal} `;
    if (newNorm.includes(needle) && !oldNorm.includes(needle)) return signal;
  }
  // A version number present in the new title but not the old is a strong signal.
  const newVersion = newTitle.match(/\bv?\d+\.\d+/);
  const oldVersion = oldTitle.match(/\bv?\d+\.\d+/);
  if (newVersion && newVersion[0] !== oldVersion?.[0]) return newVersion[0];
  return null;
}
