/** Shared SEO validation helpers - used by BlogDetailModal's SEO tab and the Quality page's SEO explorer. */

export const META_TITLE_BUDGET = 60;
export const META_DESCRIPTION_BUDGET = 160;

export type LengthStatus = "empty" | "good" | "warn" | "over";

export function lengthStatus(length: number, budget: number): LengthStatus {
  if (length === 0) return "empty";
  if (length > budget) return "over";
  if (length < budget * 0.5) return "warn";
  return "good";
}

export function lengthStatusColor(status: LengthStatus): string {
  switch (status) {
    case "good":
      return "var(--emerald)";
    case "warn":
      return "var(--amber)";
    case "over":
      return "var(--rose)";
    default:
      return "var(--mut)";
  }
}

export type JsonLdCheck = {
  valid: boolean;
  parsed: Record<string, unknown> | null;
  pretty: string;
  errors: string[];
};

const RECOMMENDED_JSON_LD_FIELDS = ["@context", "@type", "headline", "datePublished"];

/**
 * Parses and shape-checks a JSON-LD schema string. Doesn't validate against
 * the full schema.org vocabulary - just confirms it's valid JSON and has
 * the fields Google actually looks for on an Article/BlogPosting entity.
 */
export function checkJsonLd(schema: string | undefined | null): JsonLdCheck {
  if (!schema || !schema.trim()) {
    return { valid: false, parsed: null, pretty: "", errors: ["No schema generated yet."] };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(schema);
  } catch {
    return { valid: false, parsed: null, pretty: schema, errors: ["Schema is not valid JSON."] };
  }

  const errors: string[] = [];
  if (!parsed || typeof parsed !== "object") {
    errors.push("Schema must be a JSON object.");
  } else {
    for (const field of RECOMMENDED_JSON_LD_FIELDS) {
      if (!(field in parsed)) errors.push(`Missing recommended field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    parsed,
    pretty: parsed ? JSON.stringify(parsed, null, 2) : schema,
    errors,
  };
}

/** How many of the target keywords actually appear in the rendered content. */
export function keywordHitRatio(keywords: string[], content: string): { hits: number; total: number } {
  const lower = content.toLowerCase();
  const hits = keywords.filter((keyword) => keyword && lower.includes(keyword.toLowerCase())).length;
  return { hits, total: keywords.length };
}
