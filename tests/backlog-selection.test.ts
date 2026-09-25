import assert from "node:assert/strict";
import {
  compareBacklogCandidates,
  isEligibleBacklogStatus,
  priorityRank,
  statusRank,
} from "../workers/shared/backlog-selection";

const base = new Date("2026-09-25T00:00:00.000Z");
const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

const rows = [
  { id: "completed", status: "COMPLETED", priority: "URGENT", createdAt: at(0) },
  { id: "processing", status: "PROCESSING", priority: "URGENT", createdAt: at(1) },
  { id: "failed-urgent-old", status: "FAILED", priority: "URGENT", createdAt: at(2) },
  { id: "cancelled-low", status: "CANCELLED", priority: "LOW", createdAt: at(3) },
  { id: "pending-normal-new", status: "PENDING", priority: "NORMAL", createdAt: at(4) },
  { id: "pending-high-newer", status: "PENDING", priority: "HIGH", createdAt: at(5) },
  { id: "pending-high-older", status: "PENDING", priority: "HIGH", createdAt: at(2) },
];

const picked = rows.filter((row) => isEligibleBacklogStatus(row.status)).sort(compareBacklogCandidates).map((row) => row.id);

assert.deepEqual(picked, [
  "pending-high-older",
  "pending-high-newer",
  "pending-normal-new",
  "cancelled-low",
  "failed-urgent-old",
]);

assert.equal(statusRank("PENDING") < statusRank("CANCELLED"), true);
assert.equal(statusRank("CANCELLED") < statusRank("FAILED"), true);
assert.equal(statusRank("FAILED") < statusRank("PROCESSING"), true);
assert.equal(statusRank("FAILED") < statusRank("COMPLETED"), true);
assert.equal(priorityRank("URGENT") < priorityRank("HIGH"), true);
assert.equal(priorityRank("HIGH") < priorityRank("NORMAL"), true);
assert.equal(priorityRank("NORMAL") < priorityRank("LOW"), true);

console.log("backlog-selection tests passed");
