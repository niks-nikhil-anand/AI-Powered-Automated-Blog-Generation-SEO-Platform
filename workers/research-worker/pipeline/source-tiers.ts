import { domainOf } from "../utils/similarity";

/**
 * Source authority tiers (docs/RESEARCH_ENGINE_UPGRADE.md Phase 8). Not all
 * domains are equal: an official announcement or a first-party repo is far
 * stronger evidence than a syndicated re-post. Tiering drives both the
 * evidence-quality score (authority dimension) and the "don't count five
 * copies of the same press release as five independent validations" rule.
 *
 *   Tier 1 - official company docs/blogs, official GitHub, standards/specs,
 *            primary research (arXiv, *.edu, conference/RFC).
 *   Tier 2 - high-quality technical publications, reputable engineering blogs,
 *            established technology journalism.
 *   Tier 3 - community discussions, aggregators, secondary sources.
 *
 * Deterministic and explainable: a curated domain map plus suffix heuristics.
 * Unknown domains default to Tier 3 (the conservative direction - they must
 * earn authority, not be granted it).
 */

const TIER1_DOMAINS = new Set([
  // Official eng/research blogs + docs
  "openai.com", "anthropic.com", "deepmind.google", "blog.google", "ai.google.dev",
  "developers.googleblog.com", "microsoft.com", "blogs.microsoft.com", "devblogs.microsoft.com",
  "meta.com", "ai.meta.com", "engineering.fb.com", "nvidia.com", "developer.nvidia.com",
  "blogs.nvidia.com", "apple.com", "machinelearning.apple.com", "amazon.com", "aws.amazon.com",
  "netflixtechblog.com", "eng.uber.com", "engineering.linkedin.com", "blog.cloudflare.com",
  "github.blog", "gitlab.com", "vercel.com", "blog.docker.com", "kubernetes.io",
  "huggingface.co", "blog.langchain.dev", "supabase.com", "stripe.com",
  // Standards / specs / primary research
  "arxiv.org", "w3.org", "ietf.org", "rfc-editor.org", "spec.whatwg.org", "tc39.es",
  "developer.mozilla.org", "web.dev",
]);

const TIER1_SUFFIXES = [".edu", ".gov", ".ac.uk", "github.com", "github.io", "readthedocs.io", "gitbook.io"];

const TIER2_DOMAINS = new Set([
  "techcrunch.com", "theverge.com", "arstechnica.com", "wired.com", "technologyreview.com",
  "thenewstack.io", "infoworld.com", "zdnet.com", "venturebeat.com", "theregister.com",
  "stackoverflow.blog", "martinfowler.com", "infoq.com", "hackernoon.com", "dev.to",
  "smashingmagazine.com", "css-tricks.com", "logrocket.com", "freecodecamp.org",
  "simonwillison.net", "jvns.ca", "danluu.com", "pragmaticengineer.com",
]);

const TIER3_DOMAINS = new Set([
  "news.ycombinator.com", "reddit.com", "medium.com", "substack.com", "quora.com",
  "wikipedia.org", "youtube.com", "twitter.com", "x.com", "linkedin.com",
]);

/**
 * Classify a URL into an authority tier. `entity` (optional) lets an official
 * first-party domain for the topic's own company count as Tier 1 even when it
 * isn't in the curated map (e.g. a launch on the vendor's own blog).
 */
export function tierForUrl(url: string, entity?: string): 1 | 2 | 3 {
  const domain = domainOf(url);
  if (!domain) return 3;

  if (TIER1_DOMAINS.has(domain)) return 1;
  if (TIER1_SUFFIXES.some((suffix) => domain.endsWith(suffix) || domain === suffix.slice(1))) return 1;

  // Official first-party domain for the topic's entity (e.g. "microsoft" ->
  // any *.microsoft.com). Only applied for a reasonably specific entity token.
  if (entity && entity.length >= 4 && domain.includes(entity.toLowerCase())) return 1;

  if (TIER2_DOMAINS.has(domain)) return 2;
  if (TIER3_DOMAINS.has(domain)) return 3;

  return 3;
}

/** Convenience: tier a URL with no entity context. */
export function tierForDomain(url: string): 1 | 2 | 3 {
  return tierForUrl(url);
}
