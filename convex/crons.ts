import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ====================
// PARTICLE SCHEDULER JOBS
// ====================

crons.interval(
  "particle:checkHeartbeats",
  { seconds: 30 },
  internal.particleScheduler.checkHeartbeats
);

crons.interval(
  "particle:checkTimeouts",
  { seconds: 15 },
  internal.particleScheduler.checkTimeouts
);

crons.interval(
  "particle:processStopping",
  { seconds: 10 },
  internal.particleScheduler.processStopping
);

crons.interval(
  "particle:processUnhealthy",
  { seconds: 30 },
  internal.particleScheduler.processUnhealthy
);

crons.interval(
  "particle:cleanupOldRecords",
  { hours: 1 },
  internal.particleScheduler.cleanupOldRecords
);

crons.interval(
  "particle:reconcile",
  { seconds: 60 },
  internal.particleScheduler.reconcile
);

export default crons;
