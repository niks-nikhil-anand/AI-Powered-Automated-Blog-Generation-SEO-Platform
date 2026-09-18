import { prisma } from "../../shared/prisma";

export type ManualPoolTopic = {
  id: string;
  title: string;
  description: string | null;
  keywords: string[];
  category: string | null;
  priority: string;
};

const PRIORITY: Record<string, number> = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

/** Claims pending pool topics for one run, preventing concurrent duplicate use. */
export async function claimManualTopics(limit: number, requestedId?: string): Promise<ManualPoolTopic[]> {
  if (limit <= 0) return [];
  const pending = await prisma.manualTopic.findMany({ where: { status: "PENDING", ...(requestedId ? { id: requestedId } : {}) }, take: Math.max(limit * 4, limit), orderBy: { createdAt: "asc" } });
  const ordered = pending.sort((a, b) => (PRIORITY[b.priority] ?? 0) - (PRIORITY[a.priority] ?? 0) || a.createdAt.getTime() - b.createdAt.getTime()).slice(0, limit);
  const claimed: ManualPoolTopic[] = [];
  for (const topic of ordered) {
    const result = await prisma.manualTopic.updateMany({ where: { id: topic.id, status: "PENDING" }, data: { status: "RESEARCHING" } });
    if (result.count === 1) claimed.push(topic);
  }
  return claimed;
}

export async function completeManualTopic(id: string, status: "QUALIFIED" | "REJECTED", score?: number, reason?: string) {
  await prisma.manualTopic.update({ where: { id }, data: { status, lastResearchedAt: new Date(), lastResearchScore: score ?? null, lastFailureReason: status === "REJECTED" ? reason ?? "Failed research gates" : null } });
}

export async function markManualTopicUsed(id: string) {
  await prisma.manualTopic.update({ where: { id }, data: { status: "USED", usedAt: new Date() } });
}

export async function releaseManualTopic(id: string, reason: string) {
  await prisma.manualTopic.update({ where: { id }, data: { status: "REJECTED", lastResearchedAt: new Date(), lastFailureReason: reason } });
}
