import { z } from "zod";

export const PlannedClaimSchema = z.object({
  claim: z.string().min(1),
  evidenceSourceIds: z.array(z.string().min(1)).min(1),
  supportLevel: z.enum(["direct", "supported"]),
});

/**
 * Schema-validates generateContentPlan's Vertex response instead of trusting
 * whatever extractJson's JSON.parse returns as `any` - see
 * IMPLEMENTATION_PLAN.md Phase 2.6. PlanningResult is derived from this
 * schema (not hand-duplicated) so the type and the runtime check can't drift.
 */
export const PlanningResultSchema = z.object({
  searchIntent: z.string().min(1),
  audience: z.string().min(1),
  angle: z.string().min(1),
  primaryKeyword: z.string().min(1),
  secondaryKeywords: z.array(z.string()).min(1),
  competitorNotes: z.array(z.string()).min(1),
  internalNotes: z.string().optional(),
  plannedClaims: z.array(PlannedClaimSchema).default([]),
});

export type PlanningResult = z.infer<typeof PlanningResultSchema>;
