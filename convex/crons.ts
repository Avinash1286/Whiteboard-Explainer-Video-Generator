import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweep for stuck jobs once a minute and fail them with a clear reason, so a hung
// worker / model call can never leave a job silently "stuck" in the UI.
crons.interval("fail stale video jobs", { minutes: 1 }, internal.jobs.failStaleJobs, {});

export default crons;
