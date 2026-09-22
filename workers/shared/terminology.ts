/**
 * Deprecated terminology (R6). Each entry is only checked when the article is
 * actually in that subject area (`appliesWhen`), and is NOT flagged when the
 * current replacement also appears - an article explaining "FID was replaced
 * by INP" is correct, not outdated.
 *
 * Keep this list small and defensible: every entry must be a term with a
 * current, named replacement, not a matter of taste.
 */
export type DeprecatedTerm = {
  /** Rule id suffix, for the violation message. */
  id: string;
  /** Matches the outdated term. Case-insensitive, applied to prose only. */
  pattern: RegExp;
  label: string;
  replacement: string;
  /** The article must mention one of these for the term to be in scope. */
  appliesWhen: RegExp;
  /** When this matches the article, the mention is historical//comparative - not a violation. */
  exemptWhen: RegExp;
};

export const DEPRECATED_TERMS: DeprecatedTerm[] = [
  {
    id: "fid",
    pattern: /\b(first input delay|\bFID\b)/i,
    label: "First Input Delay (FID)",
    replacement: "Interaction to Next Paint (INP)",
    appliesWhen: /core web vitals|web vitals|lcp|cls|page experience/i,
    exemptWhen: /interaction to next paint|\bINP\b/i,
  },
  {
    id: "webmaster-tools",
    pattern: /google webmaster tools/i,
    label: "Google Webmaster Tools",
    replacement: "Google Search Console",
    appliesWhen: /seo|search engine|indexing|crawl/i,
    exemptWhen: /renamed|formerly|now called|used to be/i,
  },
  {
    id: "meta-keywords",
    pattern: /meta\s+keywords\s+tag|<meta\s+name=["']keywords["']/i,
    label: 'the meta keywords tag',
    replacement: "title/description metadata and on-page content",
    appliesWhen: /seo|metadata|meta tags/i,
    exemptWhen: /ignored|no longer|deprecated|obsolete|not used/i,
  },
  {
    id: "rel-next-prev",
    pattern: /rel=["']?(next|prev)["']?/i,
    label: 'rel="next"/rel="prev" pagination hints',
    replacement: "self-referencing canonicals with crawlable pagination links",
    appliesWhen: /paginat|seo|canonical/i,
    exemptWhen: /no longer|deprecated|unsupported|retired|ignored/i,
  },
  {
    id: "amp",
    pattern: /accelerated mobile pages|\bAMP\b/i,
    label: "AMP (Accelerated Mobile Pages)",
    replacement: "Core Web Vitals work on the canonical page",
    appliesWhen: /mobile seo|search results|top stories|page experience/i,
    exemptWhen: /no longer required|deprecated|legacy|historic|removed the/i,
  },
  {
    id: "next-get-initial-props",
    pattern: /getInitialProps/,
    label: "getInitialProps",
    replacement: "App Router server components or getServerSideProps/getStaticProps in the Pages Router",
    appliesWhen: /next\.js|app router/i,
    exemptWhen: /legacy|deprecated|older versions|pages router history/i,
  },
  {
    id: "next-head-in-app-router",
    pattern: /next\/head/i,
    label: "next/head",
    replacement: "the App Router Metadata API (`export const metadata`)",
    appliesWhen: /app router|app directory|app\//i,
    exemptWhen: /pages router|legacy|deprecated|migrat/i,
  },
];

export type TerminologyFinding = {
  id: string;
  label: string;
  replacement: string;
  excerpt: string;
};

/**
 * Outdated terms used as if current. `text` should be prose with code blocks
 * already stripped - a code sample migrating away from a deprecated API is
 * not a terminology error.
 */
export function findDeprecatedTerminology(text: string, terms: DeprecatedTerm[] = DEPRECATED_TERMS): TerminologyFinding[] {
  const findings: TerminologyFinding[] = [];
  for (const term of terms) {
    if (!term.appliesWhen.test(text)) continue;
    if (term.exemptWhen.test(text)) continue;
    const match = text.match(term.pattern);
    if (!match) continue;
    const index = Math.max(0, (match.index ?? 0) - 40);
    findings.push({
      id: term.id,
      label: term.label,
      replacement: term.replacement,
      excerpt: text.slice(index, index + 120).replace(/\s+/g, " ").trim(),
    });
  }
  return findings;
}
