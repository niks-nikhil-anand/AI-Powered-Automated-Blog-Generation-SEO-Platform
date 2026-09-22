/**
 * Per-submission editorial policy: the few global content rules that are a
 * choice rather than a constant. The defaults encode the house rules - no
 * table of contents, no anchor navigation, no links the editor didn't
 * approve - so an article only gets those when a submission explicitly asks.
 *
 * Everything else (keyword usage, claim calibration, code integrity,
 * repetition) is not configurable: see workers/shared/editorial-rules.ts.
 */
export type EditorialPolicy = {
  /** R9: emit a "## Table of Contents" section at all. */
  tableOfContents: boolean;
  /** R8/R9: allow in-page anchor links ("[Section](#section)"). Only meaningful with a ToC. */
  anchorLinks: boolean;
  /** R8: the only internal/site-relative links an article may contain. */
  internalLinks: string[];
  /**
   * R12: URLs the submission vouched for (brief sourceNotes, product pages).
   * Linkable like an evidence source without being research evidence, so
   * supplying them does not switch the pipeline into sourced mode.
   */
  approvedLinks: string[];
  /**
   * R8: "evidence-only" restricts external links to the submission's approved
   * reference sources (the default); "allowed" lets the writer link out freely.
   */
  externalLinks: "evidence-only" | "allowed";
  /** R10: hosts an article may use as illustrative placeholders. */
  placeholderDomains: string[];
  /**
   * R4: when false (the default), the target word count is a guide and the
   * article is allowed to come in short rather than padded.
   */
  strictLength: boolean;
};

export const DEFAULT_EDITORIAL_POLICY: EditorialPolicy = {
  tableOfContents: false,
  anchorLinks: false,
  internalLinks: [],
  approvedLinks: [],
  externalLinks: "evidence-only",
  placeholderDomains: ["example.com", "example.org", "example.net", "your-domain.com", "yourdomain.com", "localhost"],
  strictLength: false,
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Resolve the policy from BlogInput.specs. Accepts the policy at the top
 * level or nested under `specs.specs` (submissions arrive both ways - see the
 * writing worker's writingInstructions/internalLinks lookups), and treats a
 * bare `internalLinks` array as the editor approving those links.
 */
export function resolveEditorialPolicy(specs?: Record<string, unknown> | null): EditorialPolicy {
  const raw = (specs ?? {}) as Record<string, unknown>;
  const nested = (raw.specs ?? {}) as Record<string, unknown>;
  const policy = ((raw.editorialPolicy ?? nested.editorialPolicy) ?? {}) as Record<string, unknown>;

  const internalLinks = Array.isArray(policy.internalLinks)
    ? asStringArray(policy.internalLinks)
    : asStringArray(raw.internalLinks ?? nested.internalLinks);

  const tableOfContents = asBoolean(
    policy.tableOfContents ?? raw.tableOfContents ?? nested.tableOfContents,
    DEFAULT_EDITORIAL_POLICY.tableOfContents
  );

  const approvedLinks = asStringArray(policy.approvedLinks ?? raw.approvedLinks ?? nested.approvedLinks);

  return {
    tableOfContents,
    // Anchor links are only ever on when asked for explicitly, and a ToC
    // without one is a plain list of section names (R9).
    anchorLinks: asBoolean(policy.anchorLinks ?? raw.anchorLinks ?? nested.anchorLinks, DEFAULT_EDITORIAL_POLICY.anchorLinks),
    internalLinks,
    // Internal links are approved link targets too - a brief that requires a
    // link must not have that link rejected as an unapproved URL.
    approvedLinks: Array.from(new Set([...approvedLinks, ...internalLinks])),
    externalLinks:
      (policy.externalLinks ?? raw.externalLinks) === "allowed" ? "allowed" : DEFAULT_EDITORIAL_POLICY.externalLinks,
    placeholderDomains:
      asStringArray(policy.placeholderDomains).length > 0
        ? asStringArray(policy.placeholderDomains)
        : DEFAULT_EDITORIAL_POLICY.placeholderDomains,
    strictLength: asBoolean(policy.strictLength ?? raw.strictLength, DEFAULT_EDITORIAL_POLICY.strictLength),
  };
}
