import { NormalizedSignal } from "../types";
import { titleSimilarity } from "../utils/text";

export type SignalCluster = {
  key: string;
  signals: NormalizedSignal[];
};

function overlaps(a: NormalizedSignal, b: NormalizedSignal): boolean {
  if (a.url && b.url && a.url === b.url) return true;
  if (a.fingerprint === b.fingerprint) return true;
  if (titleSimilarity(a.normalizedTitle, b.normalizedTitle) >= 0.55) return true;

  const aKeywords = new Set(a.keywords);
  const shared = b.keywords.filter((keyword) => aKeywords.has(keyword)).length;
  return shared >= 3;
}

export function dedupeSignals(signals: NormalizedSignal[]): SignalCluster[] {
  const clusters: SignalCluster[] = [];

  for (const signal of signals) {
    const cluster = clusters.find((candidate) =>
      candidate.signals.some((existing) => overlaps(existing, signal))
    );

    if (cluster) {
      cluster.signals.push(signal);
    } else {
      clusters.push({ key: signal.fingerprint, signals: [signal] });
    }
  }

  return clusters;
}
