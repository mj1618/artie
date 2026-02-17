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

export default crons;
