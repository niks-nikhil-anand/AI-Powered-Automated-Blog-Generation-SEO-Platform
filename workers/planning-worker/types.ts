export type PlanningResult = {
  searchIntent: string;
  audience: string;
  angle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  competitorNotes: string[];
  internalNotes?: string;
};
