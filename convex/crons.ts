import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ====================
// DROPLET SCHEDULER JOBS
// ====================

// Process requested droplets - run every 10 seconds
crons.interval(
  "droplet:processRequested",
  { seconds: 10 },
  internal.dropletScheduler.processRequested
);

// Process failed creations - run every 10 seconds
crons.interval(
  "droplet:processCreateFailed",
  { seconds: 10 },
  internal.dropletScheduler.processCreateFailed
);

// Check heartbeats - run every 30 seconds
crons.interval(
  "droplet:checkHeartbeats",
  { seconds: 30 },
  internal.dropletScheduler.checkHeartbeats
);

// Check for stuck droplets - run every 30 seconds
crons.interval(
  "droplet:checkTimeouts",
  { seconds: 30 },
  internal.dropletScheduler.checkTimeouts
);

// Process stopping droplets - run every 30 seconds
crons.interval(
  "droplet:processStopping",
  { seconds: 30 },
  internal.dropletScheduler.processStopping
);

// Process unhealthy droplets - run every 30 seconds
crons.interval(
  "droplet:processUnhealthy",
  { seconds: 30 },
  internal.dropletScheduler.processUnhealthy
);

// Reconcile with DigitalOcean - run every 60 seconds
crons.interval(
  "droplet:reconcile",
  { seconds: 60 },
  internal.dropletScheduler.reconcile
);

// Clean up old destroyed records - run every hour
crons.interval(
  "droplet:cleanupOldRecords",
  { hours: 1 },
  internal.dropletScheduler.cleanupOldRecords
);

// ====================
// FIRECRACKER SCHEDULER JOBS (faster intervals than droplets)
// ====================

// Process requested VMs - run every 2 seconds (fast pickup)
crons.interval(
  "firecracker:processRequested",
  { seconds: 2 },
  internal.firecrackerScheduler.processRequested
);

// Check heartbeats - run every 30 seconds
crons.interval(
  "firecracker:checkHeartbeats",
  { seconds: 30 },
  internal.firecrackerScheduler.checkHeartbeats
);

// Check for stuck VMs - run every 15 seconds
crons.interval(
  "firecracker:checkTimeouts",
  { seconds: 15 },
  internal.firecrackerScheduler.checkTimeouts
);

// Process stopping VMs - run every 10 seconds
crons.interval(
  "firecracker:processStopping",
  { seconds: 10 },
  internal.firecrackerScheduler.processStopping
);

// Process unhealthy VMs - run every 30 seconds
crons.interval(
  "firecracker:processUnhealthy",
  { seconds: 30 },
  internal.firecrackerScheduler.processUnhealthy
);

// Clean up old destroyed records - run every hour
crons.interval(
  "firecracker:cleanupOldRecords",
  { hours: 1 },
  internal.firecrackerScheduler.cleanupOldRecords
);

// ====================
// FIRECRACKER POOL MAINTENANCE (keep VMs pre-warmed)
// ====================

// Replenish pool - run every 5 seconds to keep pool warm
crons.interval(
  "firecracker:replenishPool",
  { seconds: 5 },
  internal.firecrackerPool.replenishPool
);

// Clean up failed pool VMs - run every 30 seconds
crons.interval(
  "firecracker:cleanupFailedPool",
  { seconds: 30 },
  internal.firecrackerPool.cleanupFailedPoolVms
);

// Clean up stale assigned pool records - run every 5 minutes
crons.interval(
  "firecracker:cleanupAssignedPool",
  { minutes: 5 },
  internal.firecrackerPool.cleanupAssignedPoolVms
);

// ====================
// DOCKER SCHEDULER JOBS (similar to Firecracker)
// ====================

// Process requested containers - run every 2 seconds (fast pickup)
crons.interval(
  "docker:processRequested",
  { seconds: 2 },
  internal.dockerScheduler.processRequested
);

// Check heartbeats - run every 30 seconds
crons.interval(
  "docker:checkHeartbeats",
  { seconds: 30 },
  internal.dockerScheduler.checkHeartbeats
);

// Check for stuck containers - run every 15 seconds
crons.interval(
  "docker:checkTimeouts",
  { seconds: 15 },
  internal.dockerScheduler.checkTimeouts
);

// Process stopping containers - run every 10 seconds
crons.interval(
  "docker:processStopping",
  { seconds: 10 },
  internal.dockerScheduler.processStopping
);

// Process unhealthy containers - run every 30 seconds
crons.interval(
  "docker:processUnhealthy",
  { seconds: 30 },
  internal.dockerScheduler.processUnhealthy
);

// Clean up old destroyed records - run every hour
crons.interval(
  "docker:cleanupOldRecords",
  { hours: 1 },
  internal.dockerScheduler.cleanupOldRecords
);

// Reconcile with Docker host - verify containers exist - run every 60 seconds
crons.interval(
  "docker:reconcile",
  { seconds: 60 },
  internal.dockerScheduler.reconcile
);

// DOCKER POOL MAINTENANCE - keep containers pre-warmed for fast startup
crons.interval("docker:replenishPool", { seconds: 5 }, internal.dockerPool.replenishPool);
crons.interval("docker:cleanupFailedPool", { seconds: 30 }, internal.dockerPool.cleanupFailedPoolContainers);
crons.interval("docker:cleanupAssignedPool", { minutes: 5 }, internal.dockerPool.cleanupAssignedPoolContainers);

export default crons;
