import type { EvidenceArticle } from "../shared/evidence";

/**
 * Evidence-grounded citation machinery (ENHANCEMENT_IMPLEMENTATION_PLAN.md
 * Task 2). The model never pastes URLs - it emits [S1]-style markers
 * against a numbered source list in the prompt, and this module turns
 * markers into real Markdown links deterministically. That converts
 * citation verification from "hope the model pasted the right URL" (the
 * old verbatim-substring citationCheck) into something code can actually
 * verify.
 */

export type GroundedSource = {
  /** Prompt-facing marker, e.g. "[S1]". */
  marker: string;
  url: string;
  title: string;
  excerpt: string;
};

export type CitationResult = {
  /** Markdown with markers replaced by real links. */
  markdown: string;
  /** Markers that appeared at least once in the draft, e.g. ["[S1]", "[S3]"]. */
  citedMarkers: string[];
  /**
   * Markers the model invented beyond the provided source list (e.g. [S7]
   * when only 3 sources exist) - stripped from the output, reported here as
   * a protocol-hallucination signal for the attempt log.
   */
  droppedMarkers: string[];
  /** Markdown link targets whose domain is not any evidence source's domain. */
  foreignLinks: string[];
};

/** Index-ordered [S1]..[Sn] binding for a trend's fetched evidence articles. */
export function toGroundedSources(articles: EvidenceArticle[]): GroundedSource[] {
  return articles.map((article, index) => ({
    marker: `[S${index + 1}]`,
    url: article.url,
    title: article.title,
    excerpt: article.excerpt,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const MARKDOWN_LINK_RE = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * Replace citation markers with real Markdown links:
 *  - first occurrence of a valid marker -> ([source title](source url))
 *  - repeat occurrences of the same marker -> removed (prose stays clean)
 *  - markers with no matching source -> removed, recorded as dropped
 * Also collects foreign (non-evidence-domain) Markdown link targets.
 */
export function materializeCitations(markdown: string, sources: GroundedSource[]): CitationResult {
  let output = markdown;
  const citedMarkers: string[] = [];
  const droppedMarkers: string[] = [];

  for (const source of sources) {
    const markerRe = new RegExp(escapeRegExp(source.marker), "g");
    let seen = false;
    output = output.replace(markerRe, () => {
      if (!seen) {
        seen = true;
        citedMarkers.push(source.marker);
        return `([${source.title}](${source.url}))`;
      }
      return "";
    });
  }

  output = output.replace(/\[S(\d+)\]/g, (whole, indexText) => {
    const index = Number(indexText);
    const valid = index >= 1 && index <= sources.length;
    if (!valid) droppedMarkers.push(`[S${index}]`);
    // Valid markers were already replaced above; a valid one still matching
    // here means it appeared zero times in the loop output - impossible,
    // but strip defensively either way.
    return valid ? "" : "";
  });

  const sourceDomains = new Set(sources.map((source) => domainOf(source.url)).filter(Boolean));
  const foreignLinks: string[] = [];
  for (const match of output.matchAll(MARKDOWN_LINK_RE)) {
    const domain = domainOf(match[1]);
    if (domain && !sourceDomains.has(domain)) foreignLinks.push(match[1]);
  }

  return { markdown: output, citedMarkers, droppedMarkers, foreignLinks };
}

/**
 * Grounded citation gate: at least min(2, available) sources cited, from at
 * least 2 distinct URLs when 2+ sources exist. Mirrors the thresholds of
 * the legacy citationCheck so the two modes gate at the same strictness.
 */
export function groundedCitationCheck(
  citedMarkers: string[],
  sources: GroundedSource[]
): { ok: boolean; found: number; required: number } {
  if (sources.length === 0) return { ok: true, found: 0, required: 0 };
  const required = Math.min(2, sources.length);
  const distinctUrls = new Set(
    citedMarkers
      .map((marker) => sources.find((source) => source.marker === marker)?.url)
      .filter((url): url is string => Boolean(url))
  );
  const found = Math.min(citedMarkers.length, distinctUrls.size);
  return { ok: distinctUrls.size >= required, found, required };
}
