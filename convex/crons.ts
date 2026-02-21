import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ====================
// DOCKER SCHEDULER JOBS
// ====================

crons.interval(
  "docker:processRequested",
  { seconds: 2 },
  internal.dockerScheduler.processRequested
);

crons.interval(
  "docker:checkHeartbeats",
  { seconds: 30 },
  internal.dockerScheduler.checkHeartbeats
);

crons.interval(
  "docker:checkTimeouts",
  { seconds: 15 },
  internal.dockerScheduler.checkTimeouts
);

crons.interval(
  "docker:processStopping",
  { seconds: 10 },
  internal.dockerScheduler.processStopping
);

crons.interval(
  "docker:processUnhealthy",
  { seconds: 30 },
  internal.dockerScheduler.processUnhealthy
);

crons.interval(
  "docker:cleanupOldRecords",
  { hours: 1 },
  internal.dockerScheduler.cleanupOldRecords
);

crons.interval(
  "docker:reconcile",
  { seconds: 60 },
  internal.dockerScheduler.reconcile
);

// DOCKER POOL MAINTENANCE
crons.interval("docker:replenishPool", { seconds: 5 }, internal.dockerPool.replenishPool);
crons.interval("docker:cleanupFailedPool", { seconds: 30 }, internal.dockerPool.cleanupFailedPoolContainers);
crons.interval("docker:cleanupAssignedPool", { minutes: 5 }, internal.dockerPool.cleanupAssignedPoolContainers);

export default crons;
