/**
 * Must match the Blog.byline column's @default(...) in prisma/schema.prisma
 * exactly - Prisma can't reference a TS constant for a column default, so
 * the two are kept in sync by hand. See IMPLEMENTATION_PLAN.md Phase 2.7.
 */
export const AI_BYLINE = "Drafted with AI assistance, DevKit Market Analysis";
