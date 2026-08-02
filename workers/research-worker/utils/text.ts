const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "you",
  "are",
  "how",
  "why",
  "what",
  "new",
  "about",
]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function extractKeywords(title: string, description?: string): string[] {
  const text = normalizeText(`${title} ${description ?? ""}`);
  const words = text
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  return Array.from(new Set(words)).slice(0, 10);
}

export function inferCategory(title: string, tags: string[] = []): string {
  const text = normalizeText(`${title} ${tags.join(" ")}`);
  if (/\b(ai|llm|model|agent|openai|gemini|claude|machine learning)\b/.test(text)) return "AI";
  if (/\b(next|react|vue|svelte|css|tailwind|javascript|typescript|frontend|web)\b/.test(text)) {
    return "Web Development";
  }
  if (/\b(api|server|node|go|rust|python|backend|microservice)\b/.test(text)) return "Backend";
  if (/\b(docker|kubernetes|ci|cd|deploy|cloud|aws|gcp|devops)\b/.test(text)) return "DevOps";
  if (/\b(postgres|mysql|redis|sqlite|database|sql)\b/.test(text)) return "Databases";
  if (/\b(github|open source|oss|repo|library|framework)\b/.test(text)) return "Open Source";
  return "General";
}

export function titleSimilarity(a: string, b: string): number {
  const aWords = new Set(normalizeText(a).split(" ").filter(Boolean));
  const bWords = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (aWords.size === 0 || bWords.size === 0) return 0;

  const intersection = Array.from(aWords).filter((word) => bWords.has(word)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return intersection / union;
}
