/**
 * Worker-side reader for the fields the submission brief contributes that
 * have no column of their own (app/dashboard/blogs/new/brief.ts writes them
 * into BlogInput.specs). Everything is optional: a submission that carried no
 * brief simply yields empty values, and every consumer already has a default.
 */
export type BriefSpecs = {
  /** Brief context rendered as its own prompt block (audience pains, scenarios, evidence rules). */
  directives: string[];
  /** Explicit word bounds; they override the range derived from the target. */
  wordBounds: { min?: number; max?: number; countFaqInTotal?: boolean; avoidPadding?: boolean } | null;
  /** outlineJson.h1 - the finished article's H1 must match it. */
  briefedH1: string | null;
  /** generationConfig.generationMode: "section_by_section" | "single_pass" | null. */
  generationMode: string | null;
  /** generationConfig.maxSectionRetries - attempts per section before the job fails. */
  maxSectionRetries: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Specs arrive either flat or nested under `specs.specs`, as elsewhere in the workers. */
function layers(specs?: Record<string, unknown> | null): Record<string, unknown>[] {
  const raw = isRecord(specs) ? specs : {};
  const nested = isRecord(raw.specs) ? raw.specs : {};
  return [raw, nested];
}

function pick(specs: Record<string, unknown> | null | undefined, key: string): unknown {
  for (const layer of layers(specs)) {
    if (layer[key] !== undefined) return layer[key];
  }
  return undefined;
}

export function readBriefSpecs(specs?: Record<string, unknown> | null): BriefSpecs {
  const directives = strArray(pick(specs, "briefDirectives"));

  const rawBounds = pick(specs, "contentBounds");
  let wordBounds: BriefSpecs["wordBounds"] = null;
  if (isRecord(rawBounds)) {
    const min = num(rawBounds.min);
    const max = num(rawBounds.max);
    const countFaqInTotal = bool(rawBounds.countFaqInTotal);
    const avoidPadding = bool(rawBounds.avoidPadding);
    if (min !== undefined || max !== undefined || countFaqInTotal !== undefined || avoidPadding !== undefined) {
      wordBounds = { min, max, countFaqInTotal, avoidPadding };
    }
  }

  const briefedH1 = pick(specs, "briefedH1");

  const generationMode = pick(specs, "generationMode");
  const maxSectionRetries = num(pick(specs, "maxSectionRetries"));

  return {
    directives,
    wordBounds,
    briefedH1: typeof briefedH1 === "string" && briefedH1.trim() ? briefedH1.trim() : null,
    generationMode: typeof generationMode === "string" && generationMode.trim() ? generationMode.trim() : null,
    maxSectionRetries: maxSectionRetries && maxSectionRetries > 0 ? Math.min(5, Math.round(maxSectionRetries)) : null,
  };
}

/** The brief block for a prompt, or "" when the submission carried no brief. */
export function buildBriefDirectivesBlock(directives: string[]): string {
  if (directives.length === 0) return "";
  return `\nBrief requirements (from the submission - treat these as binding):\n${directives
    .map((directive) => `- ${directive}`)
    .join("\n")}\n`;
}
