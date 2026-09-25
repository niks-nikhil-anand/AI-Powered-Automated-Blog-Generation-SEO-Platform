export const ELIGIBLE_BACKLOG_STATUSES = ["PENDING", "CANCELLED", "FAILED"] as const;

export type EligibleBacklogStatus = (typeof ELIGIBLE_BACKLOG_STATUSES)[number];

export type BacklogCandidate = {
  status: string;
  priority: string;
  createdAt: Date | string;
};

const STATUS_RANK: Record<EligibleBacklogStatus, number> = {
  PENDING: 0,
  CANCELLED: 1,
  FAILED: 2,
};

const PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export function isEligibleBacklogStatus(status: string): status is EligibleBacklogStatus {
  return (ELIGIBLE_BACKLOG_STATUSES as readonly string[]).includes(status);
}

export function statusRank(status: string): number {
  return isEligibleBacklogStatus(status) ? STATUS_RANK[status] : Number.POSITIVE_INFINITY;
}

export function priorityRank(priority: string): number {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.NORMAL;
}

export function compareBacklogCandidates(a: BacklogCandidate, b: BacklogCandidate): number {
  const statusDelta = statusRank(a.status) - statusRank(b.status);
  if (statusDelta !== 0) return statusDelta;

  const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDelta !== 0) return priorityDelta;

  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}
