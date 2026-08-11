/**
 * SearXNG service module (docs/RESEARCH_ENGINE_UPGRADE.md). Self-contained and
 * separately testable from the rest of the research worker, but NOT an
 * independent topic-selection system - it only widens discovery (source.ts)
 * and supplies SERP evidence/landscape (serp.ts) into the one shared pipeline.
 */
export { SearxngClient, createSearxngClient } from "./client";
export type { SearxngStats, SearxngSearchOverrides } from "./client";
export { fetchSearxngDiscoverySignals, searxngSource } from "./source";
export { researchCandidateOnSerp } from "./serp";
